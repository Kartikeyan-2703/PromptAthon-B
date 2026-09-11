export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (code: string, message: string, details?: unknown) =>
  new ApiError(400, code, message, details);

export const unauthorized = (message = "Authentication required.") =>
  new ApiError(401, "UNAUTHENTICATED", message);

export const forbidden = (message = "You do not have permission to perform this action.") =>
  new ApiError(403, "FORBIDDEN", message);

export const notFound = (resource: string) =>
  new ApiError(404, "NOT_FOUND", `${resource} was not found.`);

export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);

export const serviceUnavailable = (code: string, message: string, details?: unknown) =>
  new ApiError(503, code, message, details);
