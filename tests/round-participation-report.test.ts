import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildRoundParticipationWorkbook,
  collectRoundParticipationEmails,
  participatingSubmissionStatuses,
  type ParticipationEvidenceRow,
} from "../src/modules/admin/round-participation-report.service.js";

const evidence = (roundNumber: number, ...emails: string[]): ParticipationEvidenceRow => ({
  round: { number: roundNumber },
  team: { members: emails.map((email) => ({ participant: { email } })) },
});

describe("round participation definition", () => {
  it("uses only finalized submission states as participation evidence", () => {
    expect(participatingSubmissionStatuses).toEqual(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]);
    expect(participatingSubmissionStatuses).not.toContain("DRAFT");
  });

  it("builds independent round columns and deduplicates only within each round", () => {
    const round1 = Array.from({ length: 100 }, (_, index) => `r1-${index}@example.com`);
    const round2 = Array.from({ length: 50 }, (_, index) => `r2-${index}@example.com`);
    const round3 = Array.from({ length: 20 }, (_, index) => `r3-${index}@example.com`);
    const rows = [
      ...round1.map((email) => evidence(1, email)),
      ...round2.map((email) => evidence(2, email)),
      ...round3.map((email) => evidence(3, email)),
      evidence(1, round1[0]!),
      evidence(2, round2[0]!),
      evidence(3, round3[0]!),
    ];

    const result = collectRoundParticipationEmails(rows);
    expect(result[1]).toHaveLength(100);
    expect(result[2]).toHaveLength(50);
    expect(result[3]).toHaveLength(20);
  });

  it("keeps the same participant in every round where their team submitted", () => {
    const result = collectRoundParticipationEmails([
      evidence(1, "all-rounds@example.com", "round-one-only@example.com"),
      evidence(2, "all-rounds@example.com"),
      evidence(3, "all-rounds@example.com"),
    ]);

    expect(result[1]).toEqual(["all-rounds@example.com", "round-one-only@example.com"]);
    expect(result[2]).toEqual(["all-rounds@example.com"]);
    expect(result[3]).toEqual(["all-rounds@example.com"]);
  });

  it("does not infer participation from absent eligibility or approval records", () => {
    const result = collectRoundParticipationEmails([evidence(1, "approved-but-absent@example.com")]);
    expect(result[1]).toContain("approved-but-absent@example.com");
    expect(result[2]).not.toContain("approved-but-absent@example.com");
    expect(result[3]).not.toContain("approved-but-absent@example.com");
  });
});

describe("round participation workbook", () => {
  it("creates a valid XLSX with exact headers, one email per cell, and empty shorter columns", async () => {
    const buffer = await buildRoundParticipationWorkbook({
      1: ["a@example.com", "b@example.com", "c@example.com"],
      2: ["a@example.com"],
      3: [],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Round Participation");

    expect(sheet).toBeDefined();
    expect([sheet?.getCell("A1").value, sheet?.getCell("B1").value, sheet?.getCell("C1").value]).toEqual([
      "Round 1",
      "Round 2",
      "Round 3",
    ]);
    expect(sheet?.getCell("A2").value).toBe("a@example.com");
    expect(sheet?.getCell("B2").value).toBe("a@example.com");
    expect(sheet?.getCell("C2").value).toBeNull();
    expect(sheet?.getCell("A4").value).toBe("c@example.com");
    expect(sheet?.rowCount).toBe(4);
  });

  it("keeps all three headers when every round is empty", async () => {
    const buffer = await buildRoundParticipationWorkbook({ 1: [], 2: [], 3: [] });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.getWorksheet("Round Participation");
    expect(sheet?.rowCount).toBe(1);
    expect(sheet?.getRow(1).values).toEqual([undefined, "Round 1", "Round 2", "Round 3"]);
  });
});
