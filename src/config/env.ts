import { z } from "zod";
import { APP_NAME, REPO_URL } from "./brand";

// google (Gemini), groq and openai-compatible (OpenRouter) are installed. anthropic is accepted but not installed.
export const LLM_PROVIDERS = ["google", "groq", "openai-compatible", "anthropic"] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

const providerEnum = z.enum(LLM_PROVIDERS);

// "groq,openai-compatible" becomes ["groq", "openai-compatible"].
const providerList = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean),
  )
  .pipe(z.array(providerEnum));

const thinkingLevel = z.enum(["minimal", "low", "medium", "high"]);

const envSchema = z
  .object({
    DATABASE_URL: z.string().min(1),

    QLOO_MODE: z.enum(["fixtures", "live", "record"]).default("fixtures"),
    QLOO_BASE_URL: z.url().default("https://hackathon.api.qloo.com"),
    QLOO_API_KEY: z.string().min(1).optional(),

    LLM_MODE: z.enum(["mock", "live"]).default("mock"),
    LLM_PROVIDER: providerEnum.default("google"),
    // Fallbacks, tried in order when the main provider fails or is rate limited. For example "openai-compatible".
    LLM_FALLBACK_PROVIDERS: providerList,
    // Models for the main provider. Each fallback has its own <PROVIDER>_MODEL and <PROVIDER>_MODEL_FAST, and is
    // skipped when they are missing.
    LLM_MODEL: z.string().min(1).optional(),
    LLM_MODEL_FAST: z.string().min(1).optional(),
    GOOGLE_MODEL: z.string().min(1).optional(),
    GOOGLE_MODEL_FAST: z.string().min(1).optional(),
    GROQ_MODEL: z.string().min(1).optional(),
    GROQ_MODEL_FAST: z.string().min(1).optional(),
    OPENAI_COMPATIBLE_MODEL: z.string().min(1).optional(),
    OPENAI_COMPATIBLE_MODEL_FAST: z.string().min(1).optional(),
    // How long Gemini 3 models may think. Left alone they took up to 34 s for a short answer.
    LLM_THINKING_MAIN: thinkingLevel.default("low"),
    LLM_THINKING_FAST: thinkingLevel.default("minimal"),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    GROQ_API_KEY: z.string().min(1).optional(),
    OPENAI_COMPATIBLE_BASE_URL: z.url().optional(),
    OPENAI_COMPATIBLE_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),

    APP_URL: z.url().default("http://localhost:3000"),
    RATE_LIMIT_PER_HOUR: z.coerce.number().int().positive().default(30),
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
