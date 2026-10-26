"""MPC-8364: the droplet audit-trail loader. No real secrets here: all values are made up."""
import contextlib
import io
import json
import os
import tempfile
import unittest

from app.config import Settings
from app.services import detectors
from loader import audit_log_loader as L
from tests.test_phase2 import svc
from app.integrations.sources import InMemorySource

SK = "sk_live_" + "a1B2c3D4e5F6g7H8i9J0k1L2"
AKIA = "AKIA" + "ABCDEFGHIJKLMNOP"
BEARER = "Bearer " + "Zz9" * 15           # 45 chars
GHP = "ghp_" + "q" * 30


def rec(event, actor="testingnt69", ts="2026-10-09T09:00:00.000Z", target="shell", **details):
    return {"schema_version": "1", "event_id": "e-" + ts, "timestamp": ts, "event_type": event,
            "actor_type": "agent", "actor_id": actor, "target_type": "tool", "target_id": target,
            "system_component": "tool-registry", "action_status": "success", "correlation_id": "corr-1",
            "sensitivity_level": "none", "data_fields_accessed": [], "details": details}


class MaskTests(unittest.TestCase):
    def test_secret_values_are_gone(self):
        out = L.mask(f"key={SK} aws={AKIA} {BEARER} password: hunter2 token {GHP} mail me bob@example.com")
        for secret in (SK, AKIA, BEARER.split()[1], "hunter2", GHP, "bob@example.com"):
            self.assertNotIn(secret, out)

    def test_masked_text_is_still_detected_as_a_credential(self):
        for raw in (f"key={SK}", f"aws {AKIA}", f"auth {BEARER}", "password: hunter2"):
            masked = L.mask(raw)
            hit = detectors.detect_57_api_keys([{"ts": "1", "text": masked}])
            self.assertIsNotNone(hit, f"detector lost the shape of: {masked}")

    def test_shape_and_length_preserved(self):
        self.assertEqual(L.mask(AKIA), "AKIA" + "X" * 16)
        self.assertEqual(len(L.mask(BEARER)), len(BEARER))
        self.assertTrue(L.mask(SK).startswith("sk_live_X"))

    def test_text_is_truncated_and_none_is_safe(self):
        self.assertEqual(len(L.mask("a" * 5000)), L.MAX_TEXT)
        self.assertEqual(L.mask(None), "")


class MappingTests(unittest.TestCase):
    def test_each_tool_event_maps_to_a_row(self):
        r = L.to_row(rec("tool_execution_started", param_keys=["cmd", "cwd"], task_id="t1"))
        self.assertEqual((r["tool"], r["agent_id"], r["session"]), ("shell", "testingnt69", "corr-1"))
        self.assertEqual(r["text"], "tool shell started; params: cmd,cwd")
        self.assertIn("completed: ok", L.to_row(rec("tool_execution_completed", outcome_summary="ok", duration_ms=5))["text"])
        self.assertIn("failed: boom", L.to_row(rec("tool_execution_failed", error="boom"))["text"])
        self.assertIn("denied: policy", L.to_row(rec("tool_execution_denied", reason="policy"))["text"])

    def test_row_matches_the_table_schema_and_empty_columns_are_empty(self):
        r = L.to_row(rec("tool_execution_started", param_keys=[]))
        self.assertEqual(tuple(r), L.COLUMNS)
        self.assertEqual((r["vault_start"], r["vault_end"], r["nonce"], r["sender"], r["dest_region"]), ([], [], None, None, None))

    def test_raw_tool_output_is_never_read(self):
        r = L.to_row(rec("tool_execution_completed", outcome_summary="done", _raw=f"SECRET-RAW {SK}"))
        self.assertNotIn("SECRET-RAW", json.dumps(r))
        self.assertNotIn(SK, json.dumps(r))

    def test_secret_in_an_error_is_masked_but_still_detectable(self):
        r = L.to_row(rec("tool_execution_failed", error=f"Traceback (most recent call last): token={SK}"))
        self.assertNotIn(SK, r["text"])
        self.assertIsNotNone(detectors.detect_58_secrets_in_errors([r]))

    def test_sensitive_access_row(self):
        d = rec("sensitive_data_accessed", sensitivity_categories=["pii"])
        d["sensitivity_level"] = "high"
        self.assertEqual(L.to_row(d)["text"], "sensitive data accessed (high): pii")

    def test_non_agent_and_housekeeping_records_are_skipped(self):
        self.assertIsNone(L.to_row({"event_type": "log_rolled", "actor_type": "system", "actor_id": "audit-roller", "timestamp": "t"}))
        self.assertIsNone(L.to_row({**rec("tool_execution_started"), "actor_type": "system"}))
        self.assertIsNone(L.to_row({**rec("tool_execution_started"), "timestamp": None}))
        self.assertIsNone(L.to_row(rec("data_read")))


def write(dirpath, name, lines):
    p = os.path.join(dirpath, name)
    with open(p, "w") as f:
        f.write("\n".join(l if isinstance(l, str) else json.dumps(l) for l in lines) + "\n")
    return p


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = self.tmp.name
        write(self.dir, "audit-2026-10-09.jsonl", [
            rec("tool_execution_started", ts="2026-10-09T10:00:00.000Z", param_keys=["a"]),
            rec("tool_execution_started", actor="dolphinsintuition", ts="2026-10-09T10:01:00.000Z"),
            {"event_type": "log_rolled", "actor_type": "system", "actor_id": "audit-roller", "timestamp": "2026-10-09T10:02:00.000Z"},
            "{not json",
            rec("tool_execution_completed", ts="2026-10-09T09:00:00.000Z", outcome_summary="x"),
            ""])
        self.paths = [os.path.join(self.dir, "audit-2026-10-09.jsonl")]

    def tearDown(self):
        self.tmp.cleanup()

    def test_filters_by_agent_orders_by_time_and_counts_everything(self):
        rows, stats = L.build_rows(self.paths, "testingnt69")
        self.assertEqual([r["ts"] for r in rows], ["2026-10-09T09:00:00.000Z", "2026-10-09T10:00:00.000Z"])
        self.assertEqual((stats["unparseable"], stats["skipped_other_agent"], stats["skipped_not_agent_action"]), (1, 1, 1))

    def test_since_is_exclusive(self):
        rows, stats = L.build_rows(self.paths, "testingnt69", since="2026-10-09T09:00:00.000Z")
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["skipped_before_since"], 1)


class CliTests(BuildTests):
    def run_cli(self, *args):
        out = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(io.StringIO()):
            try:
                code = L.main(list(args))
            except SystemExit as e:
                code = e.code
        return code, out.getvalue()

    def test_dry_run_prints_counts_and_no_content(self):
        write(self.dir, "audit-2026-10-10.jsonl", [rec("tool_execution_failed", ts="2026-10-10T00:00:00.000Z", error=f"leak {SK}")])
        code, out = self.run_cli("--agent", "testingnt69", "--audit-dir", self.dir, "--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("rows: 3", out)
        self.assertNotIn("leak", out)
        self.assertNotIn(SK, out)

    def test_out_file_is_valid_ndjson_with_no_secret(self):
        write(self.dir, "audit-2026-10-10.jsonl", [rec("tool_execution_failed", ts="2026-10-10T00:00:00.000Z", error=f"leak {SK}")])
        target = os.path.join(self.dir, "rows.ndjson")
        code, _ = self.run_cli("--agent", "testingnt69", "--audit-dir", self.dir, "--out", target)
        self.assertEqual(code, 0)
        text = open(target).read()
        self.assertNotIn(SK, text)
        rows = [json.loads(l) for l in text.splitlines()]
        self.assertEqual(len(rows), 3)
        self.assertTrue(all(tuple(r) == L.COLUMNS for r in rows))

    def test_needs_out_or_dry_run_and_missing_dir_fails(self):
        self.assertNotEqual(self.run_cli("--agent", "x", "--audit-dir", self.dir)[0], 0)
        self.assertEqual(self.run_cli("--agent", "x", "--audit-dir", self.dir + "/nope", "--dry-run")[0], 2)


class EndToEndTests(unittest.TestCase):
    def test_masked_rows_flow_through_a_full_audit(self):
        recs = [rec("tool_execution_failed", ts=f"2026-10-09T10:00:0{i}.000Z", error=f"Traceback (most recent call last): key={SK}") for i in range(2)]
        rows = [L.to_row(r) for r in recs]
        result = svc(InMemorySource({"testingnt69": rows})).run("testingnt69")
        self.assertEqual(result["status"], "completed")
        self.assertIn(58, {d["riskId"] for d in result["detectedRisks"]})
        self.assertEqual(result["riskLevel"], "QUARANTINE")
        self.assertNotIn(SK, json.dumps(result))

    def test_repeated_identical_tool_calls_trigger_the_loop_detector(self):
        recs = [rec("tool_execution_started", ts=f"2026-10-09T10:00:{i:02d}.000Z", target="web_search", param_keys=["q"]) for i in range(25)]
        hit = detectors.detect_51_tool_loops([L.to_row(r) for r in recs])
        self.assertIsNotNone(hit)



class ArgValueSidecarTests(unittest.TestCase):
    """MPC-8428: masked argument values from the router's args-*.jsonl sidecar."""

    def test_args_are_appended_to_started_text_and_detected(self):
        d = rec("tool_execution_started", param_keys=["q"])
        d["event_id"] = "e1"
        r = L.to_row(d, {"q": "SELECT 1; DROP TABLE users", "key": "AKIA" + "X" * 16})
        self.assertIn("params: q | args: q=SELECT 1; DROP TABLE users; key=" + "AKIA" + "X" * 16, r["text"])
        self.assertEqual(L.to_row(d)["text"], "tool shell started; params: q")   # no sidecar -> unchanged text

    def test_a_raw_secret_that_slipped_into_the_sidecar_is_still_masked(self):
        d = rec("tool_execution_started", param_keys=["q"])
        r = L.to_row(d, {"q": "mail bob@example.com password: hunter2"})
        self.assertNotIn("bob@example.com", r["text"])
        self.assertNotIn("hunter2", r["text"])

    def test_build_rows_joins_on_event_id_and_counts(self):
        with tempfile.TemporaryDirectory() as t:
            a = os.path.join(t, "audit-2026-10-26.jsonl")
            s = os.path.join(t, "args-2026-10-26.jsonl")
            d = rec("tool_execution_started", param_keys=["cmd"]); d["event_id"] = "e9"
            open(a, "w").write(json.dumps(d) + "\n")
            open(s, "w").write(json.dumps({"event_id": "e9", "args": {"cmd": "npm install left-pad"}}) + "\n{bad\n")
            rows, stats = L.build_rows([a], "testingnt69", args=L.load_args([s]))
            self.assertIn("cmd=npm install left-pad", rows[0]["text"])
            self.assertEqual(stats["with_arg_values"], 1)

if __name__ == "__main__":
    unittest.main()
