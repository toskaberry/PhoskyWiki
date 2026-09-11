# Equal perspectives: application review

Reviewed 2026-09-11 against baseline `228c03796a23ca5e9b2375643fae66ee7bac32e2`, using the uncommitted working-tree diff (`git diff 228c037 -- ...`). HEAD remained at the baseline during review; there were no intervening commits. The implementer was still adjusting test fixtures and CLI shutdown behavior concurrently.

Scope: non-graph application routes and pages, shared submission/read/discovery modules and components, production/import scripts, current operational documentation, and affected test changes. Graph interaction and database migration/bootstrap/seed correctness have separate reviewers. This report does not certify those areas.

Requirements: `docs/specs/0008-equal-perspectives-and-graph-reset.md`, ADR-0007, current `CONTEXT.md`, and ADR-0004 for ordinary named perspectives and their histories. The review followed the code-review skill's Standards and Spec axes locally, respecting the explicit instruction not to spawn further agents.

## Standards

No actionable documented-standard violation found in the application changes. The changed domain names and read paths consistently remove the board/public-pin special cases. The three body checks in submission validation, import handling, and application are purposeful boundary checks: import updates convert their input to `edit`, while approval applies persisted proposals. Collapsing these checks without preserving those boundaries could reopen a bypass, so their small duplication is not flagged as a code smell.

## Spec

No application behavior blocker found. One low-priority documentation correction was identified and subsequently resolved:

### P3 — Remove the obsolete token-auth paragraph left after deleting the pin endpoint

**Location:** `README.md:95` (obsolete follow-on text at lines 96–97).

The new metadata-only creation statement now directly precedes instructions to configure `ADMIN_TOKEN`, send `x-admin-token`, and expect a 503 when unconfigured. These sentences previously described the removed pin endpoint and are no longer attached to any surviving operation. A reader following the current creation instructions is therefore directed to an authentication mechanism that neither `/api/submissions` nor `/api/admin/import` accepts; those routes use database-backed sessions, and import requires the admin role. Delete the obsolete paragraph or replace it with accurate session/role guidance. This is a current documentation defect, not a runtime blocker.

Resolution: the implementer removed the obsolete token instructions and documented the surviving login-session authentication. Root verified the final README change.

## Paths checked and supporting evidence

- **Creation API:** `/api/submissions` rejects non-string `new_term.content`; domain validation rejects nonblank strings before writing either administrator content or an editor proposal. Empty/omitted content produces a term and metadata revision, with no implicit perspective.
- **Import creation and update:** JSON parsing checks content types. `importPages` rejects term bodies before converting an existing-page input into an `edit`, so that update path cannot silently discard an old body. Its surrounding transaction retains all-or-nothing behavior.
- **Approval:** `applySubmission` independently rejects a stored nonblank new-term body before inserting a page. Removal of old persisted proposals is a migration-review responsibility.
- **Resubmission:** rejected metadata-only term proposals retain title, summary, aliases and key-text prefill through the existing resubmission path. Ordinary perspective resubmissions still select live named interpreters and preserve existing duplicate-pair checks. Persisted deleted-board proposal availability is delegated to migration verification.
- **Forms and drafts:** the new-term Markdown editor/template is removed. Its new local-storage key isolates legacy full-body creation drafts from the metadata form. Normal perspective editors and their drafts remain present. The old draft is not automatically deleted or submitted.
- **Presentation:** term pages no longer inline a selected interpretation or label a default/publicly pinned one. All named perspectives flow through the same expandable list; perspective/interpreter pages no longer render board badges or special biographical labels. Creation/edit/history links remain available for ordinary content.
- **Ordering:** query order remains incoming-link count descending then page ID ascending. Interest reordering preserves within-group input order and empty-interest behavior; interpreter/school expansion is unchanged. The client reapplication remains idempotent.
- **Public pinning:** route, control and library implementation are deleted, and all active source references to board/pin fields were removed. The replacement browser test checks missing controls and POST/DELETE 404 behavior.
- **Operational tooling:** Hegel publication/inventory no longer reads the dropped board column, requires a board interpreter, or publishes a board companion. It retains separate metadata-term creation and named Hegel perspective publication. Current production/content documentation describes metadata creation and the required post-migration search rebuild.

## Test review and limits

The changed tests cover metadata-only creation with exactly one term revision and no perspective/interpreter creation, explicit rejection of old body payloads, non-string body payloads, import updates rejecting bodies without modifying metadata, normal named-perspective image/link publication, interest/default ordering, ordinary edits/history, and metadata-only rejected-proposal resubmission. The former pin workflow was intentionally replaced with a removal regression test. Board-only assertions were removed or adapted to named fixtures.

No tests were executed by this reviewer: the root task is running centralized verification against dedicated isolated databases, and this review did not open a Next server or mutate any database. Test presence and source-level reasoning are not a claim that those tests have passed. No additional blocking test omission was identified for this application scope.

Standards: 0 findings. Spec/application: 1 P3 documentation finding, no runtime blockers.
