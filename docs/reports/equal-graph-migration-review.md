# Scoped graph and migration review

Reviewed the uncommitted graph, schema, migration/meta, seed, bootstrap and corresponding test changes against `docs/specs/0008-equal-perspectives-and-graph-reset.md`. Other application changes were excluded. This is source inspection; no shared database or integration suite was run. The reported 7 database tests and 10 graph E2E tests were supplied by the implementing agents, not independently rerun here.

## Re-review resolution

The scoped graph re-review approves the fixes to all three findings below. `cancelHoverDeparture` and `clearSelection` are stable callbacks, and the Escape effect now has stable dependencies; ordinary rerenders therefore preserve the departure timer. `clearSelection` explicitly nulls `pendingLocate.current`. A geometric corridor preserves hover during travel to the detail panel without inserting any DOM overlay or intercepting node clicks, dragging, wheel events, or canvas blank clicks.

The first corridor revision had a direct-exit defect: leaving the corridor straight out of the graph skipped the container's pointermove handler and could retain temporary hover. During re-review, the implementer added a container pointerleave handler that resets travel state and schedules departure, plus an E2E regression for that path. This closes the identified regression. No further concrete blocker was found within the requested re-review scope.

The implementer reported that the parent-rerender, delayed-worker reset, and 20-step panel travel/button-navigation regressions pass. The reviewer inspected those tests and the direct-exit test but did not start a Next server or independently rerun E2E. Database changes were outside this re-review; the parent reported 293 Vitest passes and one R2 skip, including expanded migration preservation coverage.

## Original findings (resolved)

### P2 — Ordinary rerenders cancel the only hover-departure callback

Location: `src/components/graph-canvas.tsx:100-109`, especially 107.

The Escape listener effect has no dependency array, so React invokes its cleanup after every committed rerender. That cleanup calls `cancelHoverDeparture()`. After leaving a node, the component schedules its only `setHovered(null)` for 100 ms later. A wheel zoom on the now-empty canvas, a ResizeObserver update, or a parent search input update during that interval cancels the timer without clearing `hovered` or scheduling another timer. With the pointer already outside the node and detail region, no further departure event arrives, leaving the detail and neighbor focus stuck. This violates the requirement that hovering be temporary and focus restore on departure.

Keep timer disposal in unmount cleanup rather than cleanup for every render, and keep the key listener callback current independently. A regression should leave a node, cause a rerender inside the departure interval, then verify detail disappearance after the interval.

### P2 — Clearing selection does not cancel a queued search location

Location: `src/components/graph-canvas.tsx:80-85`.

`locate()` stores a term ID in `pendingLocate.current` when the layout worker has not returned. `clearSelection()` clears the visible states and the parent's “已定位” message but leaves that ref intact. Searching during initial layout (or a failed layout), pressing Escape or “适应画布”, then allowing the worker/retry to finish runs `accept()` at lines 118-121 and restores the cancelled selection with a 1.8 zoom. The parent message stays cleared, producing exactly the inconsistent focus/message state the spec calls out. Clear the queued ref as part of the reset operation. Test with a delayed worker response and with retry after a failed layout.

### P2 — The detail panel disappears while the user crosses the gap to it

Location: `src/components/graph-canvas.tsx:94-97`, with panel positioning at 200.

The detail panel is placed in the opposite vertical half of the canvas from the hovered node and always at the left edge. Its pointer-enter handler only preserves the hover after the pointer reaches it; leaving the node grants only 100 ms to cross a potentially several-hundred-pixel gap. Moving from a right-side node toward its panel with an ordinary multi-step mouse movement taking longer than 100 ms dismisses the panel before it can be entered or its action clicked. The new `node.hover(); details.hover()` test jumps directly to the destination and does not exercise this movement. Provide a transition corridor/adjacent panel or another robust mechanism that lets a person reach the detail while still clearing on actual departure. Verify using stepped movement lasting more than 100 ms through the gap and invoke the “进入词条” button.

## Database review

No concrete migration or bootstrap blocker found within the requested scope. The migration gathers flagged/renamed boards and the reserved board title, deletes their perspective pages and histories, clears restrictive revision/submission references before deletion, preserves surviving incoming links as unresolved, preserves term discussions via the existing SET NULL relation, and uses cascades for board-source links/interests/votes/notifications. The explicit old default-body submission cleanup is consistent with the approved removal. The migration snapshot has only the two intended column removals and correctly chains to 0017; its journal entry matches the SQL. Existing search-maintenance rows are marked degraded/reindex-required. Bootstrap no longer creates a board, and seed changes replace default demonstrations with named perspectives.

The database test exercises most of these dependency paths, including ordinary data preservation and migration retry. No claim is made here about executing the migration on production.
