// MPT (MyPrivacyTOOL) core-brain — Microdrama placeholder Worker (MPT-1004).
// Exists so the secrets/CI-CD pipeline can deploy; real logic lands in a later task.
// Secrets are read from `env` only (never hardcoded): see EXPECTED_SECRETS.txt.
// MPT-1002: responses go through the shared @mpt/utils package (npm workspace).
import { json } from "@mpt/utils";

export default {
  async fetch() {
    return json({ worker: "core-brain", ok: true });
  },
};
