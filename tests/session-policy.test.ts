import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireAdmin, requireParticipant } from "../src/middleware/auth.js";
import { ApiError } from "../src/lib/errors.js";

const run = (middleware: typeof requireParticipant, request: Partial<Request>) => {
  const next = vi.fn() as unknown as NextFunction;
  middleware(request as Request, {} as Response, next);
  return vi.mocked(next);
};

describe("participant session replacement policy", () => {
  it("returns the stable SESSION_REPLACED error only for a replaced participant session", () => {
    const next = run(requireParticipant, { participantSessionFailure: "SESSION_REPLACED" });
    const error = next.mock.calls[0]?.[0] as unknown as ApiError;
    expect(error).toMatchObject({ status: 401, code: "SESSION_REPLACED" });
    expect(error.message).toBe("Your account was signed in on another device.");
  });

  it("keeps ordinary missing authentication on the existing error code", () => {
    const next = run(requireParticipant, {});
    expect(next.mock.calls[0]?.[0]).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
  });

  it("does not alter an authenticated administrator session", () => {
    const next = run(requireAdmin, {
      auth: { kind: "admin", sessionId: "session", adminId: "admin", email: "admin@example.com", status: "ACTIVE" },
    });
    expect(next).toHaveBeenCalledWith();
  });
});
