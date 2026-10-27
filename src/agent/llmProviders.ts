import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createGroq } from "@ai-sdk/groq";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { generateText, LanguageModel } from "ai";
import type { Env, LlmProvider } from "@/src/config/env";

// Builds the ordered chain of language model providers from the environment: the main provider first, then each
// fallback in the order listed in LLM_FALLBACK_PROVIDERS. Model names always come from the environment, never
// from code: LLM_MODEL and LLM_MODEL_FAST for the main provider, and <PROVIDER>_MODEL and <PROVIDER>_MODEL_FAST
// for each fallback.

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

type Models = { main?: string; fast?: string };

function modelsFor(name: LlmProvider, env: Env): Models {
  if (name === env.LLM_PROVIDER) return { main: env.LLM_MODEL, fast: env.LLM_MODEL_FAST };
  switch (name) {
    case "google":
      return { main: env.GOOGLE_MODEL, fast: env.GOOGLE_MODEL_FAST };
    case "groq":
      return { main: env.GROQ_MODEL, fast: env.GROQ_MODEL_FAST };
    case "openai-compatible":
      return { main: env.OPENAI_COMPATIBLE_MODEL, fast: env.OPENAI_COMPATIBLE_MODEL_FAST };
    default:
      return {};
  }
}

// OpenRouter is the usual OpenAI-compatible endpoint here, so name it properly in the trace.
function compatibleLabel(baseUrl: string): string {
  return baseUrl.includes("openrouter.ai") ? "OpenRouter" : "the backup model";
}

// Only the providers we hold keys for are installed. Anything else is accepted by the env schema so a provider
// can be added later, but until its package is installed it is skipped with a note.
function build(name: LlmProvider, env: Env): ProviderEntry | { skipped: string } {
  const models = modelsFor(name, env);
  const handle =
    (create: (id: string) => LanguageModel, options?: (tier: LlmTier) => CallProviderOptions) => (tier: LlmTier) => {
      const id = tier === "main" ? models.main : models.fast;
      return id ? { id, model: create(id), providerOptions: options?.(tier) } : null;
    };
  const missingModels = !models.main || !models.fast;
  const needModels = (label: string) => ({ skipped: `${label} needs its model names set in the environment.` });

  if (name === "google") {
    if (!env.GOOGLE_GENERATIVE_AI_API_KEY) return { skipped: "Gemini has no API key." };
    if (missingModels) return needModels("Gemini");
    const google = createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY });
    // Gemini 3 models think before answering, and left alone a model took 34 s for a one-line answer. Agent routes
    // must finish in 60 s, so the thinking level is capped (and set per tier in the environment).
    const thinking = (tier: LlmTier): CallProviderOptions => ({
      google: { thinkingConfig: { thinkingLevel: tier === "main" ? env.LLM_THINKING_MAIN : env.LLM_THINKING_FAST } },
    });
    return { name, label: "Gemini", model: handle((id) => google(id), thinking) };
  }
  if (name === "groq") {
    if (!env.GROQ_API_KEY) return { skipped: "Groq has no API key." };
    if (missingModels) return needModels("Groq");
    const groq = createGroq({ apiKey: env.GROQ_API_KEY });
    return { name, label: "Groq", model: handle((id) => groq(id)) };
  }
  if (name === "openai-compatible") {
    if (!env.OPENAI_COMPATIBLE_API_KEY || !env.OPENAI_COMPATIBLE_BASE_URL) return { skipped: "The OpenAI-compatible endpoint has no key or URL." };
    if (missingModels) return needModels("The OpenAI-compatible endpoint");
    const compatible = createOpenAICompatible({
      name: "openai-compatible",
      baseURL: env.OPENAI_COMPATIBLE_BASE_URL,
      apiKey: env.OPENAI_COMPATIBLE_API_KEY,
      supportsStructuredOutputs: true,
    });
    return { name, label: compatibleLabel(env.OPENAI_COMPATIBLE_BASE_URL), model: handle((id) => compatible(id)) };
  }
  return { skipped: `${name} is not installed in this build.` };
}

export function resolveProviders(env: Env): { providers: ProviderEntry[]; notes: string[] } {
  const providers: ProviderEntry[] = [];
  const notes: string[] = [];
  const chain = [env.LLM_PROVIDER, ...env.LLM_FALLBACK_PROVIDERS];
  for (const name of new Set(chain)) {
    const entry = build(name, env);
    if ("skipped" in entry) notes.push(entry.skipped);
    else providers.push(entry);
  }
  return { providers, notes };
}
