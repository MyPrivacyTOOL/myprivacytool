export interface Env {
  LOG_LEVEL?: string;
  // Secrets (see EXPECTED_SECRETS.txt)
  SUPABASE_URL?: string;
  SUPABASE_KEY?: string;
  TWILIO_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  META_APP_SECRET?: string;
  META_VERIFY_TOKEN?: string;
}
