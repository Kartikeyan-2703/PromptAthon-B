import bcrypt from "bcryptjs";
import { Prisma } from "../../generated/prisma/client.js";
import { AdminStatus, ParticipantStatus, TeamStatus } from "../../generated/prisma/enums.js";
import { normalizeEmail, normalizeTeamCode } from "../../lib/crypto.js";
import { conflict, forbidden, unauthorized } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../services/audit-service.js";
import { issueSession } from "../../services/session-service.js";

type RequestContext = { requestId?: string; ipAddress?: string; userAgent?: string };

const describeDevice = (userAgent?: string | null) => {
  if (!userAgent) return "Unknown device";
  const browser = /Edg\//.test(userAgent) ? "Edge" : /Chrome\//.test(userAgent) ? "Chrome" : /Firefox\//.test(userAgent) ? "Firefox" : /Safari\//.test(userAgent) ? "Safari" : "Other browser";
  const platform = /Android/.test(userAgent) ? "Android" : /iPhone|iPad/.test(userAgent) ? "iOS" : /Windows/.test(userAgent) ? "Windows" : /Mac OS/.test(userAgent) ? "macOS" : /Linux/.test(userAgent) ? "Linux" : "Unknown OS";
  return `${browser} / ${platform}`;
};

export const verifyParticipantEmail = async (rawEmail: string) => {
  const email = normalizeEmail(rawEmail);
  const participant = await prisma.participant.findFirst({
    where: {
      email,
      deletedAt: null,
      status: { in: [ParticipantStatus.ADMITTED, ParticipantStatus.ACTIVE] },
    },
    select: { id: true },
  });

  return { eligible: Boolean(participant), next: participant ? "TEAM_CODE" : null };
};

export const loginParticipant = async (rawEmail: string, rawTeamCode: string, context: RequestContext) => {
  const email = normalizeEmail(rawEmail);
  const teamCode = normalizeTeamCode(rawTeamCode);

  const [participant, team] = await Promise.all([
    prisma.participant.findFirst({
      where: { email, deletedAt: null },
      include: { membership: true },
    }),
    prisma.team.findFirst({
      where: { code: teamCode, deletedAt: null, status: TeamStatus.ACTIVE },
      select: { id: true, onboardedAt: true },
    }),
  ]);

  if (!participant || !team) {
    throw unauthorized("The email or team code is not valid.");
  }
  if (participant.status !== ParticipantStatus.ADMITTED && participant.status !== ParticipantStatus.ACTIVE) {
    throw forbidden("This participant account is not active.");
  }
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${participant.id}, 0))`;
      const current = await tx.participant.findUniqueOrThrow({
        where: { id: participant.id },
        include: { membership: true },
      });

      if (current.membership && current.membership.teamId !== team.id) {
        const targetSize = await tx.teamMember.count({ where: { teamId: team.id } });
        if (targetSize >= 3) {
          throw conflict("TEAM_SIZE_EXCEEDED", "The supplied team already has three participants.");
        }

        // The organizer-issued team code is the authoritative team identity.
        // Existing admitted rows can retain an older membership after a roster
        // correction/import; reconcile that stale link instead of locking the
        // participant out of the event.
        const previousTeamId = current.membership.teamId;
        await tx.teamMember.update({
          where: { participantId: current.id },
          data: { teamId: team.id },
        });
        await writeAuditLog(tx, {
          actor: { type: "participant", id: current.id },
          action: "participant.team_membership.reconciled",
          entityType: "participant",
          entityId: current.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { previousTeamId, teamId: team.id, teamCode },
        });
      }

      if (!current.membership) {
        await tx.teamMember.create({ data: { teamId: team.id, participantId: current.id } });
      }
      if (current.status === ParticipantStatus.ADMITTED) {
        await tx.participant.update({
          where: { id: current.id },
          data: { status: ParticipantStatus.ACTIVE },
        });
      }

      const previousSessions = await tx.authSession.findMany({
        where: { participantId: current.id, isActive: true },
        select: { id: true, userAgent: true, ipAddress: true, createdAt: true },
      });
      if (previousSessions.length) {
        await tx.authSession.updateMany({
          where: { participantId: current.id, isActive: true },
          data: { isActive: false, revokedAt: new Date(), revokedReason: "NEW_LOGIN" },
        });
      }

      const session = await issueSession(
        tx,
        { kind: "participant", participantId: current.id },
        context,
      );
      if (previousSessions.length) {
        await tx.authSession.updateMany({
          where: { id: { in: previousSessions.map((item) => item.id) } },
          data: { replacedBySessionId: session.id },
        });
        await writeAuditLog(tx, {
          actor: { type: "participant", id: current.id },
          action: "SESSION_REPLACED",
          entityType: "participant_session",
          entityId: current.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: {
            participantEmail: email,
            previousSessionIds: previousSessions.map((item) => item.id),
            newSessionId: session.id,
            previousDevices: previousSessions.map((item) => describeDevice(item.userAgent)),
            newDevice: describeDevice(context.userAgent),
            action: "Previous session invalidated",
            reason: "NEW_LOGIN",
          },
        });
      }
      await writeAuditLog(tx, {
        actor: { type: "participant", id: current.id },
        action: "auth.participant.login",
        entityType: "participant",
        entityId: current.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { teamId: team.id },
      });

      return {
        session,
        principal: { kind: "participant" as const, participantId: current.id, teamId: team.id, email, teamDetailsRequired: team.onboardedAt === null },
      };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
};

export const loginAdmin = async (rawEmail: string, password: string, context: RequestContext) => {
  const email = normalizeEmail(rawEmail);
  const admin = await prisma.adminUser.findUnique({ where: { email } });

  if (!admin || admin.status !== AdminStatus.ACTIVE || !(await bcrypt.compare(password, admin.passwordHash))) {
    throw unauthorized("The administrator credentials are not valid.");
  }

  return prisma.$transaction(async (tx) => {
    await tx.adminUser.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const session = await issueSession(tx, { kind: "admin", adminUserId: admin.id }, context);
    await writeAuditLog(tx, {
      actor: { type: "admin", id: admin.id },
      action: "auth.admin.login",
      entityType: "admin_user",
      entityId: admin.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });
    return {
      session,
      principal: { kind: "admin" as const, adminId: admin.id, email: admin.email },
    };
  });
};

export const logout = async (sessionId: string) => {
  await prisma.authSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date(), isActive: false, revokedReason: "LOGOUT" },
  });
};
