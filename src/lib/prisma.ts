import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

const adapter = new PrismaPg({
  connectionString: env.DATABASE_URL,
  max: env.isProduction ? 10 : 4,
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
});

export const prisma = new PrismaClient({
  adapter,
  transactionOptions: {
    maxWait: 5_000,
    timeout: 15_000,
  },
});
