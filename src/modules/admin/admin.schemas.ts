import { z } from "zod";

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  search: z.string().trim().max(200).optional(),
  status: z.string().trim().max(40).optional(),
});

export const submissionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(12),
  roundNumber: z.coerce.number().int().min(1).max(3),
  eventId: z.uuid().optional(),
  search: z.string().trim().max(200).optional(),
  status: z.enum(["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"]).optional(),
});

export const auditQuerySchema = z.object({
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(80).optional(),
});

export const versionSchema = z.object({ expectedVersion: z.number().int().positive() });

export const roundTwoDecisionSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  expectedVersion: z.number().int().positive(),
});

export const reviewSchema = z.object({
  decision: z.enum(["APPROVED", "REJECTED"]),
  score: z.number().min(0).max(100).optional(),
  feedback: z.string().trim().max(10_000).optional(),
  expectedVersion: z.number().int().positive(),
});

export const createTeamsSchema = z.object({
  eventId: z.uuid(),
  count: z.number().int().min(1).max(100),
});

export const previewImportSchema = z.object({ eventId: z.uuid() });

export const manualParticipantSchema = z.object({
  eventId: z.uuid(),
  name: z.string().trim().min(1).max(120),
  email: z.email().max(320).transform((value) => value.trim().toLowerCase()),
  teamCode: z.string().trim().regex(/^PROM-2026\d{3}$/).optional(),
});

export const questionSetSchema = z.object({
  questions: z
    .array(
      z.object({
        id: z.uuid().optional(),
        code: z.string().trim().min(1).max(32),
        position: z.number().int().min(1).max(100),
        title: z.string().trim().min(2).max(200),
        body: z.string().trim().min(2).max(20_000),
        status: z.enum(["DRAFT", "PUBLISHED", "ARCHIVED"]),
        isPlaceholder: z.boolean().default(false),
      }),
    )
    .min(1)
    .max(100),
});

export const commitImportSchema = z.object({ expectedVersion: z.number().int().positive() });

export const participationReportQuerySchema = z.object({
  eventId: z.uuid().optional(),
});
