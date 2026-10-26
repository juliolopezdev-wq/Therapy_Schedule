export const ENV = {
  databaseUrl: process.env.DATABASE_URL ?? "",
  // Base URL used to build magic-link login links in emails (e.g. https://pam.example.com).
  // Falls back to the request's own protocol+host when unset (fine for single-origin deploys).
  appUrl: process.env.APP_URL ?? "",
  // Bootstrap admin: the only email allowed to request a login link before any invite exists.
  // Needed to break the chicken-and-egg problem of an admin-invite-only system having no admins
  // yet. Once this email logs in once it becomes a normal admin row like any other.
  ownerEmail: (process.env.OWNER_EMAIL ?? "").toLowerCase(),
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "https://ollama.com",
  ollamaModel: process.env.OLLAMA_MODEL ?? "gemma4:31b",
  ollamaApiKey: process.env.OLLAMA_API_KEY ?? "",
  // Proactive at-risk email digest (server/atRiskDigestEmail.ts) -- any generic SMTP provider
  // works (Gmail app password, SES SMTP, SendGrid SMTP, etc.), so no vendor-specific SDK.
  smtpHost: process.env.SMTP_HOST ?? "",
  smtpPort: Number(process.env.SMTP_PORT ?? "587"),
  smtpUser: process.env.SMTP_USER ?? "",
  smtpPass: process.env.SMTP_PASS ?? "",
  smtpFrom: process.env.SMTP_FROM ?? "",
  // Resend HTTPS API key -- takes priority over SMTP when set (works on hosts that block SMTP ports).
  resendApiKey: process.env.RESEND_API_KEY ?? "",
  // Google Apps Script Gmail relay (scripts/gmail-relay.gs) -- highest priority when set.
  gmailRelayUrl: process.env.GMAIL_RELAY_URL ?? "",
  gmailRelaySecret: process.env.GMAIL_RELAY_SECRET ?? "",
  // Comma-separated recipient list -- explicit rather than derived from user accounts, since not
  // every staff member who should see this digest necessarily has a login.
  digestNotificationEmails: (process.env.DIGEST_NOTIFICATION_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
