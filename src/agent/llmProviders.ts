import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import type { generateText, LanguageModel } from "ai";
import type { Env, LlmProvider } from "@/src/config/env";

// Builds the ordered list of language model providers from the environment: the main provider first, then
// the optional fallback. Model names always come from the environment, never from code.

export type LlmTier = "main" | "fast";

// Per-provider settings passed to every call (for example how long a model may think).
export type CallProviderOptions = NonNullable<Parameters<typeof generateText>[0]["providerOptions"]>;

export type ModelHandle = { id: string; model: LanguageModel; providerOptions?: CallProviderOptions };

export type ProviderEntry = {
  name: LlmProvider;
  // How the provider is named in the trace, for example "Gemini".
  label: string;
  model(tier: LlmTier): ModelHandle | null;
};

const LABELS: Record<LlmProvider, string> = {
  google: "Gemini",
  groq: "Groq",
  xai: "Grok",
  "openai-compatible": "the backup model",
  anthropic: "Claude",
};

type Models = { main?: string; fast?: string };

// Only the providers we hold keys for are installed. The others are accepted by the env schema so a
// provider can be added later, but until its package is installed it is skipped with a note.
function build(name: LlmProvider, env: Env, models: Models): ProviderEntry | { skipped: string } {
  const handle =
    (create: (id: string) => LanguageModel, options?: (tier: LlmTier) => CallProviderOptions) => (tier: LlmTier) => {
      const id = tier === "main" ? models.main : models.fast;
      return id ? { id, model: create(id), providerOptions: options?.(tier) } : null;
    };

  if (name === "google" && env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    // Gemini 3 models think before answering, and left alone the main model took 34 s for a one-line answer.
    // Agent routes must finish in 60 s, so cap the thinking: a little for the main model, almost none for the fast one.
    const thinking = (tier: LlmTier): CallProviderOptions => ({
      google: { thinkingConfig: { thinkingLevel: tier === "main" ? "low" : "minimal" } },
    });
    return { name, label: LABELS[name], model: handle((id) => google(id), thinking) };
  }
  if (name === "groq" && env.GROQ_API_KEY) {
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    return { name, label: LABELS[name], model: handle((id) => groq(id)) };
  }
  if (name === "google" || name === "groq") return { skipped: `${LABELS[name]} has no API key.` };
  return { skipped: `${LABELS[name]} is not installed in this build.` };
}

export function resolveProviders(env: Env): { providers: ProviderEntry[]; notes: string[] } {
  const providers: ProviderEntry[] = [];
  const notes: string[] = [];

  const main = build(env.LLM_PROVIDER, env, { main: env.LLM_MODEL, fast: env.LLM_MODEL_FAST });
  if ("skipped" in main) notes.push(main.skipped);
  else providers.push(main);

  const fallbackName = env.LLM_FALLBACK_PROVIDER;
  if (fallbackName && fallbackName !== env.LLM_PROVIDER) {
    if (!env.LLM_FALLBACK_MODEL || !env.LLM_FALLBACK_MODEL_FAST) {
      notes.push("The fallback provider needs LLM_FALLBACK_MODEL and LLM_FALLBACK_MODEL_FAST.");
    } else {
      const fallback = build(fallbackName, env, { main: env.LLM_FALLBACK_MODEL, fast: env.LLM_FALLBACK_MODEL_FAST });
      if ("skipped" in fallback) notes.push(fallback.skipped);
      else providers.push(fallback);
    }
  }
  return { providers, notes };
}
