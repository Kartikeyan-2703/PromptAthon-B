import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { adminLoginSchema, participantEmailSchema, participantLoginSchema } from "./auth.schemas.js";
import { loginAdmin, loginParticipant, logout, verifyParticipantEmail } from "./auth.service.js";
import { validateBody } from "../../middleware/validate.js";
import { clearSessionCookie, setSessionCookie } from "../../services/session-service.js";

const rateLimitResponse = (request: Request, response: Response) => {
  response.status(429).json({
    error: {
      code: "AUTH_RATE_LIMITED",
      message: "Too many attempts for this account. Please wait a few minutes and try again.",
      requestId: request.id,
    },
  });
};

const participantKey = (request: { body?: { email?: unknown } }) =>
  String(request.body?.email ?? "missing-email").trim().toLowerCase();

// Participants commonly access the event from one campus/NAT address. Limiting
// them all by IP would cause a handful of teams to block every other team.
// Participant limits are therefore isolated by normalized account email.
const participantVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: participantKey,
  handler: rateLimitResponse,
});

const participantLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  keyGenerator: participantKey,
  handler: rateLimitResponse,
});

const adminLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  handler: rateLimitResponse,
});

export const authRouter = Router();

authRouter.post("/participant/verify-email", participantVerifyLimiter, validateBody(participantEmailSchema), async (request, response) => {
  response.json({ data: await verifyParticipantEmail(request.body.email) });
});

authRouter.post("/participant/login", participantLoginLimiter, validateBody(participantLoginSchema), async (request, response) => {
  const result = await loginParticipant(request.body.email, request.body.teamCode, {
    requestId: String(request.id),
    ipAddress: request.ip,
    userAgent: request.get("user-agent"),
  });
  setSessionCookie(response, result.session.token, result.session.expiresAt);
  response.json({ data: result.principal });
});

authRouter.post("/admin/login", adminLoginLimiter, validateBody(adminLoginSchema), async (request, response) => {
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
