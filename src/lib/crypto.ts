import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export const normalizeTeamCode = (code: string) => code.trim().toUpperCase().replace(/\s+/g, "");
export const sha256 = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const createSessionToken = () => randomBytes(32).toString("base64url");
export const createTeamAccessCode = () => `PRM-${randomBytes(6).toString("base64url").toUpperCase()}`;

export const safeEqual = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
