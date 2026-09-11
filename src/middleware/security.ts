import type { RequestHandler } from "express";
import { env } from "../config/env.js";
import { forbidden } from "../lib/errors.js";

const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export const enforceTrustedOrigin: RequestHandler = (request, _response, next) => {
  if (safeMethods.has(request.method)) {
    next();
    return;
  }

  const origin = request.get("origin");
  if (!origin || !env.frontendOrigins.includes(origin)) {
    next(forbidden("The request origin is not trusted."));
    return;
  }

  next();
};
