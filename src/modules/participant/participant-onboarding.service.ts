import { Prisma } from "../../generated/prisma/client.js";
import { ApiError, conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../services/audit-service.js";

export const getTeamOnboarding = async (teamId: string) => {
  const team = await prisma.team.findFirst({
    where: { id: teamId, deletedAt: null },
    select: {
      id: true,
      code: true,
      onboardedAt: true,
      rosterMembers: { orderBy: { position: "asc" }, select: { id: true, position: true, name: true } },
    },
  });
  if (!team) throw notFound("Team");
  return { required: team.onboardedAt === null, teamCode: team.code, completedAt: team.onboardedAt, members: team.rosterMembers };
};

export const completeTeamOnboarding = async (
  participantId: string,
  teamId: string,
  memberNames: string[],
  requestId?: string,
) => prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${teamId}, 0))`;
  const team = await tx.team.findFirst({ where: { id: teamId, deletedAt: null }, select: { id: true, code: true, onboardedAt: true } });
  if (!team) throw notFound("Team");
  if (team.onboardedAt) throw conflict("TEAM_DETAILS_ALREADY_COMPLETED", "Team details have already been completed.");

  const claimed = await tx.team.updateMany({ where: { id: teamId, onboardedAt: null }, data: { onboardedAt: new Date() } });
  if (claimed.count !== 1) throw conflict("TEAM_DETAILS_ALREADY_COMPLETED", "Team details have already been completed.");

  await tx.teamRosterMember.createMany({
    data: memberNames.map((name, index) => ({ teamId, position: index + 1, name })),
  });
  await writeAuditLog(tx, {
    actor: { type: "participant", id: participantId },
    action: "team.onboarding.completed",
    entityType: "team",
    entityId: teamId,
    requestId,
    metadata: { teamCode: team.code, memberCount: memberNames.length },
  });
  return getTeamOnboardingWithTransaction(tx, teamId);
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

const getTeamOnboardingWithTransaction = async (tx: Prisma.TransactionClient, teamId: string) => {
  const team = await tx.team.findUniqueOrThrow({
    where: { id: teamId },
    select: { code: true, onboardedAt: true, rosterMembers: { orderBy: { position: "asc" }, select: { id: true, position: true, name: true } } },
  });
  return { required: false, teamCode: team.code, completedAt: team.onboardedAt, members: team.rosterMembers };
};

export const assertTeamOnboarded = async (teamId: string) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, deletedAt: null }, select: { onboardedAt: true } });
  if (!team) throw notFound("Team");
  if (!team.onboardedAt) throw new ApiError(403, "TEAM_DETAILS_REQUIRED", "Complete your team details before entering the participant portal.");
};
