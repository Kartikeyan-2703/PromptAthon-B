import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

describe("API shell", () => {
  it("serves the liveness endpoint without database access", async () => {
    const response = await request(createApp()).get("/api/v1/health/live");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ data: { status: "ok" } });
    expect(response.headers["x-request-id"]).toBeTruthy();
  });

  it("uses the standard error envelope for unknown routes", async () => {
    const response = await request(createApp()).get("/api/v1/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(response.body.error.requestId).toBeTruthy();
  });

  it("rejects unauthenticated round participation exports", async () => {
    const response = await request(createApp()).get("/api/v1/admin/reports/round-participation.xlsx");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("rejects unauthenticated access to the submission review queue", async () => {
    const response = await request(createApp()).get("/api/v1/admin/submissions?roundNumber=1&status=SUBMITTED");
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("exposes the download filename header to the trusted frontend", async () => {
    const response = await request(createApp())
      .get("/api/v1/health/live")
      .set("Origin", "http://localhost:3000");
    expect(response.headers["access-control-expose-headers"]).toContain("content-disposition");
  });
});
