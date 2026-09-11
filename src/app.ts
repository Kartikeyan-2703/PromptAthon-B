import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pino from "pino";
import { pinoHttp } from "pino-http";
import { env } from "./config/env.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { participantRouter } from "./modules/participant/participant.routes.js";
import { adminRouter } from "./modules/admin/admin.routes.js";
import { authenticate } from "./middleware/auth.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { enforceTrustedOrigin } from "./middleware/security.js";
import { prisma } from "./lib/prisma.js";

const logger = pino({ level: env.LOG_LEVEL, redact: ["req.headers.cookie", "req.body.password", "req.body.teamCode"] });

export const createApp = () => {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(
    pinoHttp({
      logger,
      genReqId: (request, response) => {
        const supplied = request.headers["x-request-id"];
        const id = typeof supplied === "string" && supplied.length <= 100 ? supplied : randomUUID();
        response.setHeader("x-request-id", id);
        return id;
      },
    }),
  );
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || env.frontendOrigins.includes(origin)) callback(null, true);
        else callback(null, false);
      },
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["content-type", "x-request-id"],
      exposedHeaders: ["content-disposition", "x-request-id"],
    }),
  );
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: false, limit: "64kb" }));
  app.use(cookieParser());
  app.use(enforceTrustedOrigin);
  app.use(authenticate);

  app.get("/api/v1/health/live", (_request, response) => response.json({ data: { status: "ok" } }));
  app.get("/api/v1/health/ready", async (_request, response) => {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ data: { status: "ready" } });
  });
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/participant", participantRouter);
  app.use("/api/v1/admin", adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
};
