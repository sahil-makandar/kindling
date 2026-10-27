import { getDb } from "@/src/db/client";
import { baselineStage } from "./baseline/repo";
import { designStage } from "./designer/repo";
import { createDbRunRepo } from "./runRepo";
import { createRunner } from "./runStage";
import { scoutStage } from "./scout/repo";
import { locateStage } from "./venueRepo";
import { verifyStage } from "./verifier/repo";

// The real pipeline: every stage wired to the database, the Qloo client and the language model.
// Built on first use and kept on globalThis so a dev server reload does not make a second one.

type Runner = ReturnType<typeof createRunner>;
const holder = globalThis as unknown as { __kindlingRunner?: Runner };

export function getRunner(): Runner {
  holder.__kindlingRunner ??= createRunner({
    repo: createDbRunRepo(getDb()),
    stages: { locate: locateStage, scout: scoutStage, design: designStage, verify: verifyStage, baseline: baselineStage },
  });
  return holder.__kindlingRunner;
}

export function advanceRun(runId: string) {
  return getRunner().advanceRun(runId);
}
