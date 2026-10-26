import { getDb } from "@/src/db/client";
import type { RunStage, TraceLevel } from "@/src/db/schema";
import { createDbRunRepo, type RunRepo } from "./runRepo";

// Every stage tells the person what it is doing in plain words. These lines are what the run page shows.
// Data is for the evidence panel and debugging; the UI never prints it raw.

export type Tracer = {
  info(message: string, data?: unknown): Promise<void>;
  warn(message: string, data?: unknown): Promise<void>;
  error(message: string, data?: unknown): Promise<void>;
};

export function createTracer(repo: Pick<RunRepo, "addTrace">, runId: string, stage: RunStage): Tracer {
  // A failed trace write must never take a stage down with it.
  const write = async (level: TraceLevel, message: string, data?: unknown) => {
    try {
      await repo.addTrace(runId, stage, level, message, data);
    } catch {
      // Nothing useful to do if the log itself is broken.
    }
  };
  return {
    info: (message, data) => write("info", message, data),
    warn: (message, data) => write("warn", message, data),
    error: (message, data) => write("error", message, data),
  };
}

export async function trace(
  runId: string,
  stage: RunStage,
  level: TraceLevel,
  message: string,
  data?: unknown,
): Promise<void> {
  await createDbRunRepo(getDb()).addTrace(runId, stage, level, message, data);
}
