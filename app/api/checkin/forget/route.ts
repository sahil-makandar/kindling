import { clearDeviceCookie } from "@/src/checkin/cookie";
import { forgetByCheckin } from "@/src/checkin/repo";
import { getDb } from "@/src/db/client";
import { handleRoute, HttpError, json, requireUuid } from "@/src/runs/http";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

// "Forget me": deletes the guest and all their check-ins. The check-in id from the confirmation screen is the proof.
export function POST(request: Request) {
  return handleRoute(async () => {
    const body = (await request.json().catch(() => {
      throw new HttpError(400, "Send the check-in id as JSON.");
    })) as { checkinId?: unknown };
    const id = requireUuid(typeof body.checkinId === "string" ? body.checkinId : "", "check-in");
    await forgetByCheckin(getDb(), id);
    const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
    return json({ forgotten: true }, 200, { "set-cookie": clearDeviceCookie(secure) });
  });
}
