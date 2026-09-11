CREATE TYPE "CertificateStatus" AS ENUM ('ELIGIBLE', 'GENERATING', 'READY', 'FAILED');

CREATE TABLE "certificates" (
  "id" UUID NOT NULL,
  "teamId" UUID NOT NULL,
  "rosterMemberId" UUID NOT NULL,
  "memberNameSnapshot" VARCHAR(120) NOT NULL,
  "certificateCode" VARCHAR(64) NOT NULL,
  "eliminatedRound" INTEGER NOT NULL,
  "status" "CertificateStatus" NOT NULL DEFAULT 'ELIGIBLE',
  "storageBucket" VARCHAR(128),
  "storagePath" TEXT,
  "fileName" VARCHAR(255) NOT NULL,
  "failureMessage" TEXT,
  "generatedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "certificates_rosterMemberId_key" ON "certificates"("rosterMemberId");
CREATE UNIQUE INDEX "certificates_certificateCode_key" ON "certificates"("certificateCode");
CREATE UNIQUE INDEX "certificates_teamId_rosterMemberId_key" ON "certificates"("teamId", "rosterMemberId");
CREATE INDEX "certificates_teamId_status_idx" ON "certificates"("teamId", "status");
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_rosterMemberId_fkey" FOREIGN KEY ("rosterMemberId") REFERENCES "team_roster_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
