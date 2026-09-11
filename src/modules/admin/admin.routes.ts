import { Router, type Request } from "express";
import multer from "multer";
import { z } from "zod";
import { requireAdmin } from "../../middleware/auth.js";
import { validateBody, validateQuery } from "../../middleware/validate.js";
import {
  auditQuerySchema,
  commitImportSchema,
  createTeamsSchema,
  pageQuerySchema,
  previewImportSchema,
  participationReportQuerySchema,
  manualParticipantSchema,
  roundTwoDecisionSchema,
  questionSetSchema,
  reviewSchema,
  submissionQuerySchema,
  versionSchema,
} from "./admin.schemas.js";
import {
  commitImport,
  endRound,
  generateTeams,
  getDashboard,
  getParticipantDetail,
  getSubmissionDetail,
  listAuditLogs,
  listParticipants,
  listRounds,
  listSubmissions,
  markSubmissionUnderReview,
  listRoundTwoEvaluations,
  reviewRoundTwoEvaluation,
  createManualParticipant,
  lockRound,
  previewImport,
  replaceQuestionSet,
  reviewSubmission,
  startRound,
  suggestManualTeamCode,
} from "./admin.service.js";
import {
  auditRoundParticipationExport,
  createRoundParticipationReport,
  ROUND_PARTICIPATION_REPORT_FILENAME,
} from "./round-participation-report.service.js";
import { badRequest } from "../../lib/errors.js";
import { prisma } from "../../lib/prisma.js";
import { downloadArtifactForAdmin } from "../../services/artifact-service.js";
import { downloadAllCertificatesForAdmin, downloadCertificateForAdmin, listTeamCertificates, retryTeamCertificates } from "../../services/certificate-service.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_request, file, callback) => {
    const allowed = new Set([
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ]);
    if (allowed.has(file.mimetype)) callback(null, true);
    else callback(new Error("Only .xlsx Excel files are accepted."));
  },
});

const idSchema = z.uuid();
const admin = (request: Request) => {
  if (!request.auth || request.auth.kind !== "admin") throw new Error("Admin middleware invariant failed.");
  return request.auth;
};
const context = (request: Request) => ({
  requestId: String(request.id),
  ipAddress: request.ip,
  userAgent: request.get("user-agent"),
});

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get("/dashboard", async (_request, response) => {
  response.json({ data: await getDashboard() });
});

adminRouter.get(
  "/reports/round-participation.xlsx",
  validateQuery(participationReportQuerySchema),
  async (request, response) => {
    const { eventId } = participationReportQuerySchema.parse(request.query);
    const report = await createRoundParticipationReport(eventId);
    await auditRoundParticipationExport(admin(request).adminId, report, context(request));
    response
      .status(200)
      .set({
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${ROUND_PARTICIPATION_REPORT_FILENAME}"`,
        "cache-control": "private, no-store, max-age=0",
        "content-length": String(report.buffer.byteLength),
        "x-content-type-options": "nosniff",
      })
      .send(report.buffer);
  },
);

adminRouter.get("/participants", validateQuery(pageQuerySchema), async (request, response) => {
  response.json({ data: await listParticipants(pageQuerySchema.parse(request.query)) });
});

adminRouter.get("/participants/manual/next-team-code", async (request, response) => {
  const eventId = z.uuid().parse(request.query.eventId);
  response.json({ data: await suggestManualTeamCode(eventId) });
});

adminRouter.post("/participants/manual", validateBody(manualParticipantSchema), async (request, response) => {
  response.status(201).json({ data: await createManualParticipant(admin(request).adminId, request.body, context(request)) });
});

adminRouter.get("/participants/:id", async (request, response) => {
  response.json({ data: await getParticipantDetail(idSchema.parse(request.params.id)) });
});

adminRouter.get("/participants/:id/certificates", async (request, response) => {
  const participant = await getParticipantDetail(idSchema.parse(request.params.id));
  if (!participant.membership) throw badRequest("TEAM_REQUIRED", "Participant has no team membership.");
  response.json({ data: await listTeamCertificates(participant.membership.teamId) });
});

adminRouter.post("/participants/:id/certificates/retry", async (request, response) => {
  const participant = await getParticipantDetail(idSchema.parse(request.params.id));
  if (!participant.membership) throw badRequest("TEAM_REQUIRED", "Participant has no team membership.");
  response.json({ data: await retryTeamCertificates(admin(request).adminId, participant.membership.teamId, context(request)) });
});

adminRouter.get("/participants/:id/certificates/download-all", async (request, response) => {
  const participant = await getParticipantDetail(idSchema.parse(request.params.id));
  if (!participant.membership) throw badRequest("TEAM_REQUIRED", "Participant has no team membership.");
  const result = await downloadAllCertificatesForAdmin(admin(request).adminId, participant.membership.teamId, context(request));
  response.set({ "content-type": "application/zip", "content-disposition": `attachment; filename="${result.fileName}"`, "cache-control": "private, no-store" }).send(result.body);
});

adminRouter.get("/certificates/:id/download", async (request, response) => {
  const result = await downloadCertificateForAdmin(admin(request).adminId, idSchema.parse(request.params.id), context(request));
  response.set({ "content-type": "application/pdf", "content-disposition": `inline; filename="${result.fileName.replace(/["\\]/g, "-")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).send(result.body);
});

adminRouter.get("/submissions", validateQuery(submissionQuerySchema), async (request, response) => {
  response.json({ data: await listSubmissions(submissionQuerySchema.parse(request.query)) });
});

adminRouter.get("/submissions/round-2/offline-evaluations", async (_request, response) => {
  response.json({ data: await listRoundTwoEvaluations() });
});

adminRouter.get("/submissions/:id", async (request, response) => {
  response.json({ data: await getSubmissionDetail(idSchema.parse(request.params.id)) });
});

adminRouter.get("/artifacts/:id", async (request, response) => {
  const result = await downloadArtifactForAdmin(idSchema.parse(request.params.id));
  response.set({ "content-type": result.artifact.mimeType, "content-disposition": `inline; filename="${(result.artifact.originalName || "artifact").replace(/["\\]/g, "-")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).send(result.body);
});

adminRouter.post("/submissions/:id/review", validateBody(reviewSchema), async (request, response) => {
  response.json({
    data: await reviewSubmission(
      admin(request).adminId,
      idSchema.parse(request.params.id),
      request.body,
      context(request),
    ),
  });
});

adminRouter.post("/submissions/:id/under-review", validateBody(versionSchema), async (request, response) => {
  response.json({
    data: await markSubmissionUnderReview(
      admin(request).adminId,
      idSchema.parse(request.params.id),
      request.body.expectedVersion,
      context(request),
    ),
  });
});

adminRouter.get("/rounds", async (_request, response) => {
  response.json({ data: await listRounds() });
});

adminRouter.post("/submissions/round-2/offline-evaluations/:teamId/review", validateBody(roundTwoDecisionSchema), async (request, response) => {
  const evaluations = await listRoundTwoEvaluations();
  response.json({
    data: await reviewRoundTwoEvaluation(
      admin(request).adminId,
      evaluations.round.id,
      idSchema.parse(request.params.teamId),
      request.body,
      context(request),
    ),
  });
});

adminRouter.post("/rounds/:id/start", validateBody(versionSchema), async (request, response) => {
  response.json({
    data: await startRound(admin(request).adminId, idSchema.parse(request.params.id), request.body.expectedVersion, context(request)),
  });
});

adminRouter.post("/rounds/:id/end", validateBody(versionSchema), async (request, response) => {
  response.json({
    data: await endRound(admin(request).adminId, idSchema.parse(request.params.id), request.body.expectedVersion, context(request)),
  });
});

adminRouter.post("/rounds/:id/lock", validateBody(versionSchema), async (request, response) => {
  response.json({
    data: await lockRound(admin(request).adminId, idSchema.parse(request.params.id), request.body.expectedVersion, context(request)),
  });
});

adminRouter.get("/rounds/:id/questions", async (request, response) => {
  const roundId = idSchema.parse(request.params.id);
  response.json({ data: await prisma.question.findMany({ where: { roundId }, orderBy: { position: "asc" } }) });
});

adminRouter.put("/rounds/:id/questions", validateBody(questionSetSchema), async (request, response) => {
  response.json({
    data: await replaceQuestionSet(
      admin(request).adminId,
      idSchema.parse(request.params.id),
      request.body.questions,
      context(request),
    ),
  });
});

adminRouter.post("/teams/generate", validateBody(createTeamsSchema), async (request, response) => {
  response.status(201).json({
    data: await generateTeams(admin(request).adminId, request.body, context(request)),
    meta: { warning: "Access codes are returned once. Store and distribute them securely." },
  });
});

adminRouter.post("/imports/preview", upload.single("file"), async (request, response) => {
  if (!request.file) throw badRequest("FILE_REQUIRED", "Attach one .xlsx file in the file field.");
  const { eventId } = previewImportSchema.parse(request.body);
  response.status(201).json({
    data: await previewImport(admin(request).adminId, eventId, request.file, context(request)),
  });
});

adminRouter.post("/imports/:id/commit", validateBody(commitImportSchema), async (request, response) => {
  response.json({
    data: await commitImport(
      admin(request).adminId,
      idSchema.parse(request.params.id),
      request.body.expectedVersion,
      context(request),
    ),
  });
});

adminRouter.get("/audit-logs", validateQuery(auditQuerySchema), async (request, response) => {
  response.json({ data: await listAuditLogs(auditQuerySchema.parse(request.query)) });
});
