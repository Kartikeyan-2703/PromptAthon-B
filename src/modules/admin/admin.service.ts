import { Prisma } from "../../generated/prisma/client.js";
import {
  EvaluationDecision,
  EventStatus,
  ImportRowStatus,
  ImportStatus,
  ParticipantStatus,
  QuestionStatus,
  RoundKind,
  RoundStatus,
  SubmissionStatus,
  TeamRoundStatus,
  TeamStatus,
} from "../../generated/prisma/enums.js";
import { createTeamAccessCode, normalizeEmail, normalizeTeamCode } from "../../lib/crypto.js";
import { badRequest, conflict, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../services/audit-service.js";
import { buildRoundOneAssignments } from "./question-assignment.js";
import { ensureCertificatesForEliminatedTeam } from "../../services/certificate-service.js";
import { removePrivateArtifact } from "../../services/storage-service.js";

type RequestContext = { requestId?: string; ipAddress?: string; userAgent?: string };

const nextTeamCode = (codes: string[]) => {
  const highest = codes.reduce((maximum, code) => {
    const match = /^PROM-2026(\d{3})$/.exec(code);
    return match ? Math.max(maximum, Number(match[1])) : maximum;
  }, 0);
  if (highest >= 999) throw conflict("TEAM_CODE_EXHAUSTED", "The PROM-2026 team-code sequence is exhausted.");
  return `PROM-2026${String(highest + 1).padStart(3, "0")}`;
};

const provisionTeam = async (tx: Prisma.TransactionClient, eventId: string, teamId: string) => {
  const rounds = await tx.round.findMany({ where: { eventId }, orderBy: { number: "asc" } });
  await tx.teamRoundAccess.createMany({ data: rounds.map((round) => ({ teamId, roundId: round.id, status: round.number === 1 ? TeamRoundStatus.ELIGIBLE : TeamRoundStatus.LOCKED, unlockedAt: round.number === 1 ? new Date() : null })), skipDuplicates: true });
};

export const suggestManualTeamCode = async (eventId: string) => {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw notFound("Event");
  const teams = await prisma.team.findMany({ where: { eventId }, select: { code: true } });
  return { teamCode: nextTeamCode(teams.map((team) => team.code)) };
};

export const createManualParticipant = async (adminId: string, input: { eventId: string; name: string; email: string; teamCode?: string }, context: RequestContext) => prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.eventId}, 0))`;
  const event = await tx.event.findUnique({ where: { id: input.eventId }, select: { id: true } });
  if (!event) throw notFound("Event");
  const email = normalizeEmail(input.email);
  if (await tx.participant.findUnique({ where: { email } })) throw conflict("PARTICIPANT_EXISTS", "A participant with this email already exists.");
  const code = input.teamCode ? normalizeTeamCode(input.teamCode) : nextTeamCode((await tx.team.findMany({ where: { eventId: input.eventId }, select: { code: true } })).map((team) => team.code));
  const existingTeam = await tx.team.findUnique({ where: { code } });
  if (existingTeam && existingTeam.eventId !== input.eventId) throw conflict("TEAM_CODE_EVENT_CONFLICT", "That Team Code belongs to another event.");
  const team = existingTeam ?? await tx.team.create({ data: { eventId: input.eventId, code } });
  if (await tx.teamMember.count({ where: { teamId: team.id } }) >= 3) throw conflict("TEAM_FULL", "That team already has three members.");
  const participant = await tx.participant.create({ data: { name: input.name.trim(), email } });
  await tx.teamMember.create({ data: { teamId: team.id, participantId: participant.id } });
  await provisionTeam(tx, input.eventId, team.id);
  const liveRound = await tx.round.findFirst({ where: { eventId: input.eventId, status: RoundStatus.LIVE } });
  if (liveRound && liveRound.kind !== RoundKind.PROMPT_REVERSE_ENGINEERING) {
    const assignmentCount = await tx.teamQuestionAssignment.count({ where: { teamId: team.id, roundId: liveRound.id } });
    if (assignmentCount === 0) await assignPublishedQuestions(tx, liveRound.id, [team.id]);
  }
  await writeAuditLog(tx, { actor: { type: "admin", id: adminId }, action: "participant.manual.created", entityType: "participant", entityId: participant.id, requestId: context.requestId, metadata: { teamCode: code } });
  return { ...participant, team: { id: team.id, code: team.code } };
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });

export const getDashboard = async () => {
  const event = await prisma.event.findFirst({ orderBy: { startsAt: "desc" } });
  if (!event) return { event: null, metrics: null, rounds: [] };

  const [admitted, active, submitted, approved, pending, rounds] = await Promise.all([
    prisma.participant.count({ where: { deletedAt: null } }),
    prisma.participant.count({ where: { deletedAt: null, status: ParticipantStatus.ACTIVE } }),
    prisma.submission.count({ where: { team: { eventId: event.id }, status: { not: SubmissionStatus.DRAFT } } }),
    prisma.submission.count({ where: { team: { eventId: event.id }, status: SubmissionStatus.APPROVED } }),
    prisma.submission.count({
      where: { team: { eventId: event.id }, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] } },
    }),
    prisma.round.findMany({
      where: { eventId: event.id },
      orderBy: { number: "asc" },
      include: {
        _count: { select: { submissions: true, accesses: true } },
      },
    }),
  ]);

  return { event, metrics: { admitted, active, submitted, approved, pending }, rounds };
};

export const listParticipants = async (query: {
  page: number;
  pageSize: number;
  search?: string;
  status?: string;
}) => {
  const where: Prisma.ParticipantWhereInput = {
    deletedAt: null,
    ...(query.search
      ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { email: { contains: query.search, mode: "insensitive" } }] }
      : {}),
    ...(query.status && Object.values(ParticipantStatus).includes(query.status as ParticipantStatus)
      ? { status: query.status as ParticipantStatus }
      : {}),
  };
  const [total, items] = await Promise.all([
    prisma.participant.count({ where }),
    prisma.participant.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: { membership: { include: { team: { select: { id: true, code: true } } } } },
    }),
  ]);
  return { items, page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) };
};

export const getParticipantDetail = async (id: string) => {
  const participant = await prisma.participant.findUnique({
    where: { id },
    include: {
      membership: {
        include: {
          team: {
            include: {
              members: { include: { participant: { select: { id: true, name: true, email: true, status: true } } } },
              rosterMembers: { orderBy: { position: "asc" } },
              certificates: { orderBy: { rosterMember: { position: "asc" } } },
              accesses: { include: { round: true }, orderBy: { round: { number: "asc" } } },
              submissions: {
                include: {
                  round: true,
                  answers: { include: { question: true } },
                  artifacts: true,
                  evaluation: { include: { evaluator: { select: { id: true, displayName: true } } } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!participant || participant.deletedAt) throw notFound("Participant");
  return participant;
};

export const listSubmissions = async (query: {
  page: number;
  pageSize: number;
  roundNumber: number;
  eventId?: string;
  search?: string;
  status?: "SUBMITTED" | "UNDER_REVIEW" | "APPROVED" | "REJECTED";
}) => {
  const event = query.eventId
    ? await prisma.event.findUnique({ where: { id: query.eventId }, select: { id: true } })
    : await prisma.event.findFirst({ orderBy: { startsAt: "desc" }, select: { id: true } });
  if (!event) throw notFound("Event");
  const round = await prisma.round.findUnique({
    where: { eventId_number: { eventId: event.id, number: query.roundNumber } },
    select: { id: true, number: true, title: true, status: true },
  });
  if (!round) throw notFound("Round");
  if (round.number === 1 && (query.status === "APPROVED" || query.status === "REJECTED")) {
    const accessStatus = query.status === "APPROVED" ? TeamRoundStatus.APPROVED : TeamRoundStatus.REJECTED;
    const accessWhere: Prisma.TeamRoundAccessWhereInput = {
      roundId: round.id,
      status: accessStatus,
      team: {
        deletedAt: null,
        ...(query.search ? { code: { contains: query.search, mode: "insensitive" } } : {}),
      },
    };
    const [total, accesses, groupedAccessCounts, groupedSubmissionCounts] = await Promise.all([
      prisma.teamRoundAccess.count({ where: accessWhere }),
      prisma.teamRoundAccess.findMany({
        where: accessWhere,
        orderBy: [{ decidedAt: "desc" }, { id: "desc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          team: {
            select: {
              id: true,
              code: true,
              submissions: {
                where: { roundId: round.id },
                take: 1,
                include: {
                  evaluation: true,
                  _count: { select: { answers: true, artifacts: true } },
                },
              },
            },
          },
        },
      }),
      prisma.teamRoundAccess.groupBy({
        by: ["status"],
        where: { roundId: round.id, team: { deletedAt: null } },
        _count: { _all: true },
      }),
      prisma.submission.groupBy({
        by: ["status"],
        where: { roundId: round.id, status: { in: [SubmissionStatus.SUBMITTED, SubmissionStatus.UNDER_REVIEW] } },
        _count: { _all: true },
      }),
    ]);
    const counts = { SUBMITTED: 0, UNDER_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
    for (const row of groupedAccessCounts) {
      if (row.status === TeamRoundStatus.APPROVED) counts.APPROVED = row._count._all;
      if (row.status === TeamRoundStatus.REJECTED) counts.REJECTED = row._count._all;
    }
    for (const row of groupedSubmissionCounts) {
      if (row.status === SubmissionStatus.SUBMITTED) counts.SUBMITTED = row._count._all;
      if (row.status === SubmissionStatus.UNDER_REVIEW) counts.UNDER_REVIEW = row._count._all;
    }
    const items = accesses.map((access) => {
      const submission = access.team.submissions[0];
      return submission
        ? { ...submission, team: { id: access.team.id, code: access.team.code }, round, hasSubmission: true }
        : {
            id: `access:${access.id}`,
            status: query.status!,
            teamCodeSnapshot: access.team.code,
            aiTool: null,
            submittedAt: null,
            version: access.version,
            team: { id: access.team.id, code: access.team.code },
            round,
            evaluation: null,
            _count: { answers: 0, artifacts: 0 },
            hasSubmission: false,
          };
    });
    return { round, counts, items, page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) };
  }
  const where: Prisma.SubmissionWhereInput = {
    roundId: round.id,
    status: query.status ?? { not: SubmissionStatus.DRAFT },
    ...(query.search
      ? { team: { code: { contains: query.search, mode: "insensitive" } } }
      : {}),
  };
  const [total, items, groupedCounts, groupedAccessCounts] = await Promise.all([
    prisma.submission.count({ where }),
    prisma.submission.findMany({
      where,
      orderBy: [{ submittedAt: "desc" }, { id: "desc" }],
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
      include: {
        team: { select: { id: true, code: true } },
        round: { select: { id: true, number: true, title: true } },
        evaluation: true,
        _count: { select: { answers: true, artifacts: true } },
      },
    }),
    prisma.submission.groupBy({
      by: ["status"],
      where: { roundId: round.id, status: { not: SubmissionStatus.DRAFT } },
      _count: { _all: true },
    }),
    round.number === 1
      ? prisma.teamRoundAccess.groupBy({
          by: ["status"],
          where: { roundId: round.id, team: { deletedAt: null } },
          _count: { _all: true },
        })
      : Promise.resolve([]),
  ]);
  const counts = { SUBMITTED: 0, UNDER_REVIEW: 0, APPROVED: 0, REJECTED: 0 };
  for (const row of groupedCounts) {
    if (row.status !== SubmissionStatus.DRAFT) counts[row.status] = row._count._all;
  }
  if (round.number === 1) {
    counts.APPROVED = 0;
    counts.REJECTED = 0;
    for (const row of groupedAccessCounts) {
      if (row.status === TeamRoundStatus.APPROVED) counts.APPROVED = row._count._all;
      if (row.status === TeamRoundStatus.REJECTED) counts.REJECTED = row._count._all;
    }
  }
  return { round, counts, items: items.map((item) => ({ ...item, hasSubmission: true })), page: query.page, pageSize: query.pageSize, total, pageCount: Math.ceil(total / query.pageSize) };
};

export const markSubmissionUnderReview = async (
  adminId: string,
  submissionId: string,
  expectedVersion: number,
  context: RequestContext,
) => prisma.$transaction(async (tx) => {
  const changed = await tx.submission.updateMany({
    where: { id: submissionId, status: SubmissionStatus.SUBMITTED, version: expectedVersion },
    data: { status: SubmissionStatus.UNDER_REVIEW, version: { increment: 1 } },
  });
  if (changed.count !== 1) {
    const current = await tx.submission.findUnique({ where: { id: submissionId } });
    if (!current) throw notFound("Submission");
    if (current.status === SubmissionStatus.UNDER_REVIEW) return current;
    throw conflict("SUBMISSION_STATE_CONFLICT", "This submission is no longer pending review.", {
      currentStatus: current.status,
      currentVersion: current.version,
    });
  }
  await writeAuditLog(tx, {
    actor: { type: "admin", id: adminId }, action: "submission.under_review",
    entityType: "submission", entityId: submissionId, requestId: context.requestId,
    ipAddress: context.ipAddress, userAgent: context.userAgent,
  });
  return tx.submission.findUniqueOrThrow({ where: { id: submissionId } });
}, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

export const getSubmissionDetail = async (id: string) => {
  const submission = await prisma.submission.findUnique({
    where: { id },
    include: {
      team: { include: { members: { include: { participant: { select: { id: true, name: true, email: true } } } } } },
      round: true,
      answers: { include: { question: true }, orderBy: { question: { position: "asc" } } },
      artifacts: true,
      evaluation: { include: { evaluator: { select: { id: true, displayName: true } } } },
    },
  });
  if (!submission) throw notFound("Submission");
  if (submission.round.kind === RoundKind.IMAGE_RECREATION && submission.responseConversationUrl) {
    return {
      ...submission,
      answers: [{
        id: `round-three-response-${submission.id}`,
        submissionId: submission.id,
        roundId: submission.roundId,
        questionId: "offline-board",
        conversationUrl: submission.responseConversationUrl,
        promptText: null,
        responseText: null,
        notes: null,
        createdAt: submission.createdAt,
        updatedAt: submission.updatedAt,
        question: {
          id: "offline-board",
          roundId: submission.roundId,
          code: "R3-OFFLINE",
          position: 1,
          title: "Offline board response",
          body: "Participant-submitted chat conversation link",
          status: QuestionStatus.PUBLISHED,
          isPlaceholder: false,
          createdAt: submission.createdAt,
          updatedAt: submission.updatedAt,
        },
      }],
    };
  }
  return submission;
};

export const reviewSubmission = async (
  adminId: string,
  submissionId: string,
  input: { decision: "APPROVED" | "REJECTED"; score?: number; feedback?: string; expectedVersion: number },
  context: RequestContext,
) => {
  const result = await prisma.$transaction(
    async (tx) => {
      const submission = await tx.submission.findUnique({
        where: { id: submissionId },
        include: { round: true, evaluation: true },
      });
      if (!submission) throw notFound("Submission");
      if (submission.evaluation) {
        const sameDecision = submission.evaluation.decision === input.decision;
        const sameScore = Number(submission.evaluation.score ?? 0) === (input.score ?? 0);
        const sameFeedback = (submission.evaluation.feedback ?? "") === (input.feedback ?? "");
        if (sameDecision && sameScore && sameFeedback) return { evaluation: submission.evaluation, teamId: submission.teamId, roundNumber: submission.round.number, revokedCertificates: [] };
        if (submission.evaluation.decision !== EvaluationDecision.REJECTED || input.decision !== "APPROVED") {
          throw conflict("ALREADY_REVIEWED", "This submission already has a final decision.");
        }

        const now = new Date();
        const evaluation = await tx.evaluation.update({
          where: { submissionId },
          data: { decision: EvaluationDecision.APPROVED, evaluatorId: adminId, score: input.score, feedback: input.feedback, evaluatedAt: now, version: { increment: 1 } },
        });
        await tx.submission.update({ where: { id: submissionId }, data: { status: SubmissionStatus.APPROVED, version: { increment: 1 } } });
        await tx.teamRoundAccess.update({
          where: { teamId_roundId: { teamId: submission.teamId, roundId: submission.roundId } },
          data: { status: TeamRoundStatus.APPROVED, decidedAt: now, version: { increment: 1 } },
        });
        if (submission.round.number < 3) {
          const nextRound = await tx.round.findUnique({
            where: { eventId_number: { eventId: submission.round.eventId, number: submission.round.number + 1 } },
            select: { id: true },
          });
          if (nextRound) {
            await tx.teamRoundAccess.upsert({
              where: { teamId_roundId: { teamId: submission.teamId, roundId: nextRound.id } },
              create: { teamId: submission.teamId, roundId: nextRound.id, status: TeamRoundStatus.ELIGIBLE, unlockedAt: now },
              update: { status: TeamRoundStatus.ELIGIBLE, unlockedAt: now, decidedAt: null, version: { increment: 1 } },
            });
          }
        }
        const revokedCertificates = await tx.certificate.findMany({
          where: { teamId: submission.teamId },
          select: { storageBucket: true, storagePath: true },
        });
        await tx.certificate.deleteMany({ where: { teamId: submission.teamId } });
        await writeAuditLog(tx, {
          actor: { type: "admin", id: adminId },
          action: "submission.reapproved",
          entityType: "submission",
          entityId: submissionId,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          metadata: { roundId: submission.roundId, teamId: submission.teamId, previousDecision: "REJECTED", decision: "APPROVED" },
        });
        return { evaluation, teamId: submission.teamId, roundNumber: submission.round.number, revokedCertificates };
      }
      if (submission.status !== SubmissionStatus.SUBMITTED && submission.status !== SubmissionStatus.UNDER_REVIEW) {
        throw conflict("SUBMISSION_NOT_REVIEWABLE", "This submission is not ready for review.");
      }
      if (submission.version !== input.expectedVersion) {
        throw conflict("STALE_SUBMISSION", "The submission changed in another session.", { currentVersion: submission.version });
      }

      const decision = input.decision === "APPROVED" ? EvaluationDecision.APPROVED : EvaluationDecision.REJECTED;
      const status = input.decision === "APPROVED" ? SubmissionStatus.APPROVED : SubmissionStatus.REJECTED;
      const accessStatus = input.decision === "APPROVED" ? TeamRoundStatus.APPROVED : TeamRoundStatus.REJECTED;
      const now = new Date();

      const evaluation = await tx.evaluation.create({
        data: {
          submissionId,
          evaluatorId: adminId,
          decision,
          score: input.score,
          feedback: input.feedback,
        },
      });
      await tx.submission.update({
        where: { id: submissionId },
        data: { status, version: { increment: 1 } },
      });
      await tx.teamRoundAccess.update({
        where: { teamId_roundId: { teamId: submission.teamId, roundId: submission.roundId } },
        data: { status: accessStatus, decidedAt: now, version: { increment: 1 } },
      });
      if (submission.round.number < 3) {
        const nextRound = await tx.round.findUnique({
          where: { eventId_number: { eventId: submission.round.eventId, number: submission.round.number + 1 } },
          select: { id: true },
        });
        if (nextRound) {
          if (input.decision === "APPROVED") {
            await tx.teamRoundAccess.upsert({
              where: { teamId_roundId: { teamId: submission.teamId, roundId: nextRound.id } },
              create: { teamId: submission.teamId, roundId: nextRound.id, status: TeamRoundStatus.ELIGIBLE, unlockedAt: now },
              update: { status: TeamRoundStatus.ELIGIBLE, unlockedAt: now, decidedAt: null, version: { increment: 1 } },
            });
          } else {
            await tx.teamRoundAccess.updateMany({
              where: { teamId: submission.teamId, roundId: nextRound.id, status: { in: [TeamRoundStatus.LOCKED, TeamRoundStatus.ELIGIBLE] } },
              data: { status: TeamRoundStatus.LOCKED, unlockedAt: null, version: { increment: 1 } },
            });
          }
        }
      }
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: `submission.${input.decision.toLowerCase()}`,
        entityType: "submission",
        entityId: submissionId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { roundId: submission.roundId, teamId: submission.teamId, score: input.score ?? null },
      });
      return { evaluation, teamId: submission.teamId, roundNumber: submission.round.number, revokedCertificates: [] };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  if (input.decision === "REJECTED") {
    void ensureCertificatesForEliminatedTeam(result.teamId, result.roundNumber).catch(() => undefined);
  }
  for (const certificate of result.revokedCertificates) {
    if (certificate.storageBucket && certificate.storagePath) {
      void removePrivateArtifact(certificate.storageBucket, certificate.storagePath).catch(() => undefined);
    }
  }
  return result.evaluation;
};

const assignPublishedQuestions = async (tx: Prisma.TransactionClient, roundId: string, teamIds: string[]) => {
  const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, include: { questions: true } });
  if (round.kind !== RoundKind.VAGUE_TO_PRECISE) {
    await tx.teamQuestionAssignment.deleteMany({ where: { teamId: { in: teamIds }, roundId } });
    return;
  }
  const questions = round.questions
    .filter((question) => question.status === QuestionStatus.PUBLISHED)
    .sort((a, b) => a.position - b.position);
  const requiredCount = 4;
  if (questions.length < requiredCount) {
    throw badRequest("INSUFFICIENT_QUESTIONS", `Publish at least ${requiredCount} question(s) before starting this round.`);
  }
  await tx.teamQuestionAssignment.deleteMany({ where: { teamId: { in: teamIds }, roundId } });
  const allocations = buildRoundOneAssignments(questions.map((question) => question.id), teamIds);
  await tx.teamQuestionAssignment.createMany({
    data: allocations.flatMap(({ teamId, questionIds }) => questionIds.map((questionId, index) => ({ teamId, roundId, questionId, position: index + 1 }))),
  });
};

export const listRounds = async () =>
  prisma.round.findMany({
    orderBy: [{ event: { startsAt: "desc" } }, { number: "asc" }],
    include: { event: true, _count: { select: { questions: true, accesses: true, submissions: true } } },
  });

export const listRoundTwoEvaluations = async () => {
  const round = await prisma.round.findFirst({ where: { number: 2 }, orderBy: { event: { startsAt: "desc" } } });
  if (!round) throw notFound("Round");
  if (round.kind !== RoundKind.PROMPT_REVERSE_ENGINEERING) {
    throw badRequest("ROUND_TWO_ONLY", "Offline evaluation is available only for Round 2.");
  }
  const accesses = await prisma.teamRoundAccess.findMany({
    where: {
      roundId: round.id,
      status: { in: [TeamRoundStatus.ELIGIBLE, TeamRoundStatus.IN_PROGRESS, TeamRoundStatus.SUBMITTED, TeamRoundStatus.APPROVED, TeamRoundStatus.REJECTED] },
      team: {
        accesses: {
          some: {
            status: TeamRoundStatus.APPROVED,
            round: { eventId: round.eventId, number: 1 },
          },
        },
      },
    },
    orderBy: { team: { code: "asc" } },
    include: {
      team: {
        select: {
          id: true,
          code: true,
          members: { orderBy: { joinedAt: "asc" }, select: { participant: { select: { id: true, name: true, email: true } } } },
        },
      },
    },
  });
  return { round: { id: round.id, number: round.number, title: round.title, status: round.status }, items: accesses };
};

export const reviewRoundTwoEvaluation = async (
  adminId: string,
  roundId: string,
  teamId: string,
  input: { decision: "APPROVED" | "REJECTED"; expectedVersion: number },
  context: RequestContext,
) => {
  const result = await prisma.$transaction(async (tx) => {
  const round = await tx.round.findUnique({ where: { id: roundId } });
  if (!round) throw notFound("Round");
  if (round.kind !== RoundKind.PROMPT_REVERSE_ENGINEERING) {
    throw badRequest("ROUND_TWO_ONLY", "Offline evaluation is available only for Round 2.");
  }
  if (round.status !== RoundStatus.ENDED) {
    throw conflict("ROUND_NOT_ENDED", "End Round 2 before recording offline decisions.");
  }
  const access = await tx.teamRoundAccess.findFirst({
    where: {
      teamId,
      roundId,
      team: { accesses: { some: { status: TeamRoundStatus.APPROVED, round: { eventId: round.eventId, number: 1 } } } },
    },
  });
  if (!access) throw notFound("Round 2 eligible team");
  if (access.status === TeamRoundStatus.APPROVED || access.status === TeamRoundStatus.REJECTED) {
    throw conflict("ROUND_TWO_ALREADY_REVIEWED", "This Round 2 team already has a final decision.");
  }
  const nextStatus = input.decision === "APPROVED" ? TeamRoundStatus.APPROVED : TeamRoundStatus.REJECTED;
  const changed = await tx.teamRoundAccess.updateMany({
    where: { id: access.id, version: input.expectedVersion, status: { in: [TeamRoundStatus.ELIGIBLE, TeamRoundStatus.IN_PROGRESS, TeamRoundStatus.SUBMITTED] } },
    data: { status: nextStatus, decidedAt: new Date(), version: { increment: 1 } },
  });
  if (changed.count !== 1) throw conflict("ROUND_TWO_STATE_CONFLICT", "This team decision changed in another admin session.");
  const roundThree = await tx.round.findUnique({
    where: { eventId_number: { eventId: round.eventId, number: 3 } },
    select: { id: true },
  });
  if (roundThree) {
    if (input.decision === "APPROVED") {
      await tx.teamRoundAccess.upsert({
        where: { teamId_roundId: { teamId, roundId: roundThree.id } },
        create: { teamId, roundId: roundThree.id, status: TeamRoundStatus.ELIGIBLE, unlockedAt: new Date() },
        update: { status: TeamRoundStatus.ELIGIBLE, unlockedAt: new Date(), decidedAt: null, version: { increment: 1 } },
      });
    } else {
      await tx.teamRoundAccess.updateMany({
        where: { teamId, roundId: roundThree.id, status: { in: [TeamRoundStatus.LOCKED, TeamRoundStatus.ELIGIBLE] } },
        data: { status: TeamRoundStatus.LOCKED, unlockedAt: null, version: { increment: 1 } },
      });
    }
  }
  await writeAuditLog(tx, {
    actor: { type: "admin", id: adminId },
    action: `round2.offline_evaluation.${input.decision.toLowerCase()}`,
    entityType: "team_round_access",
    entityId: access.id,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    metadata: { roundId, teamId, decision: input.decision },
  });
  return tx.teamRoundAccess.findUniqueOrThrow({ where: { id: access.id } });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  if (input.decision === "REJECTED") {
    void ensureCertificatesForEliminatedTeam(teamId, 2).catch(() => undefined);
  }
  return result;
};

export const startRound = async (
  adminId: string,
  roundId: string,
  expectedVersion: number,
  context: RequestContext,
) =>
  prisma.$transaction(
    async (tx) => {
      const round = await tx.round.findUnique({ where: { id: roundId }, include: { event: true } });
      if (!round) throw notFound("Round");
      const isResume = round.startsAt !== null;
      if ((round.status !== RoundStatus.LOCKED && round.status !== RoundStatus.ENDED) || round.version !== expectedVersion) {
        throw conflict("ROUND_STATE_CONFLICT", "The round is not in a resumable state.", {
          currentStatus: round.status,
          currentVersion: round.version,
        });
      }
      const otherLive = await tx.round.findFirst({ where: { eventId: round.eventId, status: RoundStatus.LIVE } });
      if (otherLive) throw conflict("ANOTHER_ROUND_IS_LIVE", "End or lock the active round before starting another.");
      if (isResume) {
        const laterRound = await tx.round.findFirst({ where: { eventId: round.eventId, number: { gt: round.number }, startsAt: { not: null } } });
        if (laterRound) throw conflict("LATER_ROUND_ALREADY_STARTED", "This round cannot resume after a later round has started.");
      }
      if (round.number > 1) {
        const previous = await tx.round.findUnique({ where: { eventId_number: { eventId: round.eventId, number: round.number - 1 } } });
        if (!previous || previous.status !== RoundStatus.ENDED) {
          throw conflict("PREVIOUS_ROUND_NOT_ENDED", "The previous round must be ended first.");
        }
      }

      let initializedTeams = 0;
      if (!isResume) {
        const eligibleTeams =
          round.number === 1
            ? await tx.team.findMany({ where: { eventId: round.eventId, status: TeamStatus.ACTIVE, deletedAt: null }, select: { id: true, code: true }, orderBy: { code: "asc" } })
            : await tx.teamRoundAccess.findMany({
                where: {
                  status: TeamRoundStatus.APPROVED,
                  round: { eventId: round.eventId, number: round.number - 1 },
                  team: { status: TeamStatus.ACTIVE, deletedAt: null },
                },
                select: { teamId: true, team: { select: { code: true } } },
              }).then((rows) => rows.map(({ teamId, team }) => ({ id: teamId, code: team.code })).sort((a, b) => a.code.localeCompare(b.code)));

        const teamIds = eligibleTeams.map(({ id }) => id);
        initializedTeams = teamIds.length;
        await tx.teamRoundAccess.createMany({
          data: teamIds.map((teamId) => ({ teamId, roundId, status: TeamRoundStatus.ELIGIBLE, unlockedAt: new Date() })),
          skipDuplicates: true,
        });
        await tx.teamRoundAccess.updateMany({
          where: { teamId: { in: teamIds }, roundId, status: TeamRoundStatus.LOCKED },
          data: { status: TeamRoundStatus.ELIGIBLE, unlockedAt: new Date(), version: { increment: 1 } },
        });
        await assignPublishedQuestions(tx, roundId, teamIds);
      }

      const updated = await tx.round.updateMany({
        where: { id: roundId, status: round.status, version: expectedVersion },
        data: { status: RoundStatus.LIVE, startsAt: round.startsAt ?? new Date(), endsAt: null, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw conflict("ROUND_STATE_CONFLICT", "The round changed in another admin session.");
      await tx.event.update({ where: { id: round.eventId }, data: { status: EventStatus.LIVE } });
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: isResume ? "round.resumed" : "round.started",
        entityType: "round",
        entityId: roundId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { roundNumber: round.number, resumed: isResume, initializedTeams },
      });
      return tx.round.findUniqueOrThrow({ where: { id: roundId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const endRound = async (adminId: string, roundId: string, expectedVersion: number, context: RequestContext) =>
  prisma.$transaction(
    async (tx) => {
      const round = await tx.round.findUnique({ where: { id: roundId } });
      if (!round) throw notFound("Round");
      const result = await tx.round.updateMany({
        where: { id: roundId, status: RoundStatus.LIVE, version: expectedVersion },
        data: { status: RoundStatus.ENDED, endsAt: new Date(), version: { increment: 1 } },
      });
      if (result.count !== 1) throw conflict("ROUND_STATE_CONFLICT", "Only the current live round can be ended.");
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: "round.ended",
        entityType: "round",
        entityId: roundId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { roundNumber: round.number },
      });
      return tx.round.findUniqueOrThrow({ where: { id: roundId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const lockRound = async (adminId: string, roundId: string, expectedVersion: number, context: RequestContext) =>
  prisma.$transaction(
    async (tx) => {
      const round = await tx.round.findUnique({ where: { id: roundId } });
      if (!round) throw notFound("Round");
      if (round.status === RoundStatus.ENDED) throw conflict("ROUND_ALREADY_ENDED", "An ended round cannot be returned to locked state.");
      const result = await tx.round.updateMany({
        where: { id: roundId, version: expectedVersion, status: { in: [RoundStatus.LIVE, RoundStatus.LOCKED] } },
        data: { status: RoundStatus.LOCKED, version: { increment: 1 } },
      });
      if (result.count !== 1) throw conflict("ROUND_STATE_CONFLICT", "The round changed in another admin session.");
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: "round.locked",
        entityType: "round",
        entityId: roundId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        metadata: { roundNumber: round.number },
      });
      return tx.round.findUniqueOrThrow({ where: { id: roundId } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

export const replaceQuestionSet = async (
  adminId: string,
  roundId: string,
  questions: Array<{
    id?: string;
    code: string;
    position: number;
    title: string;
    body: string;
    status: "DRAFT" | "PUBLISHED" | "ARCHIVED";
    isPlaceholder: boolean;
  }>,
  context: RequestContext,
) =>
  prisma.$transaction(async (tx) => {
    const round = await tx.round.findUnique({ where: { id: roundId } });
    if (!round) throw notFound("Round");
    if (round.status !== RoundStatus.LOCKED) throw conflict("ROUND_NOT_LOCKED", "Questions can be changed only before the round starts.");
    if (round.number !== 1) throw badRequest("ROUND_ONE_ONLY", "This question-pool module manages Round 1 only.");
    if (await tx.submission.count({ where: { roundId } })) throw conflict("ROUND_HAS_SUBMISSIONS", "Questions cannot be changed after teams have created Round 1 submissions.");
    const usedPositions = new Set(questions.map((question) => question.position));
    const usedCodes = new Set(questions.map((question) => question.code.toUpperCase()));
    if (usedPositions.size !== questions.length || usedCodes.size !== questions.length) {
      throw badRequest("DUPLICATE_QUESTION_ORDER", "Question codes and positions must be unique.");
    }
    const retainedIds = questions.flatMap((question) => question.id ? [question.id] : []);
    await tx.teamQuestionAssignment.deleteMany({ where: { roundId } });
    await tx.question.deleteMany({ where: { roundId, ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}) } });
    const existingIds = questions.flatMap((question) => question.id ? [question.id] : []);
    if (existingIds.length) await tx.question.updateMany({ where: { roundId, id: { in: existingIds } }, data: { position: { increment: 1000 } } });
    for (const question of questions) {
      const { id, ...questionData } = question;
      if (id) {
        const result = await tx.question.updateMany({
          where: { id, roundId },
          data: {
            ...questionData,
            code: questionData.code.toUpperCase(),
            status: questionData.status as QuestionStatus,
          },
        });
        if (result.count !== 1) throw badRequest("QUESTION_SCOPE_MISMATCH", "A question does not belong to this round.");
      } else {
        await tx.question.create({
          data: {
            roundId,
            ...questionData,
            code: questionData.code.toUpperCase(),
            status: questionData.status as QuestionStatus,
          },
        });
      }
    }
    await writeAuditLog(tx, {
      actor: { type: "admin", id: adminId },
      action: "round.questions.updated",
      entityType: "round",
      entityId: roundId,
      requestId: context.requestId,
      metadata: { count: questions.length },
    });
    return tx.question.findMany({ where: { roundId }, orderBy: { position: "asc" } });
  });

export const generateTeams = async (
  adminId: string,
  input: { eventId: string; count: number },
  context: RequestContext,
) => {
  const candidates: Array<{
    accessCode: string;
  }> = [];
  for (let index = 0; index < input.count; index += 1) {
    const accessCode = createTeamAccessCode();
    candidates.push({
      accessCode,
    });
  }

  return prisma.$transaction(
    async (tx) => {
      const event = await tx.event.findUnique({ where: { id: input.eventId } });
      if (!event) throw notFound("Event");
      const teams: Array<{ id: string; code: string }> = [];
      for (const candidate of candidates) {
        const team = await tx.team.create({
          data: {
            eventId: input.eventId,
            code: candidate.accessCode,
          },
        });
        teams.push({ id: team.id, code: candidate.accessCode });
      }
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: "teams.generated",
        entityType: "event",
        entityId: input.eventId,
        requestId: context.requestId,
        metadata: { count: teams.length },
      });
      return teams;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
  );
};

export const previewImport = async (
  adminId: string,
  eventId: string,
  file: { originalname: string; buffer: Buffer },
  context: RequestContext,
) => {
  const ExcelJS = await import("exceljs");
  const { sha256 } = await import("../../lib/crypto.js");
  const workbook = new ExcelJS.default.Workbook();
  await workbook.xlsx.load(file.buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) throw badRequest("EMPTY_WORKBOOK", "The workbook does not contain a worksheet.");

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw notFound("Event");
  const parsedRows: Array<{ rowNumber: number; name?: string; email?: string; teamCode?: string; status: ImportRowStatus; errorCode?: string; errorMessage?: string }> = [];
  const seen = new Set<string>();
  const teamSizes = new Map<string, number>();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const name = String(row.getCell(1).text ?? "").trim();
    const email = normalizeEmail(String(row.getCell(2).text ?? ""));
    const teamCode = normalizeTeamCode(String(row.getCell(3).text ?? ""));
    if (rowNumber === 1 && name.toLowerCase() === "name" && email === "email" && teamCode.replaceAll(" ", "") === "TEAMCODE") return;
    let status: ImportRowStatus = ImportRowStatus.VALID;
    let errorCode: string | undefined;
    let errorMessage: string | undefined;
    if (!name || name.length > 120) {
      status = ImportRowStatus.INVALID;
      errorCode = "INVALID_NAME";
      errorMessage = "Column 1 must contain a name between 1 and 120 characters.";
    } else if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 320) {
      status = ImportRowStatus.INVALID;
      errorCode = "INVALID_EMAIL";
      errorMessage = "Column 2 must contain a valid email address.";
    } else if (!/^[A-Z0-9][A-Z0-9-]{5,23}$/.test(teamCode)) {
      status = ImportRowStatus.INVALID;
      errorCode = "INVALID_TEAM_CODE";
      errorMessage = "Column 3 must contain a 6-24 character Team Code using letters, numbers, or hyphens.";
    } else if (seen.has(email)) {
      status = ImportRowStatus.INVALID;
      errorCode = "DUPLICATE_IN_FILE";
      errorMessage = "The email appears more than once in this workbook.";
    }
    if (email) seen.add(email);
    if (status === ImportRowStatus.VALID) teamSizes.set(teamCode, (teamSizes.get(teamCode) ?? 0) + 1);
    parsedRows.push({ rowNumber, name: name || undefined, email: email || undefined, teamCode: teamCode || undefined, status, errorCode, errorMessage });
  });
  for (const row of parsedRows) {
    if (row.status === ImportRowStatus.VALID && row.teamCode && (teamSizes.get(row.teamCode) ?? 0) > 3) {
      row.status = ImportRowStatus.INVALID;
      row.errorCode = "TEAM_SIZE_EXCEEDED";
      row.errorMessage = `Team ${row.teamCode} has more than three members in this workbook.`;
    }
  }
  if (parsedRows.length === 0) throw badRequest("EMPTY_IMPORT", "No participant rows were found.");
  if (parsedRows.length > 1000) throw badRequest("IMPORT_TOO_LARGE", "A single import may contain at most 1,000 participants.");

  const validRows = parsedRows.filter((row) => row.status === ImportRowStatus.VALID).length;
  return prisma.$transaction(async (tx) => {
    const batch = await tx.importBatch.create({
      data: {
        eventId,
        importedById: adminId,
        originalName: file.originalname.slice(0, 255),
        checksumSha256: sha256(file.buffer),
        totalRows: parsedRows.length,
        validRows,
        invalidRows: parsedRows.length - validRows,
        rows: {
          create: parsedRows.map((row) => ({
            rowNumber: row.rowNumber,
            name: row.name,
            email: row.email,
            teamCode: row.teamCode,
            status: row.status,
            errorCode: row.errorCode,
            errorMessage: row.errorMessage,
          })),
        },
      },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    await writeAuditLog(tx, {
      actor: { type: "admin", id: adminId },
      action: "participants.import.previewed",
      entityType: "import_batch",
      entityId: batch.id,
      requestId: context.requestId,
      metadata: { totalRows: batch.totalRows, validRows: batch.validRows, invalidRows: batch.invalidRows },
    });
    return batch;
  });
};

export const commitImport = async (
  adminId: string,
  batchId: string,
  expectedVersion: number,
  context: RequestContext,
) =>
  prisma.$transaction(
    async (tx) => {
      const batch = await tx.importBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
      if (!batch) throw notFound("Import batch");
      if (batch.status !== ImportStatus.PREVIEWED || batch.version !== expectedVersion) {
        throw conflict("IMPORT_STATE_CONFLICT", "This import was already committed or changed.");
      }
      await tx.importBatch.update({ where: { id: batchId }, data: { status: ImportStatus.PROCESSING, version: { increment: 1 } } });
      const validRows = batch.rows
        .filter((row) => row.status === ImportRowStatus.VALID && row.name && row.email && row.teamCode)
        .map((row) => ({ ...row, name: row.name!, email: normalizeEmail(row.email!), teamCode: normalizeTeamCode(row.teamCode!) }));

      const existingParticipants = await tx.participant.findMany({
        where: { email: { in: validRows.map((row) => row.email) } },
        select: { id: true, email: true },
      });
      const existingParticipantByEmail = new Map(existingParticipants.map((participant) => [participant.email, participant]));
      const duplicateRows = validRows.filter((row) => existingParticipantByEmail.has(row.email));
      const rowsToImport = validRows.filter((row) => !existingParticipantByEmail.has(row.email));
      const teamCodes = [...new Set(rowsToImport.map((row) => row.teamCode))];

      const existingTeams = await tx.team.findMany({
        where: { code: { in: teamCodes } },
        select: { id: true, code: true, eventId: true },
      });
      const foreignEventTeam = existingTeams.find((team) => team.eventId !== batch.eventId);
      if (foreignEventTeam) {
        throw conflict("TEAM_CODE_EVENT_CONFLICT", `Team Code ${foreignEventTeam.code} is already assigned to another event.`);
      }

      const existingMembershipCounts = existingTeams.length
        ? await tx.teamMember.groupBy({
            by: ["teamId"],
            where: { teamId: { in: existingTeams.map((team) => team.id) } },
            _count: { _all: true },
          })
        : [];
      const membershipCountByTeam = new Map(existingMembershipCounts.map((entry) => [entry.teamId, entry._count._all]));
      const existingTeamByCode = new Map(existingTeams.map((team) => [team.code, team]));
      const incomingCountByCode = new Map<string, number>();
      for (const row of rowsToImport) incomingCountByCode.set(row.teamCode, (incomingCountByCode.get(row.teamCode) ?? 0) + 1);
      for (const [teamCode, incomingCount] of incomingCountByCode) {
        const team = existingTeamByCode.get(teamCode);
        if ((team ? membershipCountByTeam.get(team.id) ?? 0 : 0) + incomingCount > 3) {
          throw badRequest("TEAM_SIZE_EXCEEDED", `Team ${teamCode} would have more than three members.`);
        }
      }

      const missingTeamCodes = teamCodes.filter((code) => !existingTeamByCode.has(code));
      if (missingTeamCodes.length) {
        await tx.team.createMany({ data: missingTeamCodes.map((code) => ({ eventId: batch.eventId, code })) });
      }
      const teams = teamCodes.length
        ? await tx.team.findMany({ where: { code: { in: teamCodes }, eventId: batch.eventId }, select: { id: true, code: true } })
        : [];
      const teamByCode = new Map(teams.map((team) => [team.code, team]));

      if (rowsToImport.length) {
        await tx.participant.createMany({ data: rowsToImport.map((row) => ({ name: row.name, email: row.email })) });
      }
      const importedParticipants = rowsToImport.length
        ? await tx.participant.findMany({
            where: { email: { in: rowsToImport.map((row) => row.email) } },
            select: { id: true, email: true },
          })
        : [];
      const importedParticipantByEmail = new Map(importedParticipants.map((participant) => [participant.email, participant]));

      if (rowsToImport.length) {
        await tx.teamMember.createMany({
          data: rowsToImport.map((row) => ({
            teamId: teamByCode.get(row.teamCode)!.id,
            participantId: importedParticipantByEmail.get(row.email)!.id,
          })),
        });
      }

      await Promise.all([
        ...duplicateRows.map((row) => tx.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.DUPLICATE, participantId: existingParticipantByEmail.get(row.email)!.id },
        })),
        ...rowsToImport.map((row) => tx.importRow.update({
          where: { id: row.id },
          data: { status: ImportRowStatus.IMPORTED, participantId: importedParticipantByEmail.get(row.email)!.id },
        })),
      ]);
      const importedRows = rowsToImport.length;
      const duplicateRowCount = duplicateRows.length;
      const committed = await tx.importBatch.update({
        where: { id: batchId },
        data: {
          status: ImportStatus.COMPLETED,
          importedRows,
          duplicateRows: duplicateRowCount,
          committedAt: new Date(),
          version: { increment: 1 },
        },
        include: { rows: { orderBy: { rowNumber: "asc" } } },
      });
      await writeAuditLog(tx, {
        actor: { type: "admin", id: adminId },
        action: "participants.import.committed",
        entityType: "import_batch",
        entityId: batchId,
        requestId: context.requestId,
        metadata: { importedRows, duplicateRows: duplicateRowCount, invalidRows: batch.invalidRows },
      });
      return committed;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 60_000 },
  );

export const listAuditLogs = async (query: { cursor?: string; limit: number; action?: string; entityType?: string }) => {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(query.action ? { action: query.action } : {}),
      ...(query.entityType ? { entityType: query.entityType } : {}),
    },
    orderBy: { id: "desc" },
    take: query.limit + 1,
    ...(query.cursor ? { cursor: { id: BigInt(query.cursor) }, skip: 1 } : {}),
    include: {
      actorAdmin: { select: { id: true, displayName: true, email: true } },
      actorParticipant: { select: { id: true, name: true, email: true } },
    },
  });
  const hasMore = rows.length > query.limit;
  const items = rows.slice(0, query.limit).map((row) => ({ ...row, id: row.id.toString() }));
  return { items, nextCursor: hasMore ? items.at(-1)?.id ?? null : null };
};
