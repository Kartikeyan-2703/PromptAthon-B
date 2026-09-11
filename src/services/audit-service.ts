import type { Prisma } from "../generated/prisma/client.js";
import { AuditActorType } from "../generated/prisma/enums.js";

type DbClient = Prisma.TransactionClient;

type AuditInput = {
  actor:
    | { type: "system" }
    | { type: "admin"; id: string }
    | { type: "participant"; id: string };
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Prisma.InputJsonValue;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
};

export const writeAuditLog = async (db: DbClient, input: AuditInput) => {
  const actorType =
    input.actor.type === "admin"
      ? AuditActorType.ADMIN
      : input.actor.type === "participant"
        ? AuditActorType.PARTICIPANT
        : AuditActorType.SYSTEM;

  return db.auditLog.create({
    data: {
      actorType,
      actorAdminId: input.actor.type === "admin" ? input.actor.id : null,
      actorParticipantId: input.actor.type === "participant" ? input.actor.id : null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent?.slice(0, 512),
    },
  });
};
