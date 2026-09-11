# PROMPTHON ROUND PARTICIPATION EXPORT — FINAL AUDIT

Date: 11 September 2026  
Scope: `Frontend/`, `Server/`, Prisma schema/migrations, round progression, submissions, evaluation, admin authorization, and XLSX delivery.

## 1. Executive Summary

PROMPTHON now has an admin-only XLSX export that reports actual round participation in three columns: `Round 1`, `Round 2`, and `Round 3`. It uses finalized database submissions as participation evidence, resolves emails through team membership and participant relationships, deduplicates within a round, and never derives participation from eligibility or approval.

## 2. Existing Round Architecture

An `Event` owns three ordered `Round` rows. Round state is `LOCKED -> LIVE -> ENDED`; a partial PostgreSQL unique index permits at most one live round per event. The `(eventId, number)` unique constraint maps configured round numbers reliably.

## 3. Existing Database Architecture

Participants belong to one team through `TeamMember`. Teams receive per-round authorization through `TeamRoundAccess`, question assignments through `TeamQuestionAssignment`, and create one `Submission` per round. A finalized submission owns answers/artifacts and may own one evaluation.

## 4. Existing Participation Tracking

No new participation table was required. `Submission` is the existing team-level attempt record and has a database unique constraint on `(teamId, roundId)`. A finalized submission has `submittedAt` and `lockedAt`; a database check prevents non-draft statuses without both timestamps.

## 5. Existing Approval/Rejection Flow

An evaluation is unique per submission. Approval sets submission/access to `APPROVED`; rejection sets both to `REJECTED`. Starting Round 2 or 3 selects only teams approved in the immediately preceding round. Approval grants eligibility; it does not create participation in the next round.

## 6. Problems Found

- The frontend had no real API client and the admin login was a frontend constant.
- No round-participation export endpoint or workbook builder existed.
- There was no explicit documented definition separating eligibility from participation.
- Existing tests did not validate workbook structure, deduplication, empty rounds, or export authorization.
- The live Supabase datasource remains unreachable from the current environment, so the migration/deployed-data state cannot be certified here.

## 7. Database Changes Made

No database entity or column was added. The existing submission model already answers the business question without duplicated state.

## 8. Prisma Changes Made

No semantic Prisma schema changes were necessary. `prisma format`, `prisma validate`, and client generation were run successfully.

## 9. Backend Changes Made

Added a focused report service that resolves the event, validates that rounds 1–3 exist, retrieves finalized submissions in one relational query, collects member emails, deduplicates/sorts each round, generates XLSX bytes, and writes a metadata-only audit record.

## 10. API Endpoint Added

`GET /api/v1/admin/reports/round-participation.xlsx`

Optional query: `eventId=<UUID>`. Without it, the most recent event is selected. The endpoint returns `prompthon-round-participation-report.xlsx` with `private, no-store` caching and requires an authenticated administrator session.

## 11. Admin UI Changes

The admin dashboard shows a database-report panel only after `/auth/me` confirms an administrator session. Its button has a generating state, disables repeat clicks, downloads the binary response, respects the server filename, and displays success/error feedback. Admin login now uses the backend API and no longer displays a hard-coded credential in the active route.

## 12. Excel Generation Architecture

The backend uses ExcelJS to create one worksheet named `Round Participation`. The sheet has exact headers, one email per cell, frozen headers, hidden gridlines, filters when data exists, readable column widths, and no summary or unrelated data on the primary sheet.

## 13. Participation Definition

**Participated** means the participant is a registered member of a team with a submission for that round that:

- has status `SUBMITTED`, `UNDER_REVIEW`, `APPROVED`, or `REJECTED`; and
- has non-null `submittedAt` and `lockedAt` timestamps.

`DRAFT`, `ELIGIBLE`, `IN_PROGRESS`, assignment, registration, and previous-round approval do not qualify. Because PROMPTHON submits as a team on one device, a finalized team submission represents the participation of the team's registered members.

## 14. Round 1 Query Logic

Select finalized submissions whose related round has `number = 1` and belongs to the selected event; resolve `team.members.participant.email`.

## 15. Round 2 Query Logic

The same evidence rule is applied to round number 2. Round 1 approval alone is not queried or exported.

## 16. Round 3 Query Logic

The same evidence rule is applied to round number 3. Round 2 approval alone is not queried or exported.

## 17. Deduplication Logic

Each round owns an independent `Set` of normalized emails. An email may appear once in every round where participation is proven, but never twice in one round. Database uniqueness already prevents duplicate team submissions; the set is defensive against anomalous joined data.

## 18. Security / RBAC

The export is mounted behind `requireAdmin`. Participant sessions receive HTTP 403; missing sessions receive HTTP 401. Email lists are returned only in the immediate binary response, are not placed in URLs, are not written to logs, and are not stored as a public file. The audit record contains only event ID and counts.

## 19. Performance / Indexing

The export is one Prisma query with relation selection; there is no query inside a participant loop. Existing indexes support it: `(eventId, number)` on rounds, `(roundId, status, submittedAt)` on submissions, `(teamId, joinedAt)` on team members, and unique participant email. No speculative new index was added.

## 20. Migration Changes

None. This avoids redundant participation state and production migration risk.

## 21. Files Changed

- `Server/src/modules/admin/round-participation-report.service.ts`
- `Server/src/modules/admin/admin.routes.ts`
- `Server/src/modules/admin/admin.schemas.ts`
- `Server/tests/round-participation-report.test.ts`
- `Server/tests/app.test.ts`
- `Frontend/services/api-client.ts`
- `Frontend/services/mock-services.ts`
- `Frontend/components/admin/AdminLogin.tsx`
- `Frontend/components/admin/AdminPages.tsx`
- `Frontend/components/AppRouter.tsx`
- `Frontend/app/portal-system.css`
- `Frontend/.env.example`

## 22. Tests Performed

- Prisma formatting, validation, and client generation.
- Server TypeScript type-check and production build.
- Vitest unit/API tests.
- Workbook write and reload with ExcelJS.
- Frontend ESLint and production build.
- Unauthenticated endpoint request through the Express application.

## 23. Test Results

- Prisma schema: valid.
- Server type-check/build: passed.
- Server tests: 16/16 passed across three files.
- Frontend lint/build: passed.
- XLSX tests verify 100/50/20 unique counts, multi-round participation, absence from non-participated rounds, defensive deduplication, exact headers, empty cells, and all-empty output.

## 24. Remaining Issues

- Apply and verify migrations against the intended Supabase database; the current datasource check fails from this environment.
- Replace remaining participant/admin mock tables and localStorage state with API-backed data.
- Add disposable-PostgreSQL integration tests for the complete import -> submit -> review -> next-round -> export flow.
- Add Supabase Storage transport when binary Round 3 artifacts are enabled.
- Complete production deployment, TLS/cookie/CORS configuration, monitoring, backups, and restore testing.

## 25. Production Readiness

| Area | Score |
|---|---:|
| Database design | 92/100 |
| Backend | 90/100 |
| API | 91/100 |
| Security | 89/100 |
| Performance | 91/100 |
| Excel Export | 95/100 |
| Data Integrity | 93/100 |
| Overall Production Readiness | 72/100 |

The export implementation is code-complete and locally verified. Overall production readiness remains lower because the live Supabase database and the remaining mock frontend flows are not yet integrated and end-to-end tested.
