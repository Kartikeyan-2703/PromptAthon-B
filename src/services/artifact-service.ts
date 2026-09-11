import { createHash } from "node:crypto";
import { ArtifactKind, RoundKind, RoundStatus, SubmissionStatus, TeamRoundStatus } from "../generated/prisma/enums.js";
import { forbidden, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { downloadPrivateArtifact, removePrivateArtifact, uploadPrivateArtifact } from "./storage-service.js";

export async function uploadRoundThreeArtifact(participantId: string, teamId: string, roundNumber: number, file: Express.Multer.File, questionId?: string) {
  const submission = await prisma.submission.findFirst({
    where: { teamId, round: { number: roundNumber } },
    include: { round: { include: { accesses: { where: { teamId } }, event: true, assignments: { where: { teamId } } } } },
  });
  if (!submission) throw notFound("Submission draft");
  if (submission.round.kind !== RoundKind.IMAGE_RECREATION || submission.round.status !== RoundStatus.LIVE || submission.status !== SubmissionStatus.DRAFT) throw forbidden("Artifacts can only be uploaded to an active Round 3 draft.");
  const access = submission.round.accesses[0];
  if (!access || (access.status !== TeamRoundStatus.ELIGIBLE && access.status !== TeamRoundStatus.IN_PROGRESS)) throw forbidden("This team cannot upload to this round.");
  if (questionId && !submission.round.assignments.some((assignment) => assignment.questionId === questionId)) throw forbidden("The artifact question is not assigned to this team.");

  const stored = await uploadPrivateArtifact({ eventId: submission.round.eventId, teamId, roundId: submission.roundId, submissionId: submission.id, originalName: file.originalname, mimeType: file.mimetype, body: file.buffer });
  try {
    return await prisma.submissionArtifact.create({ data: { submissionId: submission.id, questionId, kind: ArtifactKind.GENERATED_IMAGE, storageBucket: stored.bucket, storagePath: stored.path, originalName: file.originalname, mimeType: file.mimetype, sizeBytes: file.size, checksumSha256: createHash("sha256").update(file.buffer).digest("hex") } });
  } catch (error) {
    await removePrivateArtifact(stored.bucket, stored.path);
    throw error;
  }
}

export async function downloadArtifactForTeam(artifactId: string, teamId: string) {
  const artifact = await prisma.submissionArtifact.findFirst({ where: { id: artifactId, submission: { teamId } } });
  if (!artifact) throw notFound("Artifact");
  return { artifact, body: await downloadPrivateArtifact(artifact.storageBucket, artifact.storagePath) };
}

export async function downloadArtifactForAdmin(artifactId: string) {
  const artifact = await prisma.submissionArtifact.findUnique({ where: { id: artifactId } });
  if (!artifact) throw notFound("Artifact");
  return { artifact, body: await downloadPrivateArtifact(artifact.storageBucket, artifact.storagePath) };
}
