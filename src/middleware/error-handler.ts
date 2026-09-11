import type { ErrorRequestHandler, RequestHandler } from "express";
import multer from "multer";
import { ZodError } from "zod";
import { Prisma } from "../generated/prisma/client.js";
import { ApiError } from "../lib/errors.js";

export const notFoundHandler: RequestHandler = (request, response) => {
  response.status(404).json({
    error: {
      code: "ROUTE_NOT_FOUND",
      message: `No API route matches ${request.method} ${request.path}.`,
      requestId: request.id,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (error, request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof multer.MulterError || error?.message === "Only .xlsx Excel files are accepted.") {
    response.status(400).json({
      error: {
        code: "INVALID_UPLOAD",
        message: error.message,
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "The request input is invalid.",
        details: error.flatten(),
        requestId: request.id,
      },
    });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    const isConflict = error.code === "P2002" || error.code === "P2034";
    response.status(isConflict ? 409 : 400).json({
      error: {
        code: isConflict ? "CONFLICT" : "DATABASE_REQUEST_ERROR",
        message: isConflict
          ? "The operation conflicts with current data. Refresh and try again."
          : "The database rejected the request.",
        requestId: request.id,
      },
    });
    return;
  }

  request.log.error({ err: error }, "Unhandled request error");
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected server error occurred.",
      requestId: request.id,
    },
  });
};
