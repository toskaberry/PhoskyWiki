# Equal perspectives and graph reset Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for independent implementation tasks and final review.

**Goal:** Implement the four user-confirmed decisions in spec 0008.
**Architecture:** Keep graph hover transient and provide a shared reset path. Remove editorial and public-pin semantics from application, then migrate their data while preserving unrelated content.
**Tech Stack:** Next.js 16.3.4, React 19.2.8, PostgreSQL, Drizzle, Vitest, Playwright.
**Spec:** docs/specs/0008-equal-perspectives-and-graph-reset.md

## Global Constraints

- Follow CONTEXT.md and ADR-0007; read installed Next.js docs before changing framework code.
- Tests use explicit DATABASE_URL ending _test; no live database mutation during implementation.
- Main and graph-school-communities-pr were integrated in this isolated worktree.

### Task 1: Graph reset

- [x] Add browser regression tests for hover departure, background/Escape/reset, search status, touch and local graph. Run failing tests first.
- [x] Update src/components/graph-canvas.tsx and graph-scene.tsx; synchronize reset through GraphCanvasProps.onClearSelection to src/app/graph/graph-explorer.tsx.
- [x] Verify graph E2E and layout unit tests; review exact diff.

### Task 2: Equal perspectives in application

- [x] Add failing creation/ranking tests. Implement metadata-only new_term, rejecting nonempty legacy body.
- [x] Remove isBoard/pinned use from src/lib, src/components, src/app. Remove public pin API/control and editorial presentation. Update affected tests, scripts and current operational docs.
- [x] Preserve normal editors/admins and ordinary interpreter views. Verify typecheck, creation/ranking and affected integration tests.

### Task 3: Data and fixtures

- [x] Remove isEditorialBoard/pinned from schema and bootstrap. Update seed fixture to explicit interpreter content, no default editorial body.
- [x] Generate migration; add cleanup before dropping columns. Test a migrated historical fixture with editorial revisions/proposals/links and ordinary content surviving.
- [x] Validate bootstrap, migration, full unit/integration and E2E suites. Inspect build and lint results; obtain independent review.

## Progress

- Implementation complete; independent application, graph and migration reviews resolved. Full Vitest: 293 passed, one unconfigured R2 contract skipped. Final production-mode Playwright: 95 passed, one existing opt-in consolidation scenario skipped, zero failures/retries. Production build and lint passed. See docs/reports/equal-perspectives-final-verification.md.
- Graph review required stable hover timer disposal, cancellation of queued locations, and a geometric pointer corridor with container-leave cleanup; each was covered by a browser regression.
- Removing editorial fixture pages changed link counts; tests now exercise ordinary interpreter perspectives. Two small named Marx demo views replace the test coverage gaps without reattributing the deleted board text.
- Verification exposed abrupt Windows CLI shutdown in consolidation; the CLI now drains database pools before normal exit. The existing end-to-end CLI integration test passes.
