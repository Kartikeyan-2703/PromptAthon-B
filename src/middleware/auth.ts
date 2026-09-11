import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { sha256 } from "../lib/crypto.js";
import { ApiError, forbidden, unauthorized } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { AdminStatus, ParticipantStatus } from "../generated/prisma/enums.js";

export const authenticate: RequestHandler = async (request, _response, next) => {
  const token = request.cookies?.[env.SESSION_COOKIE_NAME] as string | undefined;
  if (!token) {
    next();
    return;
  }

  const session = await prisma.authSession.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      adminUser: true,
      participant: { include: { membership: true } },
    },
  });

  if (!session) {
    next();
    return;
  }

  if (session.revokedAt || !session.isActive || session.expiresAt <= new Date()) {
    if (session.participantId && session.revokedReason === "NEW_LOGIN") {
      request.participantSessionFailure = "SESSION_REPLACED";
    }
    next();
    return;
  }

  if (session.adminUser?.status === AdminStatus.ACTIVE) {
    request.auth = {
      kind: "admin",
      sessionId: session.id,
      adminId: session.adminUser.id,
      email: session.adminUser.email,
      status: session.adminUser.status,
    };
  } else if (
    session.participant &&
    session.participant.membership &&
    session.participant.deletedAt === null &&
    (session.participant.status === ParticipantStatus.ACTIVE ||
      session.participant.status === ParticipantStatus.ADMITTED)
  ) {
    request.auth = {
      kind: "participant",
      sessionId: session.id,
      participantId: session.participant.id,
      email: session.participant.email,
      status: session.participant.status,
      teamId: session.participant.membership.teamId,
    };
  }

  next();
};

export const requireAdmin: RequestHandler = (request, _response, next) => {
  if (!request.auth) {
    next(unauthorized());
    return;
  }
  if (request.auth.kind !== "admin") {
    next(forbidden("Administrator access is required."));
    return;
  }
  next();
};

export const requireParticipant: RequestHandler = (request, _response, next) => {
  if (!request.auth) {
    if (request.participantSessionFailure === "SESSION_REPLACED") {
      next(new ApiError(401, "SESSION_REPLACED", "Your account was signed in on another device."));
      return;
    }
    next(unauthorized());
    return;
  }
  if (request.auth.kind !== "participant") {
    next(forbidden("Participant access is required."));
    return;
  }
  next();
};
