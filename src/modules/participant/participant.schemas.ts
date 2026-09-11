import { z } from "zod";

export const roundNumberSchema = z.coerce.number().int().min(1).max(3);

const rosterName = z.string().trim().min(1, "Member name cannot be empty.").max(120);

export const completeTeamOnboardingSchema = z.object({
  members: z.array(rosterName).min(1, "Member 1 is required.").max(3, "A team can have at most 3 members."),
});

export const saveSubmissionSchema = z.object({
  aiTool: z.string().trim().min(2).max(120).optional(),
  responseConversationUrl: z.url({ protocol: /^https?$/ }).max(2048).optional(),
  answers: z
    .array(
      z.object({
        questionId: z.uuid(),
        conversationUrl: z.url({ protocol: /^https?$/ }).max(2048).optional(),
        promptText: z.string().trim().max(20_000).optional(),
        responseText: z.string().trim().max(50_000).optional(),
        notes: z.string().trim().max(5_000).optional(),
      }),
    )
    .min(0)
    .max(10)
    .refine((answers) => new Set(answers.map((answer) => answer.questionId)).size === answers.length, {
      message: "Each question may be answered only once.",
    })
    .refine((answers) => new Set(answers.map((answer) => answer.conversationUrl).filter(Boolean)).size === answers.filter((answer) => answer.conversationUrl).length, {
      message: "Each conversation URL must be unique.",
    }),
  version: z.number().int().positive().optional(),
});
