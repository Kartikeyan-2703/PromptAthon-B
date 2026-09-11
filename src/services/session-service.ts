import type { Response } from "express";
import type { Prisma } from "../generated/prisma/client.js";
import { env } from "../config/env.js";
import { createSessionToken, sha256 } from "../lib/crypto.js";

type DbClient = Prisma.TransactionClient;

type SessionPrincipal =
  | { kind: "admin"; adminUserId: string }
  | { kind: "participant"; participantId: string };

export const issueSession = async (
  db: DbClient,
  principal: SessionPrincipal,
  context: { ipAddress?: string; userAgent?: string },
) => {
  const token = createSessionToken();
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_HOURS * 60 * 60 * 1000);

  const session = await db.authSession.create({
    data: {
      tokenHash: sha256(token),
      adminUserId: principal.kind === "admin" ? principal.adminUserId : null,
      participantId: principal.kind === "participant" ? principal.participantId : null,
      expiresAt,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent?.slice(0, 512),
    },
  });

  return { id: session.id, token, expiresAt };
};

export const setSessionCookie = (response: Response, token: string, expiresAt: Date) => {
  response.cookie(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.isProduction,
    // The production frontend and API are hosted on different origins
    // (Cloudflare and Render), so the session cookie must be cross-site there.
    sameSite: env.isProduction ? "none" : "lax",
    path: "/",
    expires: expiresAt,
  });
};

export const clearSessionCookie = (response: Response) => {
  response.clearCookie(env.SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    path: "/",
  });
};
