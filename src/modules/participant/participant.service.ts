import { Prisma } from "../../generated/prisma/client.js";
import {
  QuestionStatus,
  RoundKind,
  RoundStatus,
  SubmissionStatus,
  TeamRoundStatus,
} from "../../generated/prisma/enums.js";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../services/audit-service.js";
import { buildRoundOneAssignments } from "../admin/question-assignment.js";

const ensureLiveTeamAssignments = async (teamId: string, roundNumber: number) => {
  await prisma.$transaction(async (tx) => {
    const round = await tx.round.findFirst({
      where: { number: roundNumber, status: RoundStatus.LIVE, event: { teams: { some: { id: teamId } } } },
      include: {
        accesses: { where: { teamId } },
        assignments: { where: { teamId } },
        questions: { where: { status: QuestionStatus.PUBLISHED }, orderBy: { position: "asc" } },
      },
    });
    if (!round || round.kind !== RoundKind.VAGUE_TO_PRECISE || round.assignments.length > 0) return;
    const access = round.accesses[0];
    if (!access || access.status === TeamRoundStatus.LOCKED || access.status === TeamRoundStatus.REJECTED) return;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${teamId}:${round.id}`}, 0))`;
    if (await tx.teamQuestionAssignment.count({ where: { teamId, roundId: round.id } })) return;
    const requiredCount = 4;
    if (round.questions.length < requiredCount) {
      throw badRequest("INSUFFICIENT_QUESTIONS", `Round ${round.number} does not have enough published questions.`);
    }
    const questionIds = buildRoundOneAssignments(round.questions.map((question) => question.id), [teamId])[0]!.questionIds;
    await tx.teamQuestionAssignment.createMany({
      data: questionIds.map((questionId, index) => ({ teamId, roundId: round.id, questionId, position: index + 1 })),
      skipDuplicates: true,
    });
    await writeAuditLog(tx, {
      actor: { type: "system" },
      action: "round.assignments.repaired",
      entityType: "team",
      entityId: teamId,
      metadata: { roundId: round.id, roundNumber: round.number, assignmentCount: questionIds.length },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
};

export const getParticipantOverview = async (participantId: string, teamId: string) => {
  const participant = await prisma.participant.findUnique({
    where: { id: participantId },
    include: {
      membership: {
        include: {
          team: {
            include: {
              members: { include: { participant: { select: { id: true, name: true, email: true } } } },
              accesses: { include: { round: true } },
              submissions: { include: { evaluation: true } },
              event: true,
            },
          },
        },
      },
    },
  });

  if (!participant?.membership || participant.membership.teamId !== teamId) throw notFound("Participant workspace");
  const team = participant.membership.team;

  return {
    participant: { id: participant.id, name: participant.name, email: participant.email, status: participant.status },
    team: {
      id: team.id,
      code: team.code,
      status: team.status,
      members: team.members.map((member) => member.participant),
    },
    event: team.event,
    rounds: team.accesses
      .sort((a, b) => a.round.number - b.round.number)
      .map((access) => ({
        id: access.round.id,
        number: access.round.number,
        title: access.round.title,
        roundStatus: access.round.status,
        accessStatus: access.status,
        submission: team.submissions.find((submission) => submission.roundId === access.roundId) ?? null,
      })),
  };
};

export const getParticipantRounds = async (teamId: string) => {
  const rounds = await prisma.round.findMany({
    where: { event: { teams: { some: { id: teamId } } } },
    orderBy: { number: "asc" },
    include: {
      accesses: { where: { teamId } },
      submissions: { where: { teamId }, include: { evaluation: true } },
    },
  });

  return rounds.map((round) => ({
    id: round.id,
    number: round.number,
    kind: round.kind,
    title: round.title,
    description: round.description,
    roundStatus: round.status,
    accessStatus: round.accesses[0]?.status ?? TeamRoundStatus.LOCKED,
    submission: round.submissions[0] ?? null,
    contentAvailable:
      round.status === RoundStatus.LIVE &&
      round.accesses[0] !== undefined &&
      round.accesses[0].status !== TeamRoundStatus.LOCKED &&
      round.accesses[0].status !== TeamRoundStatus.REJECTED,
  }));
};

export const getParticipantRound = async (teamId: string, roundNumber: number) => {
  await ensureLiveTeamAssignments(teamId, roundNumber);
  const round = await prisma.round.findFirst({
    where: { number: roundNumber, event: { teams: { some: { id: teamId } } } },
    include: {
      accesses: { where: { teamId } },
      rules: { orderBy: { position: "asc" } },
      assignments: {
        where: { teamId },
        orderBy: { position: "asc" },
        include: { question: true },
      },
      submissions: {
        where: { teamId },
        include: { answers: true, evaluation: true },
      },
    },
  });

  if (!round) throw notFound("Round");
  const access = round.accesses[0];
  const available =
    round.status === RoundStatus.LIVE &&
    access &&
    access.status !== TeamRoundStatus.LOCKED &&
    access.status !== TeamRoundStatus.REJECTED;
  const rulesVisible = round.status === RoundStatus.LIVE && round.kind === RoundKind.PROMPT_REVERSE_ENGINEERING;

  if (!available) {
    return {
      id: round.id,
      number: round.number,
      title: round.title,
      roundStatus: round.status,
      accessStatus: access?.status ?? TeamRoundStatus.LOCKED,
      contentAvailable: false,
      rules: rulesVisible ? round.rules.map(({ id, position, text }) => ({ id, position, text })) : [],
      questions: [],
      submission: round.submissions[0] ?? null,
    };
  }

  return {
    id: round.id,
    number: round.number,
    kind: round.kind,
    title: round.title,
    description: round.description,
    roundStatus: round.status,
    accessStatus: access.status,
    contentAvailable: true,
    rules: round.rules.map(({ id, position, text }) => ({ id, position, text })),
    questions: round.kind !== RoundKind.VAGUE_TO_PRECISE ? [] : round.assignments.map(({ position, question }) => ({
      id: question.id,
      code: question.code,
      position,
      title: question.title,
      body: question.body,
      isPlaceholder: question.isPlaceholder,
    })),
    submission: round.submissions[0] ?? null,
  };
};

type AnswerInput = {
  questionId: string;
  conversationUrl?: string;
  promptText?: string;
  responseText?: string;
  notes?: string;
};

export const saveSubmissionDraft = async (
  participantId: string,
  teamId: string,
  roundNumber: number,
  input: { aiTool?: string; responseConversationUrl?: string; answers: AnswerInput[]; version?: number },
  requestId?: string,
) => {
  return prisma.$transaction(
    async (tx) => {
      const round = await tx.round.findFirst({
        where: { number: roundNumber, event: { teams: { some: { id: teamId } } } },
        include: { accesses: { where: { teamId } }, assignments: { where: { teamId } } },
      });
      if (!round) throw notFound("Round");
      if (round.kind === RoundKind.PROMPT_REVERSE_ENGINEERING) {
        throw forbidden("Round 2 is an offline paper-and-pen test and has no online submission interface.");
      }
      if (round.kind === RoundKind.VAGUE_TO_PRECISE && !input.aiTool?.trim()) {
        throw badRequest("AI_TOOL_REQUIRED", "Round 1 requires the designated AI tool name.");
      }
      if (round.kind === RoundKind.IMAGE_RECREATION) {
        if (!input.responseConversationUrl || input.answers.length !== 0) {
          throw badRequest("ROUND_THREE_LINK_ONLY", "Round 3 accepts exactly one conversation link and no other response fields.");
        }
      }
      const access = round.accesses[0];
      if (round.status !== RoundStatus.LIVE || !access) throw forbidden("This round is not open.");
      const existing = await tx.submission.findUnique({
        where: { teamId_roundId: { teamId, roundId: round.id } },
        include: { answers: true },
      });
      // If the first request committed but its response was interrupted, a
      // retry must report the persisted submission instead of failing with a
      // misleading "locked" error.
      if (existing && existing.status !== SubmissionStatus.DRAFT) return existing;
      if (access.status !== TeamRoundStatus.ELIGIBLE && access.status !== TeamRoundStatus.IN_PROGRESS) {
        throw forbidden("This submission is locked.");
      }

      const assignedIds = new Set(round.assignments.map((assignment) => assignment.questionId));
      if (round.kind === RoundKind.VAGUE_TO_PRECISE && input.answers.some((answer) => !assignedIds.has(answer.questionId))) {
        throw badRequest("QUESTION_NOT_ASSIGNED", "One or more answers refer to an unassigned question.");
      }

      if (existing && input.version !== undefined && existing.version !== input.version) {
        throw conflict("STALE_SUBMISSION", "The submission changed in another session. Refresh and try again.", {
          currentVersion: existing.version,
        });
      }

      const team = await tx.team.findUniqueOrThrow({ where: { id: teamId }, select: { code: true } });
      const submission = existing
        ? await tx.submission.update({
            where: { id: existing.id },
            data: { teamCodeSnapshot: team.code, aiTool: round.kind === RoundKind.IMAGE_RECREATION ? null : input.aiTool, responseConversationUrl: round.kind === RoundKind.IMAGE_RECREATION ? input.responseConversationUrl : null, version: { increment: 1 } },
          })
        : await tx.submission.create({
            data: { teamId, roundId: round.id, teamCodeSnapshot: team.code, aiTool: round.kind === RoundKind.IMAGE_RECREATION ? null : input.aiTool, responseConversationUrl: round.kind === RoundKind.IMAGE_RECREATION ? input.responseConversationUrl : null },
          });

      for (const answer of input.answers) {
        await tx.submissionAnswer.upsert({
          where: { submissionId_questionId: { submissionId: submission.id, questionId: answer.questionId } },
          create: { submissionId: submission.id, roundId: round.id, ...answer },
          update: {
            conversationUrl: answer.conversationUrl,
            promptText: round.kind === RoundKind.IMAGE_RECREATION ? null : answer.promptText,
            responseText: round.kind === RoundKind.IMAGE_RECREATION ? null : answer.responseText,
            notes: round.kind === RoundKind.IMAGE_RECREATION ? null : answer.notes,
          },
        });
      }

      if (access.status === TeamRoundStatus.ELIGIBLE) {
        await tx.teamRoundAccess.update({
          where: { id: access.id },
          data: { status: TeamRoundStatus.IN_PROGRESS, version: { increment: 1 } },
        });
      }
      await writeAuditLog(tx, {
        actor: { type: "participant", id: participantId },
        action: "submission.draft.saved",
        entityType: "submission",
        entityId: submission.id,
        requestId,
        metadata: { roundNumber, answerCount: input.answers.length },
      });

      return tx.submission.findUniqueOrThrow({ where: { id: submission.id }, include: { answers: true } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  );
};

export const submitRound = async (
  participantId: string,
  teamId: string,
  roundNumber: number,
  requestId?: string,
) => {
  return prisma.$transaction(
    async (tx) => {
      const round = await tx.round.findFirst({
        where: { number: roundNumber, event: { teams: { some: { id: teamId } } } },
        include: {
          accesses: { where: { teamId } },
          assignments: { where: { teamId }, include: { question: true } },
          submissions: { where: { teamId }, include: { answers: true, artifacts: true } },
        },
      });
      if (!round) throw notFound("Round");
      const access = round.accesses[0];
      const submission = round.submissions[0];
      if (round.kind === RoundKind.PROMPT_REVERSE_ENGINEERING) {
        throw forbidden("Round 2 is an offline paper-and-pen test and cannot be submitted online.");
      }
      if (submission && submission.status !== SubmissionStatus.DRAFT) return submission;
      if (round.status !== RoundStatus.LIVE) throw forbidden("This round is not open.");
      if (!access || !submission || submission.status !== SubmissionStatus.DRAFT) {
        throw badRequest("DRAFT_REQUIRED", "Save a complete draft before submitting.");
      }
      if (access.status !== TeamRoundStatus.ELIGIBLE && access.status !== TeamRoundStatus.IN_PROGRESS) {
        throw forbidden("This team is not eligible to submit this round.");
      }

      const assignedIds = new Set(round.assignments.map((assignment) => assignment.questionId));
      const answers = submission.answers.filter((answer) => assignedIds.has(answer.questionId));
      if (round.kind === RoundKind.VAGUE_TO_PRECISE) {
        if (answers.length !== assignedIds.size || assignedIds.size === 0) {
          throw badRequest("INCOMPLETE_SUBMISSION", "Every assigned problem must have one answer.");
        }
        if (assignedIds.size !== 4 || answers.some((answer) => !answer.conversationUrl || !answer.promptText?.trim())) {
          throw badRequest(
            "ROUND_ONE_REQUIRES_COMPLETE_ANSWERS",
            "Round 1 requires a conversation link and final prompt for each of the four assigned problems.",
          );
        }
        if (new Set(answers.map((answer) => answer.conversationUrl)).size !== answers.length) {
          throw badRequest("DUPLICATE_CONVERSATION_LINK", "Conversation links must be unique.");
        }
      }
      if (round.kind === RoundKind.IMAGE_RECREATION) {
        if (!submission.responseConversationUrl) {
          throw badRequest("ROUND_THREE_LINK_REQUIRED", "Round 3 requires exactly one conversation link.");
        }
        if (submission.answers.length !== 0) {
          throw badRequest("ROUND_THREE_LINK_ONLY", "Round 3 accepts only the conversation link.");
        }
      }

      const now = new Date();
      const transition = await tx.submission.updateMany({
        where: { id: submission.id, status: SubmissionStatus.DRAFT },
        data: {
          status: SubmissionStatus.SUBMITTED,
          submittedAt: now,
          lockedAt: now,
          version: { increment: 1 },
        },
      });
      if (transition.count === 0) {
        const current = await tx.submission.findUniqueOrThrow({
          where: { id: submission.id },
          include: { answers: true },
        });
        if (current.status !== SubmissionStatus.DRAFT) return current;
        throw conflict("SUBMISSION_STATE_CONFLICT", "The submission changed while it was being submitted. Please try once more.");
      }
      await tx.teamRoundAccess.update({
        where: { id: access.id },
        data: { status: TeamRoundStatus.SUBMITTED, submittedAt: now, version: { increment: 1 } },
      });
      await writeAuditLog(tx, {
        actor: { type: "participant", id: participantId },
        action: "submission.submitted",
        entityType: "submission",
        entityId: submission.id,
        requestId,
        metadata: { roundNumber, answerCount: answers.length },
      });
      return tx.submission.findUniqueOrThrow({ where: { id: submission.id }, include: { answers: true } });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 10_000, timeout: 30_000 },
  );
};

export const getLeaderboard = async (teamId: string) => {
  const team = await prisma.team.findUniqueOrThrow({ where: { id: teamId }, select: { eventId: true } });
  const rows = await prisma.evaluation.findMany({
    where: { submission: { team: { eventId: team.eventId } } },
    orderBy: [{ score: "desc" }, { evaluatedAt: "asc" }],
    include: { submission: { include: { team: { select: { id: true, code: true } }, round: { select: { number: true } } } } },
  });

  const totals = new Map<string, { teamId: string; teamCode: string; score: number; rounds: number }>();
  for (const row of rows) {
    const current = totals.get(row.submission.team.id) ?? {
      teamId: row.submission.team.id,
      teamCode: row.submission.team.code,
      score: 0,
      rounds: 0,
    };
    current.score += Number(row.score ?? 0);
    current.rounds += 1;
    totals.set(current.teamId, current);
  }

  return [...totals.values()]
    .sort((a, b) => b.score - a.score || a.teamCode.localeCompare(b.teamCode))
    .map((row, index) => ({ rank: index + 1, ...row }));
};
