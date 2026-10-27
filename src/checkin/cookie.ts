// The first-party device cookie that recognises a returning guest, set only after they tick the consent box.
export const DEVICE_COOKIE = "device_token";
const YEAR_SECONDS = 60 * 60 * 24 * 365;

export function readDeviceToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === DEVICE_COOKIE) {
      const value = rest.join("=").trim();
      return /^[0-9a-f-]{36}$/i.test(value) ? value : null;
    }
  }
  return null;
}

export function deviceCookie(token: string, secure: boolean): string {
  return `${DEVICE_COOKIE}=${token}; Path=/; Max-Age=${YEAR_SECONDS}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export function clearDeviceCookie(secure: boolean): string {
  return `${DEVICE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}
