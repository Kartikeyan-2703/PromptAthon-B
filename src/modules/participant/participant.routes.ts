import { Router } from "express";
import { z } from "zod";
import { requireParticipant } from "../../middleware/auth.js";
import { validateBody } from "../../middleware/validate.js";
import { completeTeamOnboardingSchema, roundNumberSchema, saveSubmissionSchema } from "./participant.schemas.js";
import { assertTeamOnboarded, completeTeamOnboarding, getTeamOnboarding } from "./participant-onboarding.service.js";
import {
  getLeaderboard,
  getParticipantOverview,
  getParticipantRound,
  getParticipantRounds,
  saveSubmissionDraft,
  submitRound,
} from "./participant.service.js";
import { downloadArtifactForTeam } from "../../services/artifact-service.js";
import { downloadAllCertificatesForTeam, downloadCertificateForTeam, listTeamCertificates } from "../../services/certificate-service.js";

export const participantRouter = Router();
participantRouter.use(requireParticipant);

const participantAuth = (request: Parameters<Parameters<typeof participantRouter.get>[1]>[0]) => {
  if (!request.auth || request.auth.kind !== "participant") throw new Error("Participant guard invariant failed");
  return request.auth;
};

participantRouter.get("/onboarding", async (request, response) => {
  response.json({ data: await getTeamOnboarding(participantAuth(request).teamId) });
});

participantRouter.post("/onboarding", validateBody(completeTeamOnboardingSchema), async (request, response) => {
  const auth = participantAuth(request);
  response.status(201).json({ data: await completeTeamOnboarding(auth.participantId, auth.teamId, request.body.members, String(request.id)) });
});

participantRouter.use(async (request, _response, next) => {
  try {
    await assertTeamOnboarded(participantAuth(request).teamId);
    next();
  } catch (error) {
    next(error);
  }
});

participantRouter.get("/overview", async (request, response) => {
  const auth = participantAuth(request);
  response.json({ data: await getParticipantOverview(auth.participantId, auth.teamId) });
});

participantRouter.get("/rounds", async (request, response) => {
  response.json({ data: await getParticipantRounds(participantAuth(request).teamId) });
});

participantRouter.get("/rounds/:roundNumber", async (request, response) => {
  const roundNumber = roundNumberSchema.parse(request.params.roundNumber);
  response.json({ data: await getParticipantRound(participantAuth(request).teamId, roundNumber) });
});

participantRouter.put("/rounds/:roundNumber/submission", validateBody(saveSubmissionSchema), async (request, response) => {
  const auth = participantAuth(request);
  const roundNumber = roundNumberSchema.parse(request.params.roundNumber);
  response.json({
    data: await saveSubmissionDraft(auth.participantId, auth.teamId, roundNumber, request.body, String(request.id)),
  });
});

participantRouter.post("/rounds/:roundNumber/submission/submit", validateBody(z.object({})), async (request, response) => {
  const auth = participantAuth(request);
  const roundNumber = roundNumberSchema.parse(request.params.roundNumber);
  response.json({ data: await submitRound(auth.participantId, auth.teamId, roundNumber, String(request.id)) });
});

participantRouter.get("/artifacts/:id", async (request, response) => {
  const result = await downloadArtifactForTeam(z.uuid().parse(request.params.id), participantAuth(request).teamId);
  response.set({ "content-type": result.artifact.mimeType, "content-disposition": `inline; filename="${(result.artifact.originalName || "artifact").replace(/["\\]/g, "-")}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" }).send(result.body);
});

participantRouter.get("/leaderboard", async (request, response) => {
  response.json({ data: await getLeaderboard(participantAuth(request).teamId) });
});

const requestContext = (request: Parameters<Parameters<typeof participantRouter.get>[1]>[0]) => ({ requestId: String(request.id), ipAddress: request.ip, userAgent: request.get("user-agent") });

participantRouter.get("/certificates", async (request, response) => {
  response.json({ data: await listTeamCertificates(participantAuth(request).teamId) });
});

participantRouter.get("/certificates/download-all", async (request, response) => {
  const auth = participantAuth(request);
  const result = await downloadAllCertificatesForTeam(auth.participantId, auth.teamId, requestContext(request));
  response.set({ "content-type": "application/zip", "content-disposition": `attachment; filename="${result.fileName}"`, "cache-control": "private, no-store" }).send(result.body);
});

participantRouter.get("/certificates/:id/download", async (request, response) => {
  const auth = participantAuth(request);
  const result = await downloadCertificateForTeam(z.uuid().parse(request.params.id), auth.participantId, auth.teamId, requestContext(request));
  response.set({ "content-type": "application/pdf", "content-disposition": `attachment; filename="${result.fileName.replace(/["\\]/g, "-")}"`, "cache-control": "private, no-store" }).send(result.body);
});
