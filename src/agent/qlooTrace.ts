import type { Tracer } from "./trace";

// Qloo silently ignores parameters it does not understand, so an empty answer can simply mean a bad
// parameter. Whenever a call comes back empty, the trace says exactly what was sent. (The same parameters
// are always stored in the qloo_calls table.)
export async function traceEmptyResult(
  trace: Tracer,
  label: string,
  sent: { endpoint: string; params: Record<string, string> },
): Promise<void> {
  const list = Object.entries(sent.params)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  await trace.warn(
    `Qloo returned nothing for ${label}. It ignores parameters it does not understand, so this can mean a bad one. Sent ${sent.endpoint} with ${list}.`,
    { endpoint: sent.endpoint, params: sent.params },
  );
}
