import { createRequire } from "node:module";
import type { Archiver } from "archiver";
import { CertificateStatus, TeamRoundStatus } from "../generated/prisma/enums.js";
import { forbidden, notFound } from "../lib/errors.js";
import { prisma } from "../lib/prisma.js";
import { writeAuditLog } from "./audit-service.js";
import { buildParticipationCertificate } from "./certificate-pdf.service.js";
import { downloadPrivateArtifact, uploadPrivateCertificate } from "./storage-service.js";

type RequestContext = { requestId?: string; ipAddress?: string; userAgent?: string };
const archiver = createRequire(import.meta.url)("archiver") as (format: "zip", options: { zlib: { level: number } }) => Archiver;
const safeName = (value: string) => value.normalize("NFKD").replace(/[^a-zA-Z0-9 -]/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "Participant";
const publicCertificate = (certificate: { id: string; memberNameSnapshot: string; certificateCode: string; eliminatedRound: number; status: CertificateStatus; fileName: string; generatedAt: Date | null }) => ({
  id: certificate.id,
  memberName: certificate.memberNameSnapshot,
  certificateCode: certificate.certificateCode,
  eliminatedRound: certificate.eliminatedRound,
  status: certificate.status,
  fileName: certificate.fileName,
  generatedAt: certificate.generatedAt,
});

export async function ensureCertificatesForEliminatedTeam(teamId: string, eliminatedRound: number) {
  const team = await prisma.team.findUnique({ where: { id: teamId }, include: { rosterMembers: { orderBy: { position: "asc" } }, certificates: true } });
  if (!team || !team.onboardedAt || team.rosterMembers.length === 0) return;
  const rejected = await prisma.teamRoundAccess.findFirst({ where: { teamId, status: TeamRoundStatus.REJECTED, round: { number: eliminatedRound } } });
  if (!rejected) return;

  let generatedThisRun = 0;
  for (const member of team.rosterMembers) {
    const existing = team.certificates.find((certificate) => certificate.rosterMemberId === member.id);
    if (existing?.status === CertificateStatus.READY || existing?.status === CertificateStatus.GENERATING) continue;
    const certificateCode = existing?.certificateCode ?? `PRM26-${team.code.replace(/[^A-Z0-9]/gi, "").toUpperCase()}-${String(member.position).padStart(2, "0")}`;
    const fileName = existing?.fileName ?? `PROMPTHON-2026-${safeName(member.name)}-Certificate.pdf`;
    const certificate = await prisma.certificate.upsert({
      where: { rosterMemberId: member.id },
      create: { teamId, rosterMemberId: member.id, memberNameSnapshot: member.name, certificateCode, eliminatedRound, fileName, status: CertificateStatus.GENERATING },
      update: { status: CertificateStatus.GENERATING, failureMessage: null },
    });
    try {
      const pdf = await buildParticipationCertificate({ memberName: certificate.memberNameSnapshot, certificateCode });
      const path = `2026/${team.code}/${certificate.id}/${fileName}`;
      const stored = await uploadPrivateCertificate(path, pdf);
      await prisma.certificate.update({ where: { id: certificate.id }, data: { status: CertificateStatus.READY, storageBucket: stored.bucket, storagePath: stored.path, generatedAt: new Date(), failureMessage: null } });
      generatedThisRun += 1;
    } catch (error) {
      await prisma.certificate.update({ where: { id: certificate.id }, data: { status: CertificateStatus.FAILED, failureMessage: error instanceof Error ? error.message.slice(0, 1000) : "Certificate generation failed." } });
    }
  }

  if (generatedThisRun > 0) await prisma.$transaction(async (tx) => writeAuditLog(tx, { actor: { type: "system" }, action: "CERTIFICATE_GENERATED", entityType: "team", entityId: teamId, metadata: { teamCode: team.code, certificateCount: generatedThisRun, eliminatedRound } }));
}

export async function listTeamCertificates(teamId: string) {
  const [team, rejected] = await Promise.all([
    prisma.team.findUnique({ where: { id: teamId }, include: { rosterMembers: { orderBy: { position: "asc" } }, certificates: { orderBy: { rosterMember: { position: "asc" } } } } }),
    prisma.teamRoundAccess.findFirst({ where: { teamId, status: TeamRoundStatus.REJECTED }, include: { round: { select: { number: true } } }, orderBy: { decidedAt: "desc" } }),
  ]);
  if (!team) throw notFound("Team");
  return {
    eligible: Boolean(rejected),
    eliminatedRound: rejected?.round.number ?? null,
    status: !rejected ? "NOT_ELIGIBLE" : team.certificates.some((item) => item.status === CertificateStatus.FAILED) ? "FAILED" : team.certificates.length > 0 && team.certificates.every((item) => item.status === CertificateStatus.READY) ? "READY" : "GENERATING",
    members: team.rosterMembers.map((member) => ({ id: member.id, position: member.position, name: member.name })),
    certificates: team.certificates.map(publicCertificate),
  };
}

async function ownedReadyCertificate(certificateId: string, teamId: string) {
  const certificate = await prisma.certificate.findFirst({ where: { id: certificateId, teamId, status: CertificateStatus.READY } });
  if (!certificate?.storageBucket || !certificate.storagePath) throw notFound("Certificate");
  return certificate;
}

export async function downloadCertificateForTeam(certificateId: string, participantId: string, teamId: string, context: RequestContext) {
  const certificate = await ownedReadyCertificate(certificateId, teamId);
  const body = await downloadPrivateArtifact(certificate.storageBucket!, certificate.storagePath!);
  await prisma.$transaction(async (tx) => writeAuditLog(tx, { actor: { type: "participant", id: participantId }, action: "CERTIFICATE_DOWNLOADED", entityType: "certificate", entityId: certificate.id, requestId: context.requestId, ipAddress: context.ipAddress, userAgent: context.userAgent }));
  return { body, fileName: certificate.fileName };
}

async function zipCertificates(certificates: Array<{ fileName: string; storageBucket: string | null; storagePath: string | null }>) {
  const archive = archiver("zip", { zlib: { level: 9 } });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => { archive.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk))); archive.on("end", () => resolve(Buffer.concat(chunks))); archive.on("error", reject); });
  for (const certificate of certificates) {
    if (!certificate.storageBucket || !certificate.storagePath) continue;
    archive.append(await downloadPrivateArtifact(certificate.storageBucket, certificate.storagePath), { name: certificate.fileName });
  }
  await archive.finalize();
  return complete;
}

export async function downloadAllCertificatesForTeam(participantId: string, teamId: string, context: RequestContext) {
  const certificates = await prisma.certificate.findMany({ where: { teamId, status: CertificateStatus.READY }, orderBy: { rosterMember: { position: "asc" } } });
  if (certificates.length === 0) throw notFound("Certificates");
  const body = await zipCertificates(certificates);
  await prisma.$transaction(async (tx) => writeAuditLog(tx, { actor: { type: "participant", id: participantId }, action: "CERTIFICATES_ZIP_DOWNLOADED", entityType: "team", entityId: teamId, requestId: context.requestId, ipAddress: context.ipAddress, userAgent: context.userAgent, metadata: { certificateCount: certificates.length } }));
  return { body, fileName: "PROMPTHON-2026-Certificates.zip" };
}

export async function retryTeamCertificates(adminId: string, teamId: string, context: RequestContext) {
  const rejected = await prisma.teamRoundAccess.findFirst({ where: { teamId, status: TeamRoundStatus.REJECTED }, include: { round: true }, orderBy: { decidedAt: "desc" } });
  if (!rejected) throw forbidden("This team is not certificate eligible.");
  await ensureCertificatesForEliminatedTeam(teamId, rejected.round.number);
  await prisma.$transaction(async (tx) => writeAuditLog(tx, { actor: { type: "admin", id: adminId }, action: "certificate.retry", entityType: "team", entityId: teamId, requestId: context.requestId }));
  return listTeamCertificates(teamId);
}

export async function downloadAllCertificatesForAdmin(adminId: string, teamId: string, context: RequestContext) {
  const certificates = await prisma.certificate.findMany({ where: { teamId, status: CertificateStatus.READY }, orderBy: { rosterMember: { position: "asc" } } });
  if (certificates.length === 0) throw notFound("Certificates");
  const body = await zipCertificates(certificates);
  await prisma.$transaction(async (tx) => writeAuditLog(tx, { actor: { type: "admin", id: adminId }, action: "CERTIFICATES_ZIP_DOWNLOADED", entityType: "team", entityId: teamId, requestId: context.requestId, metadata: { certificateCount: certificates.length, adminDownload: true } }));
  return { body, fileName: "PROMPTHON-2026-Certificates.zip" };
}

export async function downloadCertificateForAdmin(adminId: string, certificateId: string, context: RequestContext) {
  const certificate = await prisma.certificate.findFirst({ where: { id: certificateId, status: CertificateStatus.READY } });
  if (!certificate?.storageBucket || !certificate.storagePath) throw notFound("Certificate");
  const body = await downloadPrivateArtifact(certificate.storageBucket, certificate.storagePath);
  await prisma.$transaction(async (tx) => writeAuditLog(tx, {
    actor: { type: "admin", id: adminId },
    action: "CERTIFICATE_DOWNLOADED",
    entityType: "certificate",
    entityId: certificate.id,
    requestId: context.requestId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    metadata: { adminDownload: true },
  }));
  return { body, fileName: certificate.fileName };
}
