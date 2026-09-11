ALTER TABLE "auth_sessions"
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "revokedReason" VARCHAR(40),
  ADD COLUMN "replacedBySessionId" UUID;

UPDATE "auth_sessions"
SET "isActive" = false
WHERE "revokedAt" IS NOT NULL OR "expiresAt" <= CURRENT_TIMESTAMP;

WITH ranked AS (
  SELECT "id", ROW_NUMBER() OVER (
    PARTITION BY "participantId"
    ORDER BY "createdAt" DESC, "id" DESC
  ) AS position
  FROM "auth_sessions"
  WHERE "participantId" IS NOT NULL AND "isActive" = true
)
UPDATE "auth_sessions" AS session
SET "isActive" = false,
    "revokedAt" = COALESCE(session."revokedAt", CURRENT_TIMESTAMP),
    "revokedReason" = COALESCE(session."revokedReason", 'MIGRATION_DEDUPLICATION')
FROM ranked
WHERE session."id" = ranked."id" AND ranked.position > 1;

CREATE INDEX "auth_sessions_participantId_isActive_idx"
  ON "auth_sessions"("participantId", "isActive");

CREATE UNIQUE INDEX "auth_sessions_one_active_participant_session"
  ON "auth_sessions"("participantId")
  WHERE "participantId" IS NOT NULL AND "isActive" = true;
