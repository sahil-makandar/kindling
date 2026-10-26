import { z } from "zod";
import { APP_NAME, REPO_URL } from "./brand";

export const LLM_PROVIDERS = [
  "google",
  "groq",
  "xai",
  "openai-compatible",
  "anthropic",
] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const providerEnum = z.enum(LLM_PROVIDERS);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),

    QLOO_MODE: z.enum(["fixtures", "live", "record"]).default("fixtures"),
    QLOO_BASE_URL: z.url().default("https://hackathon.api.qloo.com"),
    QLOO_API_KEY: z.string().min(1).optional(),

    LLM_MODE: z.enum(["mock", "live"]).default("mock"),
    LLM_PROVIDER: providerEnum.default("google"),
    LLM_FALLBACK_PROVIDER: providerEnum.optional(),
    LLM_MODEL: z.string().min(1).optional(),
    LLM_MODEL_FAST: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    XAI_API_KEY: z.string().min(1).optional(),
    OPENAI_COMPATIBLE_BASE_URL: z.url().optional(),
    OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    APP_URL: z.url().default("http://localhost:3000"),
    RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(10),
    // Set by Vercel. Used only to refuse local-only settings on the hosted app.
    VERCEL: z.string().optional(),
    NOMINATIM_USER_AGENT: z
      .string()
      .min(1)
      .default(`${APP_NAME.toLowerCase()}-hackathon/0.1 (+${REPO_URL})`),
  })
  .superRefine((env, ctx) => {
    const need = (key: keyof typeof env, why: string) => {
      if (env[key] === undefined) {
        ctx.addIssue({ code: "custom", path: [key], message: `required ${why}` });
      }
    };

    if (env.QLOO_MODE !== "fixtures") {
      need("QLOO_API_KEY", `when QLOO_MODE=${env.QLOO_MODE}`);
    }
    // Record mode writes Qloo responses to disk. That is for a developer machine only, because Qloo data
    // must never end up in the public repo.
    if (env.QLOO_MODE === "record" && env.VERCEL !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["QLOO_MODE"],
        message: "record mode is for local use only; use live on the hosted app",
      });
    }

    if (env.LLM_MODE === "live") {
      need("LLM_MODEL", "when LLM_MODE=live");
      need("LLM_MODEL_FAST", "when LLM_MODE=live");
      const why = `when LLM_MODE=live and LLM_PROVIDER=${env.LLM_PROVIDER}`;
      switch (env.LLM_PROVIDER) {
        case "google":
          need("GOOGLE_GENERATIVE_AI_API_KEY", why);
          break;
        case "groq":
          need("GROQ_API_KEY", why);
          break;
        case "xai":
          need("XAI_API_KEY", why);
          break;
        case "openai-compatible":
          need("OPENAI_COMPATIBLE_API_KEY", why);
          need("OPENAI_COMPATIBLE_BASE_URL", why);
          break;
        case "anthropic":
          need("ANTHROPIC_API_KEY", why);
          break;
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export class EnvError extends Error {
  constructor(public readonly problems: string[]) {
    super(
      `Environment is not set up correctly:\n${problems
        .map((p) => `  - ${p}`)
        .join("\n")}\nCopy .env.example to .env.local and fill in the missing values.`,
    );
    this.name = "EnvError";
  }
}

// Blank values in .env files (KEY=) mean "not set".
function dropBlank(source: Record<string, string | undefined>) {
  return Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ""),
  );
}

export function parseEnv(source: Record<string, string | undefined>): Env {
  const cleaned = dropBlank(source);
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new EnvError(
      result.error.issues.map((i) => {
        const key = i.path.join(".") || "env";
        return i.code === "invalid_type" && !(key in cleaned)
          ? `${key}: missing`
          : `${key}: ${i.message}`;
      }),
    );
  }
  return result.data;
}

let cached: Env | undefined;

// Read lazily so `next build` and tests do not need a full environment.
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
