import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const main = async () => {
  const event = await prisma.event.findUnique({
    where: { slug: "prompthon-2026" },
    include: {
      rounds: { orderBy: { number: "asc" }, include: { _count: { select: { questions: true, rules: true, accesses: true, assignments: true, submissions: true } } } },
      _count: { select: { teams: true, importBatches: true } },
    },
  });
  if (!event) throw new Error("PROMPTHON 2026 event was not found.");
  const [participants, rosterMembers, certificates, sessions, auditLogs] = await Promise.all([
    prisma.participant.count({ where: { deletedAt: null } }),
    prisma.teamRosterMember.count({ where: { team: { eventId: event.id } } }),
    prisma.certificate.count({ where: { team: { eventId: event.id } } }),
    prisma.authSession.count(),
    prisma.auditLog.count(),
  ]);
  process.stdout.write(`${JSON.stringify({
    event: { status: event.status, teams: event._count.teams, importBatches: event._count.importBatches },
    participants,
    onboardingRosterMembers: rosterMembers,
    certificates,
    sessions,
    auditLogs,
    rounds: event.rounds.map((round) => ({ number: round.number, status: round.status, startsAt: round.startsAt, endsAt: round.endsAt, ...round._count })),
  }, null, 2)}\n`);
};

main().finally(() => prisma.$disconnect());
