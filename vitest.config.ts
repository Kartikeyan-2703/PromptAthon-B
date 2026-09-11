import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://test:test@127.0.0.1:5432/prompthon_test",
      FRONTEND_ORIGINS: "http://localhost:3000",
      TEAM_CODE_PEPPER: "test-only-pepper-with-at-least-32-characters",
      LOG_LEVEL: "silent",
    },
    coverage: { reporter: ["text", "json-summary"] },
  },
});
