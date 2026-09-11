# PROMPTHON final production audit

Audit date: 11 September 2026

## 1. Executive status

The frontend and backend compile successfully and the automated server suite passes. Supabase PostgreSQL is reachable and both migrations are deployed. The product is API-integrated, but is **not yet certified production-ready** until an administrator is seeded, live storage is configured and verified, browser E2E/restart persistence pass, and the 100-team scenario is exercised.

## 2. Frontend

Participant and administrator operational pages call the versioned API with credentialed requests. Login, dashboard, round access, assigned questions, four Round 1 conversation records, submissions, review decisions, participant lists, audit logs, Excel preview/commit, round control, report download, and Round 3 artifact upload no longer depend on mock state. Static public marketing copy remains local by design.

## 3. Backend

Express exposes health, authentication, participant, and administrator modules. Controllers/routes delegate persistence to services and Prisma. Request IDs, structured logging, validation, error envelopes, rate limiting, CORS, Helmet, and RBAC middleware are present.

## 4. Database architecture

The Prisma schema contains 18 models: AdminUser, Event, Round, RoundRule, Participant, Team, TeamMember, TeamRoundAccess, Question, TeamQuestionAssignment, Submission, SubmissionAnswer, SubmissionArtifact, Evaluation, AuthSession, ImportBatch, ImportRow, and AuditLog. Two forward-only migrations are committed. No reset or destructive schema command was run.

## 5. Authentication and authorization

Participants authenticate with registered email plus team code. Administrators authenticate separately with password credentials. Sessions are opaque, hashed in storage, revocable, expiring, and delivered through HTTP-only cookies. Participant and admin routes have separate RBAC guards.

## 6. Round state

Round start, end, and lock operations persist with optimistic versions, serializable transactions, audit records, and one-live-round enforcement. UI controls refresh from the database response.

## 7. Progression

Round 1 eligibility is seeded for admitted teams. Approval grants next-round eligibility but never creates a submission. Rejection blocks progression. Actual participation is derived only from submitted records.

## 8. Questions and submissions

Assignments are team-scoped and server-authorized. Round 1 requires exactly four distinct public conversation URLs. Later rounds accept prompt evidence. A submission locks after submit and becomes available to the round-specific review queue.

## 9. Review workflow

Review lists are filtered by round and status. Opening a submitted record persists UNDER_REVIEW. Approve/reject actions use version checks and top-layer confirmation UI; rejection feedback is optional.

## 10. Excel import

The import contract is Name, Email, Team Code. The server parses real XLSX files, validates rows, persists a preview batch, and commits valid rows transactionally while reporting invalid and duplicate rows.

## 11. Excel export

The report is generated from actual submitted participation by round. Approval or eligibility alone does not add a team. The download is an authenticated XLSX response and the export is audited.

## 12. Supabase Storage

Private PNG/JPEG/WebP uploads are implemented for active Round 3 drafts. The service enforces size limits, uses server-only service-role credentials, creates a private bucket when needed, stores SHA-256 and metadata in Prisma, cleans up failed metadata writes, and authorizes team/admin downloads. Live verification requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.

## 13. Security

Secrets remain server-side. Cookies are HTTP-only, Secure in production, and SameSite strict. CORS uses an allowlist with credentials. Input schemas, upload type/size restrictions, route ownership checks, password hashing, log redaction, and auth rate limits are implemented.

## 14. Observability

The API supplies request IDs, structured/redacted Pino logs, consistent error envelopes, `/health/live`, and database-backed `/health/ready`.

## 15. Performance and concurrency

Pagination is used for administrative collections, indexes cover core event/team/submission relations, and high-risk state changes use transactions plus expected-version conflict detection.

## 16. Verification completed

- Frontend ESLint: pass
- Frontend production build: pass
- Server TypeScript: pass
- Server production build: pass
- Prisma schema validation: pass
- Vitest: 19/19 pass

## 17. Verification blocked

The failed `20260911000200_team_code_identity` attempt was diagnosed as a missing legacy constraint, made safely resumable, marked rolled back, and redeployed successfully. Prisma reports the database schema up to date. Live counts are one event, three rounds, 21 rules, six questions, and zero administrators. Storage credentials were not present, so live bucket upload/download was not attempted.

## 18. Required deployment gates

1. Configure ADMIN_EMAIL, ADMIN_PASSWORD, and ADMIN_DISPLAY_NAME, then rerun `npm run prisma:seed` to create the first administrator.
2. Configure SUPABASE_URL and the server-only SUPABASE_SERVICE_ROLE_KEY.
3. Start both production builds and execute authenticated browser E2E at desktop and mobile widths.
4. Restart both processes and confirm sessions/rounds/submissions/reviews remain persisted.
5. Execute and export the 100 → 60 → 50 → 30 → 25 scenario; verify workbook rows against SQL counts.

## 19. Release decision

**NO-GO for public production traffic until section 18 passes.** The repository is locally buildable and materially integrated; the outstanding risk is live infrastructure verification, not a reason to represent the deployment as complete.
