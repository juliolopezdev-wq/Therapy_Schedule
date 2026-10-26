import type { CookieOptions } from "express";

function isSecureRequest(req: any) {
  if (req.protocol === "https") return true;

  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;

  const protoList = Array.isArray(forwardedProto)
    ? forwardedProto
    : forwardedProto.split(",");

  return protoList.some((proto: string) => proto.trim().toLowerCase() === "https");
}

export function getSessionCookieOptions(
  req: any
): CookieOptions {
  const secure = isSecureRequest(req);
  return {
    httpOnly: true,
    path: "/",
    // Login and API traffic are same-origin. Lax still permits the emailed top-level login link
    // while withholding the session cookie from cross-site subrequests.
    sameSite: "lax",
    secure,
  } as CookieOptions;
}
