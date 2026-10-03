import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url().default("postgres://deflink:deflink@127.0.0.1:5432/deflink"),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  STORAGE_DIR: z.string().default("./.storage"),
  /** Optional. When unset, the deterministic rules extractor is used. */
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default("claude-opus-5-5"),
  AI_EFFORT: z.enum(["low", "medium", "high"]).default("low"),
  AI_PROVIDER: z.enum(["rules", "anthropic"]).optional(),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}
export const env = parsed.data;
