import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizeTeamCode } from "../src/lib/crypto.js";
import { participantLoginSchema } from "../src/modules/auth/auth.schemas.js";
import { reviewSchema, submissionQuerySchema } from "../src/modules/admin/admin.schemas.js";
import { completeTeamOnboardingSchema, saveSubmissionSchema } from "../src/modules/participant/participant.schemas.js";

describe("authentication input", () => {
  it("normalizes identity values consistently", () => {
    expect(normalizeEmail("  TEAM.Alpha@Example.COM ")).toBe("team.alpha@example.com");
    expect(normalizeTeamCode(" prm- abc123 ")).toBe("PRM-ABC123");
  });

  it("rejects short team codes and malformed email addresses", () => {
    expect(participantLoginSchema.safeParse({ email: "not-an-email", teamCode: "short" }).success).toBe(false);
  });

  it("normalizes a valid imported team code", () => {
    const result = participantLoginSchema.parse({ email: "member@example.com", teamCode: " prm-1042 " });
    expect(result.teamCode).toBe("PRM-1042");
  });
});

describe("admin review input", () => {
  it("allows immediate rejection without feedback", () => {
    const result = reviewSchema.safeParse({ decision: "REJECTED", expectedVersion: 1 });
    expect(result.success).toBe(true);
  });
});

describe("round-scoped submission review query", () => {
  it("requires an authoritative round number", () => {
    expect(submissionQuerySchema.safeParse({ page: 1 }).success).toBe(false);
  });

  it("accepts only the three competition rounds and canonical statuses", () => {
    expect(submissionQuerySchema.parse({ roundNumber: "2", status: "UNDER_REVIEW" }).roundNumber).toBe(2);
    expect(submissionQuerySchema.safeParse({ roundNumber: 4, status: "APPROVED" }).success).toBe(false);
    expect(submissionQuerySchema.safeParse({ roundNumber: 1, status: "Pending" }).success).toBe(false);
  });
});

describe("round one submission input", () => {
  const questionId = (digit: number) => `00000000-0000-4000-8000-00000000000${digit}`;

  it("accepts four distinct HTTPS conversation records", () => {
    const result = saveSubmissionSchema.safeParse({
      aiTool: "Designated AI",
      answers: [1, 2, 3, 4].map((digit) => ({
        questionId: questionId(digit),
        conversationUrl: `https://example.com/conversations/${digit}`,
      })),
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicated conversation records", () => {
    const result = saveSubmissionSchema.safeParse({
      aiTool: "Designated AI",
      answers: [1, 2].map((digit) => ({
        questionId: questionId(digit),
        conversationUrl: "https://example.com/conversations/same",
      })),
    });
    expect(result.success).toBe(false);
  });
});

describe("team onboarding input", () => {
  it("trims and accepts one to three ordered members", () => {
    expect(completeTeamOnboardingSchema.parse({ members: ["  Member One  ", "Member Two"] })).toEqual({
      members: ["Member One", "Member Two"],
    });
  });

  it("requires Member 1 and rejects more than three members", () => {
    expect(completeTeamOnboardingSchema.safeParse({ members: [] }).success).toBe(false);
    expect(completeTeamOnboardingSchema.safeParse({ members: ["   "] }).success).toBe(false);
    expect(completeTeamOnboardingSchema.safeParse({ members: ["One", "Two", "Three", "Four"] }).success).toBe(false);
  });
});
