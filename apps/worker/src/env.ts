export type Env = {
  ENV: "dev" | "prod";
  WEBAPP_ORIGIN: string;

  INITDATA_MAX_AGE_SEC: string;
  PAYLOAD_MAX_BYTES: string;

  RATE_LIMIT_ENABLED: string;
  RATE_LIMIT_WINDOW_SEC: string;
  RATE_LIMIT_MAX_REQUESTS: string;

  // Secrets
  BOT_TOKEN?: string;
  WEBHOOK_SECRET: string;

  DB?: D1Database;
  ASSETS?: R2Bucket;
};
