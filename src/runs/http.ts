import { ZodError } from "zod";
import { UserFacingError } from "@/src/lib/errors";

// Shared by every API route: how errors become plain JSON answers. Raw errors and stack traces never leave the server.

// An error with an HTTP status, written for people.
export class HttpError extends UserFacingError {
  constructor(
    public readonly status: number,
    message: string,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...headers },
  });
}

// The caller's address, for rate limits. Behind Vercel the first x-forwarded-for entry is the client.
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip")?.trim() || "unknown";
}

const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export function requireUuid(value: string, what = "run"): string {
  if (!isUuid(value)) throw new HttpError(404, `We could not find that ${what}.`);
  return value;
}

// Runs a route and turns anything that goes wrong into a plain answer.
export async function handleRoute(work: () => Promise<Response>): Promise<Response> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HttpError) {
      const retry: Record<string, string> =
        typeof error.extra.retryAfterSeconds === "number" ? { "retry-after": String(error.extra.retryAfterSeconds) } : {};
      return json({ error: error.message, ...error.extra }, error.status, retry);
    }
    if (error instanceof ZodError) {
      const first = error.issues[0];
      const where = first?.path.length ? `${first.path.join(".")}: ` : "";
      return json({ error: `${where}${first?.message ?? "That input is not valid."}` }, 400);
    }
    if (error instanceof UserFacingError) return json({ error: error.message }, 502);
    console.error("Unexpected error in a route:", error instanceof Error ? error.message : error);
    return json({ error: "Something went wrong on our side. Please try again." }, 500);
  }
}
