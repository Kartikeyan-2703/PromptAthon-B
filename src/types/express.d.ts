import type { AdminStatus, ParticipantStatus } from "../generated/prisma/enums.js";

declare global {
  namespace Express {
    interface Request {
      auth?:
        | {
            kind: "admin";
            sessionId: string;
            adminId: string;
            email: string;
            status: AdminStatus;
          }
        | {
            kind: "participant";
            sessionId: string;
            participantId: string;
            email: string;
            status: ParticipantStatus;
            teamId: string;
          };
      participantSessionFailure?: "SESSION_REPLACED";
    }
  }
}

export {};
