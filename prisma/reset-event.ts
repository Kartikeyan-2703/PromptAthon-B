import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { EventStatus, ParticipantStatus, RoundStatus, TeamStatus } from "../src/generated/prisma/enums.js";

if (process.env.CONFIRM_EVENT_RESET !== "RESET_PROMPTHON_2026") {
  throw new Error("Refusing destructive reset. Set CONFIRM_EVENT_RESET=RESET_PROMPTHON_2026 for this command only.");
}
const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const removeStoredObjects = async (objects: Array<{ storageBucket: string | null; storagePath: string | null }>) => {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) {
    if (objects.length) throw new Error("Storage credentials are required to remove existing event artifacts safely.");
    return;
  }
  for (const object of objects) {
    if (!object.storageBucket || !object.storagePath) continue;
    const response = await fetch(`${base}/storage/v1/object/${encodeURIComponent(object.storageBucket)}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ prefixes: [object.storagePath] }),
    });
    if (!response.ok) throw new Error(`Storage cleanup failed with HTTP ${response.status}. Database reset was not started.`);
  }
};

const main = async () => {
  const event = await prisma.event.findUnique({ where: { slug: "prompthon-2026" }, include: { rounds: { orderBy: { number: "asc" } } } });
  if (!event || event.rounds.length !== 3) throw new Error("Expected one PROMPTHON 2026 event with exactly three rounds.");
  const roundOne = event.rounds.find((round) => round.number === 1)!;
  const roundOneQuestionCount = await prisma.question.count({ where: { roundId: roundOne.id } });
  if (roundOneQuestionCount !== 11) throw new Error(`Reset stopped: expected exactly 11 Round 1 questions, found ${roundOneQuestionCount}.`);

  const storedObjects = [
    ...await prisma.submissionArtifact.findMany({ where: { submission: { team: { eventId: event.id } } }, select: { storageBucket: true, storagePath: true } }),
    ...await prisma.certificate.findMany({ where: { team: { eventId: event.id } }, select: { storageBucket: true, storagePath: true } }),
  ];
  await removeStoredObjects(storedObjects);

  const result = await prisma.$transaction(async (tx) => {
    await tx.evaluation.deleteMany({ where: { submission: { team: { eventId: event.id } } } });
    await tx.submission.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.certificate.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.teamRosterMember.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.teamQuestionAssignment.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.teamRoundAccess.deleteMany({ where: { team: { eventId: event.id } } });
    await tx.authSession.deleteMany({});
    // Audit logs are append-only during normal application operation. This
    // explicit, guarded maintenance reset temporarily suspends only that
    // mutation trigger and restores it before the transaction commits.
    await tx.$executeRawUnsafe('ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_immutable_trigger"');
    await tx.auditLog.deleteMany({});
    await tx.$executeRawUnsafe('ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_immutable_trigger"');
    await tx.importBatch.deleteMany({ where: { eventId: event.id } });
    await tx.question.deleteMany({ where: { round: { eventId: event.id, number: { in: [2, 3] } } } });
    await tx.team.updateMany({ where: { eventId: event.id }, data: { status: TeamStatus.ACTIVE, deletedAt: null, onboardedAt: null } });
    await tx.participant.updateMany({ where: { membership: { team: { eventId: event.id } } }, data: { status: ParticipantStatus.ADMITTED, deletedAt: null } });
    await tx.round.updateMany({ where: { eventId: event.id }, data: { status: RoundStatus.LOCKED, startsAt: null, endsAt: null, version: { increment: 1 } } });
    await tx.event.update({ where: { id: event.id }, data: { status: EventStatus.SCHEDULED } });
    return {
      participants: await tx.participant.count({ where: { membership: { team: { eventId: event.id } }, deletedAt: null } }),
      teams: await tx.team.count({ where: { eventId: event.id, deletedAt: null } }),
      roundOneQuestions: await tx.question.count({ where: { roundId: roundOne.id } }),
    };
  });
  process.stdout.write(`Event reset completed. Preserved ${result.participants} participants, ${result.teams} teams, and ${result.roundOneQuestions} Round 1 questions.\n`);
};

main().finally(() => prisma.$disconnect());
