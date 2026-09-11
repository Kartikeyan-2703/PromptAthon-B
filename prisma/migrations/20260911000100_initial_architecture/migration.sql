-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "AdminStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoundStatus" AS ENUM ('LOCKED', 'LIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "RoundKind" AS ENUM ('VAGUE_TO_PRECISE', 'PROMPT_REVERSE_ENGINEERING', 'IMAGE_RECREATION');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('ADMITTED', 'ACTIVE', 'SUSPENDED', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'DISQUALIFIED');

-- CreateEnum
CREATE TYPE "TeamRoundStatus" AS ENUM ('LOCKED', 'ELIGIBLE', 'IN_PROGRESS', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "EvaluationDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('CONVERSATION_EXPORT', 'GENERATED_IMAGE', 'REFERENCE_IMAGE', 'SUPPORTING_FILE');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PREVIEWED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('VALID', 'INVALID', 'IMPORTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('SYSTEM', 'ADMIN', 'PARTICIPANT');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    "status" "AdminStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastLoginAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
    "venue" VARCHAR(200),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rounds" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "kind" "RoundKind" NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "RoundStatus" NOT NULL DEFAULT 'LOCKED',
    "startsAt" TIMESTAMPTZ(3),
    "endsAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "round_rules" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "round_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "status" "ParticipantStatus" NOT NULL DEFAULT 'ADMITTED',
    "importedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "codeLabel" VARCHAR(24) NOT NULL,
    "accessCodeFingerprint" CHAR(64) NOT NULL,
    "accessCodeHash" VARCHAR(255) NOT NULL,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_members" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "participantId" UUID NOT NULL,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_round_accesses" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "status" "TeamRoundStatus" NOT NULL DEFAULT 'LOCKED',
    "unlockedAt" TIMESTAMPTZ(3),
    "submittedAt" TIMESTAMPTZ(3),
    "decidedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "team_round_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "questions" (
    "id" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "isPlaceholder" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_question_assignments" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "assignedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_question_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "teamNameSnapshot" VARCHAR(120),
    "aiTool" VARCHAR(120),
    "submittedAt" TIMESTAMPTZ(3),
    "lockedAt" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_answers" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "roundId" UUID NOT NULL,
    "questionId" UUID NOT NULL,
    "conversationUrl" TEXT,
    "promptText" TEXT,
    "responseText" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "submission_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_artifacts" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "questionId" UUID,
    "kind" "ArtifactKind" NOT NULL,
    "storageBucket" VARCHAR(128) NOT NULL,
    "storagePath" TEXT NOT NULL,
    "originalName" VARCHAR(255),
    "mimeType" VARCHAR(127) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksumSha256" CHAR(64),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "submission_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "evaluatorId" UUID NOT NULL,
    "decision" "EvaluationDecision" NOT NULL,
    "score" DECIMAL(6,2),
    "feedback" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "evaluatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "adminUserId" UUID,
    "participantId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "ipAddress" INET,
    "userAgent" VARCHAR(512),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_batches" (
    "id" UUID NOT NULL,
    "importedById" UUID NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "checksumSha256" CHAR(64) NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PREVIEWED',
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "committedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_rows" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "name" VARCHAR(120),
    "email" VARCHAR(320),
    "status" "ImportRowStatus" NOT NULL,
    "errorCode" VARCHAR(80),
    "errorMessage" TEXT,
    "participantId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorAdminId" UUID,
    "actorParticipantId" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entityType" VARCHAR(80) NOT NULL,
    "entityId" VARCHAR(100),
    "requestId" VARCHAR(100),
    "ipAddress" INET,
    "userAgent" VARCHAR(512),
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "rounds_eventId_status_idx" ON "rounds"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "rounds_eventId_number_key" ON "rounds"("eventId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "round_rules_roundId_position_key" ON "round_rules"("roundId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "participants_email_key" ON "participants"("email");

-- CreateIndex
CREATE INDEX "participants_status_createdAt_idx" ON "participants"("status", "createdAt");

-- CreateIndex
CREATE INDEX "participants_deletedAt_idx" ON "participants"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "teams_codeLabel_key" ON "teams"("codeLabel");

-- CreateIndex
CREATE UNIQUE INDEX "teams_accessCodeFingerprint_key" ON "teams"("accessCodeFingerprint");

-- CreateIndex
CREATE INDEX "teams_eventId_status_idx" ON "teams"("eventId", "status");

-- CreateIndex
CREATE INDEX "teams_deletedAt_idx" ON "teams"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_participantId_key" ON "team_members"("participantId");

-- CreateIndex
CREATE INDEX "team_members_teamId_joinedAt_idx" ON "team_members"("teamId", "joinedAt");

-- CreateIndex
CREATE UNIQUE INDEX "team_members_teamId_participantId_key" ON "team_members"("teamId", "participantId");

-- CreateIndex
CREATE INDEX "team_round_accesses_roundId_status_idx" ON "team_round_accesses"("roundId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "team_round_accesses_teamId_roundId_key" ON "team_round_accesses"("teamId", "roundId");

-- CreateIndex
CREATE INDEX "questions_roundId_status_idx" ON "questions"("roundId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "questions_id_roundId_key" ON "questions"("id", "roundId");

-- CreateIndex
CREATE UNIQUE INDEX "questions_roundId_code_key" ON "questions"("roundId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "questions_roundId_position_key" ON "questions"("roundId", "position");

-- CreateIndex
CREATE INDEX "team_question_assignments_roundId_questionId_idx" ON "team_question_assignments"("roundId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "team_question_assignments_teamId_roundId_position_key" ON "team_question_assignments"("teamId", "roundId", "position");

-- CreateIndex
CREATE UNIQUE INDEX "team_question_assignments_teamId_questionId_key" ON "team_question_assignments"("teamId", "questionId");

-- CreateIndex
CREATE INDEX "submissions_roundId_status_submittedAt_idx" ON "submissions"("roundId", "status", "submittedAt");

-- CreateIndex
CREATE INDEX "submissions_teamId_status_idx" ON "submissions"("teamId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "submissions_teamId_roundId_key" ON "submissions"("teamId", "roundId");

-- CreateIndex
CREATE INDEX "submission_answers_roundId_questionId_idx" ON "submission_answers"("roundId", "questionId");

-- CreateIndex
CREATE UNIQUE INDEX "submission_answers_submissionId_questionId_key" ON "submission_answers"("submissionId", "questionId");

-- CreateIndex
CREATE INDEX "submission_artifacts_submissionId_kind_idx" ON "submission_artifacts"("submissionId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "submission_artifacts_storageBucket_storagePath_key" ON "submission_artifacts"("storageBucket", "storagePath");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_submissionId_key" ON "evaluations"("submissionId");

-- CreateIndex
CREATE INDEX "evaluations_evaluatorId_evaluatedAt_idx" ON "evaluations"("evaluatorId", "evaluatedAt");

-- CreateIndex
CREATE INDEX "evaluations_score_idx" ON "evaluations"("score");

-- CreateIndex
CREATE UNIQUE INDEX "auth_sessions_tokenHash_key" ON "auth_sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "auth_sessions_adminUserId_expiresAt_idx" ON "auth_sessions"("adminUserId", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_participantId_expiresAt_idx" ON "auth_sessions"("participantId", "expiresAt");

-- CreateIndex
CREATE INDEX "auth_sessions_expiresAt_revokedAt_idx" ON "auth_sessions"("expiresAt", "revokedAt");

-- CreateIndex
CREATE INDEX "import_batches_importedById_createdAt_idx" ON "import_batches"("importedById", "createdAt");

-- CreateIndex
CREATE INDEX "import_batches_status_createdAt_idx" ON "import_batches"("status", "createdAt");

-- CreateIndex
CREATE INDEX "import_rows_batchId_status_idx" ON "import_rows"("batchId", "status");

-- CreateIndex
CREATE INDEX "import_rows_email_idx" ON "import_rows"("email");

-- CreateIndex
CREATE UNIQUE INDEX "import_rows_batchId_rowNumber_key" ON "import_rows"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_id_idx" ON "audit_logs"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_createdAt_idx" ON "audit_logs"("entityType", "entityId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorAdminId_createdAt_idx" ON "audit_logs"("actorAdminId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actorParticipantId_createdAt_idx" ON "audit_logs"("actorParticipantId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "rounds" ADD CONSTRAINT "rounds_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "round_rules" ADD CONSTRAINT "round_rules_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "teams" ADD CONSTRAINT "teams_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_round_accesses" ADD CONSTRAINT "team_round_accesses_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_round_accesses" ADD CONSTRAINT "team_round_accesses_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "questions" ADD CONSTRAINT "questions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_question_assignments" ADD CONSTRAINT "team_question_assignments_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_question_assignments" ADD CONSTRAINT "team_question_assignments_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_question_assignments" ADD CONSTRAINT "team_question_assignments_questionId_roundId_fkey" FOREIGN KEY ("questionId", "roundId") REFERENCES "questions"("id", "roundId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "rounds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_answers" ADD CONSTRAINT "submission_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_artifacts" ADD CONSTRAINT "submission_artifacts_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_artifacts" ADD CONSTRAINT "submission_artifacts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "submissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_evaluatorId_fkey" FOREIGN KEY ("evaluatorId") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorAdminId_fkey" FOREIGN KEY ("actorAdminId") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorParticipantId_fkey" FOREIGN KEY ("actorParticipantId") REFERENCES "participants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Database-enforced invariants that Prisma's schema language cannot express.
ALTER TABLE "events"
  ADD CONSTRAINT "events_valid_window_check" CHECK ("endsAt" > "startsAt");

ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_number_check" CHECK ("number" BETWEEN 1 AND 3),
  ADD CONSTRAINT "rounds_valid_window_check" CHECK ("endsAt" IS NULL OR "startsAt" IS NULL OR "endsAt" > "startsAt"),
  ADD CONSTRAINT "rounds_version_check" CHECK ("version" > 0);

CREATE UNIQUE INDEX "rounds_one_live_per_event_key"
  ON "rounds" ("eventId")
  WHERE "status" = 'LIVE';

ALTER TABLE "round_rules"
  ADD CONSTRAINT "round_rules_position_check" CHECK ("position" > 0);

ALTER TABLE "participants"
  ADD CONSTRAINT "participants_normalized_email_check" CHECK ("email" = lower(btrim("email"))),
  ADD CONSTRAINT "participants_name_not_blank_check" CHECK (length(btrim("name")) > 0);

ALTER TABLE "teams"
  ADD CONSTRAINT "teams_name_not_blank_check" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "teams_code_label_not_blank_check" CHECK (length(btrim("codeLabel")) > 0);

ALTER TABLE "team_round_accesses"
  ADD CONSTRAINT "team_round_accesses_version_check" CHECK ("version" > 0);

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_position_check" CHECK ("position" > 0),
  ADD CONSTRAINT "questions_content_not_blank_check" CHECK (length(btrim("title")) > 0 AND length(btrim("body")) > 0);

ALTER TABLE "team_question_assignments"
  ADD CONSTRAINT "team_question_assignments_position_check" CHECK ("position" > 0);

ALTER TABLE "submissions"
  ADD CONSTRAINT "submissions_version_check" CHECK ("version" > 0),
  ADD CONSTRAINT "submissions_submission_time_check" CHECK (
    ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "lockedAt" IS NULL)
    OR
    ("status" <> 'DRAFT' AND "submittedAt" IS NOT NULL AND "lockedAt" IS NOT NULL)
  );

ALTER TABLE "submission_artifacts"
  ADD CONSTRAINT "submission_artifacts_size_check" CHECK ("sizeBytes" >= 0);

ALTER TABLE "evaluations"
  ADD CONSTRAINT "evaluations_score_check" CHECK ("score" IS NULL OR ("score" >= 0 AND "score" <= 100)),
  ADD CONSTRAINT "evaluations_version_check" CHECK ("version" > 0);

ALTER TABLE "auth_sessions"
  ADD CONSTRAINT "auth_sessions_one_principal_check" CHECK (
    (("adminUserId" IS NOT NULL)::int + ("participantId" IS NOT NULL)::int) = 1
  ),
  ADD CONSTRAINT "auth_sessions_expiry_check" CHECK ("expiresAt" > "createdAt");

ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_counts_check" CHECK (
    "totalRows" >= 0 AND "validRows" >= 0 AND "invalidRows" >= 0
    AND "importedRows" >= 0 AND "duplicateRows" >= 0
    AND "validRows" + "invalidRows" = "totalRows"
    AND "importedRows" + "duplicateRows" <= "validRows"
  ),
  ADD CONSTRAINT "import_batches_version_check" CHECK ("version" > 0);

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_row_number_check" CHECK ("rowNumber" > 0),
  ADD CONSTRAINT "import_rows_normalized_email_check" CHECK ("email" IS NULL OR "email" = lower(btrim("email")));

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_shape_check" CHECK (
    ("actorType" = 'SYSTEM' AND "actorAdminId" IS NULL AND "actorParticipantId" IS NULL)
    OR ("actorType" = 'ADMIN' AND "actorAdminId" IS NOT NULL AND "actorParticipantId" IS NULL)
    OR ("actorType" = 'PARTICIPANT' AND "actorAdminId" IS NULL AND "actorParticipantId" IS NOT NULL)
  );

-- At most three members can join a team, including during concurrent logins.
CREATE OR REPLACE FUNCTION enforce_team_member_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW."teamId"::text, 0));

  IF (SELECT count(*) FROM "team_members" WHERE "teamId" = NEW."teamId") >= 3 THEN
    RAISE EXCEPTION 'team_member_limit_exceeded' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "team_members_limit_trigger"
BEFORE INSERT OR UPDATE OF "teamId" ON "team_members"
FOR EACH ROW EXECUTE FUNCTION enforce_team_member_limit();

-- Answers must refer to the same round as their submission and to a question
-- assigned to that submission's team.
CREATE OR REPLACE FUNCTION validate_submission_answer_scope()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  submission_team_id uuid;
  submission_round_id uuid;
  question_round_id uuid;
BEGIN
  SELECT "teamId", "roundId"
  INTO submission_team_id, submission_round_id
  FROM "submissions"
  WHERE "id" = NEW."submissionId";

  SELECT "roundId"
  INTO question_round_id
  FROM "questions"
  WHERE "id" = NEW."questionId";

  IF submission_round_id IS NULL OR question_round_id IS NULL
     OR submission_round_id <> NEW."roundId"
     OR question_round_id <> NEW."roundId" THEN
    RAISE EXCEPTION 'submission_answer_round_mismatch' USING ERRCODE = '23514';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "team_question_assignments"
    WHERE "teamId" = submission_team_id
      AND "roundId" = NEW."roundId"
      AND "questionId" = NEW."questionId"
  ) THEN
    RAISE EXCEPTION 'question_not_assigned_to_team' USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "submission_answers_scope_trigger"
BEFORE INSERT OR UPDATE ON "submission_answers"
FOR EACH ROW EXECUTE FUNCTION validate_submission_answer_scope();

-- Keep updatedAt database-authored even when writes do not originate in Prisma.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "admin_users_updated_at" BEFORE UPDATE ON "admin_users" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "events_updated_at" BEFORE UPDATE ON "events" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "rounds_updated_at" BEFORE UPDATE ON "rounds" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "round_rules_updated_at" BEFORE UPDATE ON "round_rules" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "participants_updated_at" BEFORE UPDATE ON "participants" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "teams_updated_at" BEFORE UPDATE ON "teams" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "team_round_accesses_updated_at" BEFORE UPDATE ON "team_round_accesses" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "questions_updated_at" BEFORE UPDATE ON "questions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "submissions_updated_at" BEFORE UPDATE ON "submissions" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "submission_answers_updated_at" BEFORE UPDATE ON "submission_answers" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "evaluations_updated_at" BEFORE UPDATE ON "evaluations" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "import_batches_updated_at" BEFORE UPDATE ON "import_batches" FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER "import_rows_updated_at" BEFORE UPDATE ON "import_rows" FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Audit records are append-only. Corrections are represented by new entries.
CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs_are_append_only' USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "audit_logs_immutable_trigger"
BEFORE UPDATE OR DELETE ON "audit_logs"
FOR EACH ROW EXECUTE FUNCTION prevent_audit_log_mutation();
