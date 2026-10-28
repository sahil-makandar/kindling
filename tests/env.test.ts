import { describe, expect, it } from "vitest";
import { EnvError, parseEnv } from "@/src/config/env";

const base = { DATABASE_URL: "postgres://user:pass@host/db" };

function problemsFor(source: Record<string, string | undefined>): string[] {
  try {
    parseEnv(source);
  } catch (e) {
    if (e instanceof EnvError) return e.problems;
    throw e;
  }
  return [];
}

describe("parseEnv", () => {
  it("runs in fixtures and mock mode without any API keys", () => {
    const env = parseEnv(base);
    expect(env.QLOO_MODE).toBe("fixtures");
    expect(env.LLM_MODE).toBe("mock");
    expect(env.QLOO_API_KEY).toBeUndefined();
  });

  it("applies the documented defaults", () => {
    const env = parseEnv(base);
    expect(env.QLOO_BASE_URL).toBe("https://hackathon.api.qloo.com");
    expect(env.LLM_PROVIDER).toBe("google");
    expect(env.RATE_LIMIT_PER_HOUR).toBe(30);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.NOMINATIM_USER_AGENT).toContain("github.com");
  });

  it("treats blank values from .env files as not set", () => {
    const env = parseEnv({ ...base, QLOO_API_KEY: "", RATE_LIMIT_PER_HOUR: "", LLM_FALLBACK_PROVIDERS: "" });
    expect(env.QLOO_API_KEY).toBeUndefined();
    expect(env.RATE_LIMIT_PER_HOUR).toBe(30);
    expect(env.LLM_FALLBACK_PROVIDERS).toEqual([]);
  });

  it("reads RATE_LIMIT_PER_HOUR as a number", () => {
    expect(parseEnv({ ...base, RATE_LIMIT_PER_HOUR: "25" }).RATE_LIMIT_PER_HOUR).toBe(25);
  });

  it("fails with a readable message when DATABASE_URL is missing", () => {
    expect(problemsFor({})).toEqual(["DATABASE_URL: missing"]);
    expect(() => parseEnv({})).toThrow(/Copy \.env\.example to \.env\.local/);
  });

  it("requires the Qloo key in live and record modes", () => {
    for (const mode of ["live", "record"]) {
      expect(problemsFor({ ...base, QLOO_MODE: mode })).toEqual([
        `QLOO_API_KEY: required when QLOO_MODE=${mode}`,
      ]);
      expect(parseEnv({ ...base, QLOO_MODE: mode, QLOO_API_KEY: "k" }).QLOO_MODE).toBe(mode);
    }
  });

  it("rejects an unknown mode", () => {
    expect(problemsFor({ ...base, QLOO_MODE: "sometimes" })[0]).toMatch(/^QLOO_MODE:/);
  });

  it("requires the provider key and both models when LLM_MODE=live", () => {
    expect(problemsFor({ ...base, LLM_MODE: "live" }).sort()).toEqual([
      "GOOGLE_GENERATIVE_AI_API_KEY: required when LLM_MODE=live and LLM_PROVIDER=google",
      "LLM_MODEL: required when LLM_MODE=live",
      "LLM_MODEL_FAST: required when LLM_MODE=live",
    ]);
    const ok = parseEnv({
      ...base,
      LLM_MODE: "live",
      GOOGLE_GENERATIVE_AI_API_KEY: "k",
      LLM_MODEL: "m",
      LLM_MODEL_FAST: "f",
    });
    expect(ok.LLM_MODE).toBe("live");
  });

  it("checks the key that matches the chosen provider", () => {
    const live = { ...base, LLM_MODE: "live", LLM_MODEL: "m", LLM_MODEL_FAST: "f" };
    expect(problemsFor({ ...live, LLM_PROVIDER: "groq", GOOGLE_GENERATIVE_AI_API_KEY: "k" })).toEqual([
      "GROQ_API_KEY: required when LLM_MODE=live and LLM_PROVIDER=groq",
    ]);
    expect(problemsFor({ ...live, LLM_PROVIDER: "xai" })).toHaveLength(1);
    expect(problemsFor({ ...live, LLM_PROVIDER: "anthropic" })).toHaveLength(1);
    expect(problemsFor({ ...live, LLM_PROVIDER: "groq", GROQ_API_KEY: "k" })).toEqual([]);
  });

  it("needs both a key and a base URL for an OpenAI-compatible provider", () => {
    const live = { ...base, LLM_MODE: "live", LLM_MODEL: "m", LLM_MODEL_FAST: "f", LLM_PROVIDER: "openai-compatible" };
    expect(problemsFor(live)).toHaveLength(2);
    expect(
      problemsFor({ ...live, OPENAI_COMPATIBLE_API_KEY: "k", OPENAI_COMPATIBLE_BASE_URL: "https://api.example.com/v1" }),
    ).toEqual([]);
  });

  it("does not ask for LLM keys in mock mode", () => {
    expect(problemsFor({ ...base, LLM_PROVIDER: "anthropic" })).toEqual([]);
  });

  it("never puts secret values in the error message", () => {
    try {
      parseEnv({ QLOO_MODE: "live", QLOO_API_KEY: "", GROQ_API_KEY: "super-secret-value" });
    } catch (e) {
      expect((e as Error).message).not.toContain("super-secret-value");
    }
  });
});
