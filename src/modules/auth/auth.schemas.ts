import { z } from "zod";

export const participantEmailSchema = z.object({
  email: z.email().max(320),
});

export const teamCodeSchema = z.string().trim().transform((value) => value.toUpperCase().replace(/\s+/g, "")).pipe(
  z.string().regex(/^[A-Z0-9][A-Z0-9-]{5,23}$/, "Use a valid 6-24 character Team Code."),
);

export const participantLoginSchema = participantEmailSchema.extend({
  teamCode: teamCodeSchema,
});

export const adminLoginSchema = z.object({
  email: z.email().max(320),
  password: z.string().min(12).max(200),
});
