ALTER TABLE "teams"
  ADD COLUMN "onboardedAt" TIMESTAMPTZ(3);

CREATE TABLE "team_roster_members" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "position" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "team_roster_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "team_roster_members_teamId_position_key"
  ON "team_roster_members"("teamId", "position");

CREATE INDEX "team_roster_members_teamId_idx"
  ON "team_roster_members"("teamId");

ALTER TABLE "team_roster_members"
  ADD CONSTRAINT "team_roster_members_teamId_fkey"
  FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
