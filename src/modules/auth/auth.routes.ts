import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { adminLoginSchema, participantEmailSchema, participantLoginSchema } from "./auth.schemas.js";
import { loginAdmin, loginParticipant, logout, verifyParticipantEmail } from "./auth.service.js";
import { validateBody } from "../../middleware/validate.js";
import { clearSessionCookie, setSessionCookie } from "../../services/session-service.js";

const limiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post("/participant/verify-email", limiter, validateBody(participantEmailSchema), async (request, response) => {
  response.json({ data: await verifyParticipantEmail(request.body.email) });
});

authRouter.post("/participant/login", limiter, validateBody(participantLoginSchema), async (request, response) => {
  const result = await loginParticipant(request.body.email, request.body.teamCode, {
    requestId: String(request.id),
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
  });
  setSessionCookie(response, result.session.token, result.session.expiresAt);
  response.json({ data: result.principal });
});

authRouter.post("/admin/login", limiter, validateBody(adminLoginSchema), async (request, response) => {
  const result = await loginAdmin(request.body.email, request.body.password, {
    requestId: String(request.id),
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
  });
  setSessionCookie(response, result.session.token, result.session.expiresAt);
  response.json({ data: result.principal });
});

authRouter.get("/me", (request, response) => {
  response.json({ data: request.auth ?? null });
});

authRouter.post("/logout", async (request, response) => {
  if (request.auth) await logout(request.auth.sessionId);
  clearSessionCookie(response);
  response.status(204).end();
});
