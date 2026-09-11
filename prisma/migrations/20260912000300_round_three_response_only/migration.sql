-- Round 3 is intentionally response-only: its offline question is not stored in the platform.
ALTER TABLE "submissions" ADD COLUMN "responseConversationUrl" TEXT;
