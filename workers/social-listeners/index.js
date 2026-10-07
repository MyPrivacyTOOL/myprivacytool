// MPT (MyPrivacyTOOL) social-listeners — Microdrama placeholder Worker (MPT-1004).
// Exists so the secrets/CI-CD pipeline can deploy; real logic lands in a later task.
// Secrets are read from `env` only (never hardcoded): see EXPECTED_SECRETS.txt.
export default {
  async fetch() {
    return Response.json({ worker: "social-listeners", ok: true });
  },
};
