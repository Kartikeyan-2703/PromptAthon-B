import type { RequestHandler } from "express";
import type { ZodType } from "zod";
import { badRequest } from "../lib/errors.js";

export const validateBody = (schema: ZodType): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.body);
  if (!result.success) {
    next(badRequest("VALIDATION_ERROR", result.error.issues[0]?.message || "The request body is invalid.", result.error.flatten()));
    return;
  }
  request.body = result.data;
  next();
};

export const validateQuery = (schema: ZodType): RequestHandler => (request, _response, next) => {
  const result = schema.safeParse(request.query);
  if (!result.success) {
    next(badRequest("VALIDATION_ERROR", "The query parameters are invalid.", result.error.flatten()));
    return;
  }
  // Express 5 exposes `request.query` through a getter and it cannot be
  // reassigned. Route handlers parse the already-validated value to obtain
  // defaults and coercions without mutating the request object.
  next();
};
