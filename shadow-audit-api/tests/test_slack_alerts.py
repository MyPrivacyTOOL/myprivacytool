"""MPC-7877 owner decision 2026-10-20: Slack alerts only for results that need attention,
and a placeholder webhook must be treated as 'not configured'."""
import unittest

from app.config import Settings
from app.integrations.outbound import SlackNotifier
from app.integrations.sources import InMemorySource
from tests.test_phase2 import Boom, CLEAN, SECRET, svc


def slack_calls():
    calls = []
    return calls, SlackNotifier("https://hooks.slack.com/services/T/B/x", lambda m, u, h, b: calls.append(b) or {})


class SlackAlertTests(unittest.TestCase):
    def test_approved_audit_sends_nothing(self):
        calls, slack = slack_calls()
        r = svc(InMemorySource({"a1": CLEAN}), slack=slack).run("a1")
        self.assertEqual((r["riskLevel"], calls), ("APPROVED_FOR_P1_DATA", []))

    def test_quarantine_sends_exactly_one_message(self):
        calls, slack = slack_calls()
        r = svc(InMemorySource({"a1": CLEAN + [{"ts": "2026-10-20T00:00:09Z", "text": f"key={SECRET}"}]}), slack=slack).run("a1")
        self.assertEqual(r["riskLevel"], "QUARANTINE")
        self.assertEqual(len(calls), 1)
        self.assertIn("QUARANTINE", calls[0]["text"])
        self.assertNotIn(SECRET, calls[0]["text"])

    def test_incomplete_audit_sends_one_message(self):
        calls, slack = slack_calls()
        r = svc(Boom(), slack=slack).run("a1")
        self.assertEqual(r["riskLevel"], "INCOMPLETE")
        self.assertEqual(len(calls), 1)

    def test_no_data_audit_is_incomplete_and_alerts(self):
        calls, slack = slack_calls()
        r = svc(InMemorySource({}), slack=slack).run("a1")
        self.assertEqual(r["riskLevel"], "INCOMPLETE")
        self.assertEqual(len(calls), 1)


class SlackEnabledTests(unittest.TestCase):
    def test_only_a_real_slack_webhook_enables_alerts(self):
        enabled = lambda u: Settings(slack_webhook_url=u).slack_enabled  # noqa: E731
        self.assertTrue(enabled("https://hooks.slack.com/services/T000/B000/XXXXXXXX"))
        for placeholder in ("", "PENDING-REPLACE-ME", "https://example.invalid/slack-not-configured",
                            "http://hooks.slack.com/services/T/B/x", "https://evil.example/hooks.slack.com/"):
            self.assertFalse(enabled(placeholder), placeholder)


if __name__ == "__main__":
    unittest.main()
