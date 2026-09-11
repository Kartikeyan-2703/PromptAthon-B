-- Team Code is the team's sole public name, identity, and participant credential.
-- This migration is deliberately resumable because an earlier production attempt
-- completed the team-column changes before failing on a missing check constraint.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='codeLabel')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='teams' AND column_name='code') THEN
    ALTER TABLE "teams" RENAME COLUMN "codeLabel" TO "code";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='submissions' AND column_name='teamNameSnapshot')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='submissions' AND column_name='teamCodeSnapshot') THEN
    ALTER TABLE "submissions" RENAME COLUMN "teamNameSnapshot" TO "teamCodeSnapshot";
  END IF;
END $$;

ALTER TABLE "teams" DROP COLUMN IF EXISTS "name";
DROP INDEX IF EXISTS "teams_accessCodeFingerprint_key";
ALTER TABLE "teams" DROP COLUMN IF EXISTS "accessCodeFingerprint";
ALTER TABLE "teams" DROP COLUMN IF EXISTS "accessCodeHash";

DO $$
BEGIN
  IF to_regclass('public."teams_codeLabel_key"') IS NOT NULL AND to_regclass('public."teams_code_key"') IS NULL THEN
    ALTER INDEX "teams_codeLabel_key" RENAME TO "teams_code_key";
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.teams'::regclass AND conname='teams_code_label_not_blank_check')
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.teams'::regclass AND conname='teams_code_not_blank_check') THEN
    ALTER TABLE "teams" RENAME CONSTRAINT "teams_code_label_not_blank_check" TO "teams_code_not_blank_check";
  END IF;
END $$;
ALTER TABLE "teams" DROP CONSTRAINT IF EXISTS "teams_name_not_blank_check";
CREATE UNIQUE INDEX IF NOT EXISTS "teams_code_key" ON "teams"("code");

ALTER TABLE "submissions" ALTER COLUMN "teamCodeSnapshot" TYPE VARCHAR(24);

ALTER TABLE "import_batches" ADD COLUMN IF NOT EXISTS "eventId" UUID;
UPDATE "import_batches" SET "eventId"=(SELECT "id" FROM "events" ORDER BY "startsAt" DESC LIMIT 1) WHERE "eventId" IS NULL;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "import_batches" WHERE "eventId" IS NULL) THEN
    RAISE EXCEPTION 'Cannot assign import batches: create an event before deploying this migration';
  END IF;
END $$;
ALTER TABLE "import_batches" ALTER COLUMN "eventId" SET NOT NULL;
ALTER TABLE "import_batches" DROP CONSTRAINT IF EXISTS "import_batches_eventId_fkey";
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX IF NOT EXISTS "import_batches_eventId_createdAt_idx" ON "import_batches"("eventId", "createdAt");

ALTER TABLE "import_rows" ADD COLUMN IF NOT EXISTS "teamCode" VARCHAR(24);
ALTER TABLE "import_rows" DROP CONSTRAINT IF EXISTS "import_rows_team_code_format_check";
ALTER TABLE "import_rows" ADD CONSTRAINT "import_rows_team_code_format_check" CHECK ("teamCode" IS NULL OR "teamCode" ~ '^[A-Z0-9][A-Z0-9-]{5,23}$');
CREATE INDEX IF NOT EXISTS "import_rows_teamCode_idx" ON "import_rows"("teamCode");
