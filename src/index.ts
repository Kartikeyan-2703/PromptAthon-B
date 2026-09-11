import { createServer } from "node:http";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { prisma } from "./lib/prisma.js";

const server = createServer(createApp());

server.listen(env.PORT, () => {
  process.stdout.write(`PROMPTHON API listening on http://localhost:${env.PORT}\n`);
});

const shutdown = async (signal: string) => {
  process.stdout.write(`${signal} received; closing PROMPTHON API.\n`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
