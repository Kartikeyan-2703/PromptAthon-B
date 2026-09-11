import ExcelJS from "exceljs";
import { SubmissionStatus } from "../../generated/prisma/enums.js";
import { conflict, notFound } from "../../lib/errors.js";
import { normalizeEmail } from "../../lib/crypto.js";
import { prisma } from "../../lib/prisma.js";
import { writeAuditLog } from "../../services/audit-service.js";

export const ROUND_PARTICIPATION_REPORT_FILENAME = "prompthon-round-participation-report.xlsx";

export const participatingSubmissionStatuses = [
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.UNDER_REVIEW,
  SubmissionStatus.APPROVED,
  SubmissionStatus.REJECTED,
] as const;

export type ParticipationEvidenceRow = {
  round: { number: number };
  team: {
    members: Array<{
      participant: { email: string };
    }>;
  };
};

export type RoundParticipationColumns = {
  1: string[];
  2: string[];
  3: string[];
};

/**
 * A participant is represented in a round only when their team has a finalized
 * submission for that round. Eligibility and approval are intentionally not
 * inputs to this function.
 */
export const collectRoundParticipationEmails = (
  evidenceRows: ParticipationEvidenceRow[],
): RoundParticipationColumns => {
  const emailsByRound: Record<1 | 2 | 3, Set<string>> = {
    1: new Set<string>(),
    2: new Set<string>(),
    3: new Set<string>(),
  };

  for (const evidence of evidenceRows) {
    if (evidence.round.number !== 1 && evidence.round.number !== 2 && evidence.round.number !== 3) continue;
    const roundNumber = evidence.round.number;
    for (const member of evidence.team.members) {
      const email = normalizeEmail(member.participant.email);
      if (!email) {
        throw conflict(
          "PARTICIPANT_EMAIL_MISSING",
          "A finalized submission is linked to a participant without an email address.",
        );
      }
      emailsByRound[roundNumber].add(email);
    }
  }

  return {
    1: [...emailsByRound[1]].sort((left, right) => left.localeCompare(right)),
    2: [...emailsByRound[2]].sort((left, right) => left.localeCompare(right)),
    3: [...emailsByRound[3]].sort((left, right) => left.localeCompare(right)),
  };
};

export const buildRoundParticipationWorkbook = async (columns: RoundParticipationColumns) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PROMPTHON 2026";
  workbook.company = "Easwari Engineering College";
  workbook.subject = "Actual round participation report";
  workbook.title = "PROMPTHON Round Participation";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Round Participation", {
    views: [{ state: "frozen", ySplit: 1, showGridLines: false }],
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  sheet.columns = [
    { header: "Round 1", key: "round1", width: 42 },
    { header: "Round 2", key: "round2", width: 42 },
    { header: "Round 3", key: "round3", width: 42 },
  ];

  const header = sheet.getRow(1);
  header.height = 25;
  header.font = { name: "Aptos", size: 11, bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", horizontal: "left" };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF123A24" } };
  header.border = { bottom: { style: "medium", color: { argb: "FF48C979" } } };

  const rowCount = Math.max(columns[1].length, columns[2].length, columns[3].length);
  for (let index = 0; index < rowCount; index += 1) {
    sheet.addRow({
      round1: columns[1][index] ?? null,
      round2: columns[2][index] ?? null,
      round3: columns[3][index] ?? null,
    });
  }

  if (rowCount > 0) {
    const dataRange = sheet.getRows(2, rowCount) ?? [];
    for (const row of dataRange) {
      row.height = 20;
      row.font = { name: "Aptos", size: 10, color: { argb: "FF202621" } };
      row.alignment = { vertical: "middle", horizontal: "left" };
      row.border = { bottom: { style: "hair", color: { argb: "FFDDE6DF" } } };
    }
    sheet.autoFilter = { from: "A1", to: `C${rowCount + 1}` };
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

export const createRoundParticipationReport = async (eventId?: string) => {
  const event = eventId
    ? await prisma.event.findUnique({
        where: { id: eventId },
        select: { id: true, rounds: { select: { number: true }, orderBy: { number: "asc" } } },
      })
    : await prisma.event.findFirst({
        orderBy: { startsAt: "desc" },
        select: { id: true, rounds: { select: { number: true }, orderBy: { number: "asc" } } },
      });

  if (!event) throw notFound("Event");
  const configuredRounds = new Set(event.rounds.map(({ number }) => number));
  if (![1, 2, 3].every((number) => configuredRounds.has(number))) {
    throw conflict(
      "INVALID_ROUND_CONFIGURATION",
      "The event must have configured rounds 1, 2, and 3 before this report can be generated.",
    );
  }

  const evidenceRows = await prisma.submission.findMany({
    where: {
      round: { eventId: event.id, number: { in: [1, 2, 3] } },
      status: { in: [...participatingSubmissionStatuses] },
      submittedAt: { not: null },
      lockedAt: { not: null },
    },
    orderBy: [{ round: { number: "asc" } }, { teamId: "asc" }],
    select: {
      round: { select: { number: true } },
      team: {
        select: {
          members: {
            orderBy: { joinedAt: "asc" },
            select: { participant: { select: { email: true } } },
          },
        },
      },
    },
  });

  const columns = collectRoundParticipationEmails(evidenceRows);
  return {
    eventId: event.id,
    columns,
    counts: { round1: columns[1].length, round2: columns[2].length, round3: columns[3].length },
    buffer: await buildRoundParticipationWorkbook(columns),
  };
};

export const auditRoundParticipationExport = async (
  adminId: string,
  report: { eventId: string; counts: { round1: number; round2: number; round3: number } },
  context: { requestId?: string; ipAddress?: string; userAgent?: string },
) =>
  prisma.$transaction(async (tx) => {
    await writeAuditLog(tx, {
      actor: { type: "admin", id: adminId },
      action: "reports.round_participation.exported",
      entityType: "event",
      entityId: report.eventId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: report.counts,
    });
  });
