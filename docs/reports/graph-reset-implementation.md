# Graph reset implementation report

## Scope

Implemented Task 1 from `docs/plans/2026-09-11-equal-perspectives-and-graph-reset.md` in the shared equal-perspectives worktree.

The graph now treats mouse hover as transient state. Leaving a node starts a short departure window so the pointer can enter the HTML detail panel; entering the panel cancels that departure, and leaving both clears the hover. Hover no longer writes into the persistent selection used by touch and keyboard interaction.

Review follow-up made the transition independent of pointer speed. A geometry-based corridor connects the active node to the full detail-panel extent. Container pointer movement tests that corridor without rendering an overlay, so it cannot intercept node clicks, background reset, or drag. Leaving the corridor or the canvas schedules normal clearing. The corridor is stored in a ref and calculated in a layout effect, avoiding an extra render and ensuring it exists before the browser paints the hover detail.

A shared clear path removes hover, selection, and the canvas `data-located` marker. It runs when the user presses Escape, presses the SVG background, or chooses “适应画布”. The fit action then fits the whole graph. `GraphCanvasProps.onClearSelection` lets the full-site explorer clear its outer “已定位” status at the same time. Local graphs receive the same canvas-level reset behavior without needing an outer callback.

The clear path also cancels a queued `locate()` request before the layout worker returns. The Escape listener remains stable across parent renders by reading the latest outer callback from a ref, so effect cleanup cannot cancel a pending hover departure.

Mouse node clicks and Enter still navigate. Touch presses still select first and expose the explicit detail action. Node and background dragging remain unchanged.

## TDD evidence

Added browser regressions in `tests/e2e/graph-layout.spec.ts` for:

- moving from a hovered node into its operable detail panel, then leaving both;
- taking a timed, 20-step path through the hover corridor and invoking “进入词条”;
- leaving the canvas directly from the corridor;
- rerendering the parent search UI during hover departure;
- resetting a queued location before a delayed worker response;
- clearing selection and the search location status with background press, Escape, and fit;
- clearing a local-graph keyboard/touch-style selection with Escape.

Before implementation, all three new tests failed because the detail region remained visible. After implementation they pass.

## Verification

- `pnpm exec playwright test tests/e2e/graph-layout.spec.ts tests/e2e/graph.spec.ts`: 10 passed after migration 0019 was applied to `phosky_graph_reset_test`.
- Focused review regressions: parent-rerender departure, delayed-worker reset, and direct corridor exit passed together; the final corrected stepped-corridor test passed separately. Root owns the final production-mode full Playwright run.
- `pnpm exec vitest run tests/unit/graph-layout.test.ts`: 2 passed.
- `pnpm exec vitest run tests/integration/graph.test.ts tests/unit/graph-layout.test.ts`: 11 passed after correcting the stale one-hop `价值` expectation to match its documented two-hop relationship.
- Scoped ESLint for the graph implementation and regression file: passed.
- `pnpm typecheck`: passed after the application changes converged.

## Assigned E2E fixture migration

Updated `term-edit.spec.ts`, `term-history.spec.ts`, `resubmission.spec.ts`, and `spec18-combined.spec.ts` so `new_term` creates metadata only. Tests that need Markdown now create a named interpreter and a separate perspective, and assertions navigate to the perspective page for body/link behavior. `agent.spec.ts` now selects the seeded `拉康论主体性` perspective directly instead of the removed generic board-view link.

A combined 24-test development-server run passed the 11 graph and Agent tests before the resubmission group timed out because that invocation omitted `SEED_ADMIN_EMAIL`; the resulting unauthenticated failures cascaded through the remaining auth-dependent files. This was a runner environment error rather than product evidence. Root is running the authoritative full production-mode Playwright suite with the complete environment.

Only the dedicated database `postgres://phosky:phosky@127.0.0.1:55435/phosky_graph_reset_test` was created, seeded, migrated, and used for browser verification.
