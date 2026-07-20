export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
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
  // Comma-separated recipient list -- explicit rather than derived from user accounts, since not
  // every staff member who should see this digest necessarily has a login.
  digestNotificationEmails: (process.env.DIGEST_NOTIFICATION_EMAILS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
