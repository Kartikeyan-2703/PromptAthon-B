import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  FRONTEND_ORIGINS: z.string().default("http://localhost:3000"),
  SESSION_COOKIE_NAME: z.string().min(1).default("prompthon_session"),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(12),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().min(1).default("prompthon-submissions"),
  SUPABASE_CERTIFICATE_BUCKET: z.string().min(1).default("prompthon-certificates"),
  STORAGE_MAX_FILE_BYTES: z.coerce.number().int().min(1024).max(20 * 1024 * 1024).default(8 * 1024 * 1024),
}).superRefine((value, context) => {
  if (Boolean(value.SUPABASE_URL) !== Boolean(value.SUPABASE_SERVICE_ROLE_KEY)) {
    context.addIssue({ code: "custom", path: ["SUPABASE_URL"], message: "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured together" });
  }
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
  throw new Error(`Invalid server environment configuration: ${fields}`);
}

export const env = {
  ...parsed.data,
  frontendOrigins: parsed.data.FRONTEND_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === "production",
};
