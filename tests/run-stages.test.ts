import { describe, expect, it } from "vitest";
import { createMemoryRunRepo } from "@/src/agent/runRepo";
import {
  createRunner,
  describeFailure,
  nextStage,
  STAGE_CRITICAL,
  STAGE_ORDER,
  type RunnableStage,
  type StageFn,
} from "@/src/agent/runStage";
import { QlooError } from "@/src/qloo/client";
import { GeocodeError } from "@/src/geo/geocode";

// Stub stages that record the order they ran in.
function setup(overrides: Partial<Record<RunnableStage, StageFn>> = {}, staleAfterMs?: number) {
  let clock = 1_000_000;
  const repo = createMemoryRunRepo(() => clock);
  const order: RunnableStage[] = [];
  const stages = Object.fromEntries(
    STAGE_ORDER.map((name) => [
      name,
      overrides[name] ??
        (async ({ trace }) => {
          order.push(name);
          await trace.info(`${name} did its work`);
        }),
    ]),
  ) as Record<RunnableStage, StageFn>;
  const { advanceRun } = createRunner({ repo, stages, staleAfterMs });
  const run = repo.addRun();
  return { repo, run, order, advanceRun, tick: (ms: number) => (clock += ms) };
}

describe("stage order", () => {
  it("is locate, scout, design, verify, baseline, then done", () => {
    expect(STAGE_ORDER).toEqual(["locate", "scout", "design", "verify", "baseline"]);
    expect(nextStage("locate")).toBe("scout");
    expect(nextStage("baseline")).toBe("done");
  });

  it("runs exactly one stage per call, in order", async () => {
    const { run, order, advanceRun, repo } = setup();
    const seen: Array<[string | null, string, string]> = [];
    for (let i = 0; i < 5; i++) {
      const result = await advanceRun(run.id);
      seen.push([result.ran, result.stage, result.status]);
      expect(order).toHaveLength(i + 1);
    }
    expect(order).toEqual(["locate", "scout", "design", "verify", "baseline"]);
    expect(seen).toEqual([
      ["locate", "scout", "pending"],
      ["scout", "design", "pending"],
      ["design", "verify", "pending"],
      ["verify", "baseline", "pending"],
      ["baseline", "done", "done"],
    ]);
    expect(repo.runs.get(run.id)?.finishedAt).not.toBeNull();
  });

  it("starts a stage with status running and clears the marker when it finishes", async () => {
    let statusDuringStage: string | undefined;
    const { run, advanceRun, repo } = setup({
      locate: async () => {
        statusDuringStage = repo.runs.get(run.id)?.status;
      },
    });
    await advanceRun(run.id);
    expect(statusDuringStage).toBe("running");
    expect(repo.runs.get(run.id)?.stageStartedAt).toBeNull();
  });

  it("writes stage trace lines tagged with the stage that wrote them", async () => {
    const { run, advanceRun, repo } = setup();
    await advanceRun(run.id);
    await advanceRun(run.id);
    expect(repo.traces.map((t) => [t.stage, t.level, t.message])).toEqual([
      ["locate", "info", "locate did its work"],
      ["scout", "info", "scout did its work"],
    ]);
  });
});

describe("idempotency", () => {
  it("does nothing when advanced after the run is done", async () => {
    const { run, order, advanceRun } = setup();
    for (let i = 0; i < 5; i++) await advanceRun(run.id);
    const again = await advanceRun(run.id);
    expect(again).toMatchObject({ ran: null, reason: "done", status: "done", stage: "done" });
    expect(order).toHaveLength(5);
  });

  it("runs a stage once when two requests arrive together", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let runs = 0;
    const { run, advanceRun } = setup({
      locate: async () => {
        runs += 1;
        await gate;
      },
    });
    const first = advanceRun(run.id);
    const second = await advanceRun(run.id);
    expect(second).toMatchObject({ ran: null, reason: "busy", status: "running" });
    release();
    expect((await first).ran).toBe("locate");
    expect(runs).toBe(1);
  });

  it("reclaims a stage that has been running for too long", async () => {
    const { run, advanceRun, repo, tick } = setup({}, 90_000);
    // Simulate a request that died mid-stage: status stuck at running.
    repo.runs.set(run.id, { ...run, status: "running", stageStartedAt: new Date(1_000_000) });
    tick(60_000);
    expect(await advanceRun(run.id)).toMatchObject({ ran: null, reason: "busy" });
    tick(31_000);
    expect(await advanceRun(run.id)).toMatchObject({ ran: "locate" });
  });

  it("reports a missing run", async () => {
    const { advanceRun } = setup();
    expect(await advanceRun("nope")).toMatchObject({ ran: null, reason: "missing" });
  });
});

describe("errors", () => {
  it("skips a failed non-critical stage and still finishes the run", async () => {
    const { run, order, advanceRun, repo } = setup({
      baseline: async () => {
        throw new Error("model exploded at line 42");
      },
    });
    let last = await advanceRun(run.id);
    while (last.status === "pending") last = await advanceRun(run.id);

    expect(last).toMatchObject({ status: "done", stage: "done", ran: "baseline" });
    expect(order).toEqual(["locate", "scout", "design", "verify"]);
    const errors = repo.traces.filter((t) => t.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].stage).toBe("baseline");
    expect(errors[0].message).toContain("Carrying on without it.");
  });

  it("carries on after every non-critical stage fails", async () => {
    const boom = async () => {
      throw new Error("x");
    };
    const { run, advanceRun } = setup({ locate: boom, verify: boom, baseline: boom });
    let last = await advanceRun(run.id);
    while (last.status === "pending") last = await advanceRun(run.id);
    expect(last.status).toBe("done");
  });

  it("stops the run when a critical stage fails, and keeps the message", async () => {
    const { run, order, advanceRun, repo } = setup({
      scout: async () => {
        throw new Error("boom");
      },
    });
    await advanceRun(run.id);
    const failed = await advanceRun(run.id);
    expect(failed).toMatchObject({ ran: "scout", status: "error", stage: "scout" });
    expect(failed.error).toBe(
      "Something went wrong while reading the neighbourhood. The run stopped here. Everything found so far is kept.",
    );
    expect(repo.runs.get(run.id)?.finishedAt).not.toBeNull();

    const again = await advanceRun(run.id);
    expect(again).toMatchObject({ ran: null, reason: "error" });
    expect(order).toEqual(["locate"]);
  });

  it("never puts raw error text or a stack trace in the message", async () => {
    const { run, advanceRun, repo } = setup({
      design: async () => {
        throw new Error("secret internal detail at /srv/app/agent.ts:99");
      },
    });
    await advanceRun(run.id);
    await advanceRun(run.id);
    const failed = await advanceRun(run.id);
    expect(failed.error).not.toContain("secret internal detail");
    expect(failed.error).not.toContain("/srv/app");
    const trace = repo.traces.find((t) => t.level === "error");
    expect(trace?.message).not.toContain("secret internal detail");
    // The detail is kept in trace data for debugging only.
    expect(JSON.stringify(trace?.data)).toContain("secret internal detail");
  });

  it("shows the message of errors written for people", async () => {
    const { run, advanceRun } = setup({
      scout: async () => {
        throw new QlooError("Qloo took too long to answer.", 0);
      },
    });
    await advanceRun(run.id);
    const failed = await advanceRun(run.id);
    expect(failed.error).toBe("Qloo took too long to answer. The run stopped here. Everything found so far is kept.");
  });

  it("keeps the run going if the trace log itself is broken", async () => {
    const { run, advanceRun, repo } = setup();
    repo.addTrace = async () => {
      throw new Error("db down");
    };
    expect(await advanceRun(run.id)).toMatchObject({ ran: "locate", status: "pending", stage: "scout" });
  });
});

describe("describeFailure", () => {
  it("names the step in generic messages", () => {
    expect(describeFailure("verify", new Error("x"))).toBe(
      "Something went wrong while checking the clubs. Carrying on without it.",
    );
  });

  it("passes through geocoder messages", () => {
    expect(describeFailure("locate", new GeocodeError("The address lookup is busy. Try again in a minute."))).toContain(
      "The address lookup is busy.",
    );
  });

  it("marks only scout and design as critical", () => {
    expect(Object.entries(STAGE_CRITICAL).filter(([, critical]) => critical).map(([name]) => name)).toEqual([
      "scout",
      "design",
    ]);
  });
});
