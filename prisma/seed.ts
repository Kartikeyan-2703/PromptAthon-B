import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";
import { QuestionStatus, RoundKind } from "../src/generated/prisma/enums.js";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_URL or DATABASE_URL is required to seed.");

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const roundRules = {
  1: [
    "Use the unique participant access issued by the organizers.",
    "Use one team device only; additional devices may result in disqualification.",
    "Use only the AI tool designated by the organizers.",
    "Work independently. Sharing prompts, outputs, or assistance between teams is prohibited.",
    "Submit one public conversation link for each of the four assigned problem statements.",
    "Only the final submission recorded by your team will be evaluated.",
    "The jury's decision is final and binding.",
  ],
  2: [
    "This round is conducted offline using pen and paper.",
    "Laptops, mobile phones, and all other electronic devices are prohibited.",
    "Analyse the provided AI output and reconstruct the hidden prompt in four to five lines.",
    "Submit one final handwritten prompt per team.",
    "Work independently; copying, sharing, or assisting another team may disqualify both teams.",
    "Only handwritten submissions will be considered.",
    "The jury's decision is final and binding.",
  ],
  3: [
    "Observe the provided reference image and engineer a prompt that recreates its visual system.",
    "Use only the AI image-generation tool designated by the organizers.",
    "One laptop is permitted; mobile phones and additional devices are prohibited.",
    "Submit one final generated image together with the prompt used.",
    "Do not copy, share prompts or images, or assist another team.",
    "The result should reproduce the objects, positions, composition, colours, proportions, and overall appearance as closely as possible.",
    "The jury's decision is final and binding.",
  ],
} as const;

const rounds = [
  {
    number: 1,
    kind: RoundKind.VAGUE_TO_PRECISE,
    title: "Vague to Precise",
    description: "Find the information an AI needs and turn ambiguity into a precise, useful instruction.",
  },
  {
    number: 2,
    kind: RoundKind.PROMPT_REVERSE_ENGINEERING,
    title: "Prompt Reverse Engineering",
    description: "Analyse a generated output and reconstruct the instruction that could have produced it.",
  },
  {
    number: 3,
    kind: RoundKind.IMAGE_RECREATION,
    title: "Image Recreation",
    description: "Translate a reference image into a precise image-generation prompt.",
  },
] as const;

const main = async () => {
  const event = await prisma.event.upsert({
    where: { slug: "prompthon-2026" },
    update: {
      name: "PROMPTHON 2026",
      startsAt: new Date("2026-09-12T03:30:00.000Z"),
      endsAt: new Date("2026-09-12T10:30:00.000Z"),
      timezone: "Asia/Kolkata",
      venue: "Easwari Engineering College, Chennai",
    },
    create: {
      slug: "prompthon-2026",
      name: "PROMPTHON 2026",
      startsAt: new Date("2026-09-12T03:30:00.000Z"),
      endsAt: new Date("2026-09-12T10:30:00.000Z"),
      timezone: "Asia/Kolkata",
      venue: "Easwari Engineering College, Chennai",
    },
  });

  for (const definition of rounds) {
    const round = await prisma.round.upsert({
      where: { eventId_number: { eventId: event.id, number: definition.number } },
      update: { kind: definition.kind, title: definition.title, description: definition.description },
      create: { eventId: event.id, ...definition },
    });

    for (const [index, text] of roundRules[definition.number].entries()) {
      await prisma.roundRule.upsert({
        where: { roundId_position: { roundId: round.id, position: index + 1 } },
        update: { text },
        create: { roundId: round.id, position: index + 1, text },
      });
    }

    // Only Round 1 has an in-platform question pool. Round 2 is an offline
    // paper test and Round 3 receives its question from the physical board.
    const placeholderCount = definition.number === 1 ? 4 : 0;
    for (let index = 1; index <= placeholderCount; index += 1) {
      await prisma.question.upsert({
        where: { roundId_code: { roundId: round.id, code: `R${definition.number}-Q${index}` } },
        update: {},
        create: {
          roundId: round.id,
          code: `R${definition.number}-Q${index}`,
          position: index,
          title: `Problem statement ${String(index).padStart(2, "0")}`,
          body: "The organizer has not published this problem statement yet.",
          status: QuestionStatus.DRAFT,
          isPlaceholder: true,
        },
      });
    }
  }

  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    if (adminPassword.length < 12) throw new Error("ADMIN_PASSWORD must contain at least 12 characters.");
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.adminUser.upsert({
      where: { email: adminEmail },
      update: {
        displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || "PROMPTHON Administrator",
        passwordHash,
      },
      create: {
        email: adminEmail,
        displayName: process.env.ADMIN_DISPLAY_NAME?.trim() || "PROMPTHON Administrator",
        passwordHash,
      },
    });
    process.stdout.write(`Seeded administrator ${adminEmail}.\n`);
  } else {
    process.stdout.write("Skipped administrator seed because ADMIN_EMAIL/ADMIN_PASSWORD are not configured.\n");
  }
};

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
