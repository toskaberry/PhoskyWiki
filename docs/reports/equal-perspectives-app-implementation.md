# Equal perspectives — application implementation

Date: 2026-09-11. Worktree: `D:/PhoskyWiki-worktrees/equal-perspectives`.

## Behavior

- Removed editorial-board markers, exclusions, inline term-page body, badges, special lifespan text, and fixed-first ranking from application read paths.
- All perspectives use citation count descending and page ID ascending by default. Personal interpreter and school interests move the matching group first while preserving that order within groups.
- Removed public pin endpoint, domain mutation helper and UI control. Browser regression requires POST/DELETE to return 404 and no pin badge/button to render.
- New-term wizard creates navigation metadata only, with no Markdown editor or default body template. New ordinary interpreter and explicit perspective creation remain intact.
- Domain validation rejects nonempty `new_term.content`; apply-time validation also refuses old pending body submissions. JSON import rejects nonempty term bodies before either create or pageId update, preserving transaction atomicity. HTTP input parsing rejects nonstring term bodies rather than discarding them.
- New term drafts use `phoskywiki:draft:new-term-metadata`. Old browser draft keys are left untouched; legacy bodies are never submitted implicitly or overwritten by the new form.
- Import examples, edit-page guidance, README, content-production and production operations docs now describe metadata first and separately authored named perspectives. Production docs require search reindex after migration 0019.
- Hegel pilot generators/operators now publish only the named Hegel perspective and omit board content from payloads and review indexes.

## Tests and fixtures

Updated content, discovery, interest, schools, review, production and consolidation integration tests to use actual ordinary interpreters. Image approval/security checks still test image publication through explicit perspective proposals, not a now-invalid term body. Creation asserts zero generated perspectives, one metadata revision and unchanged interpreter inventory. Added nonempty and nonstring body rejection plus pageId import-update rejection tests.

Updated browser browse, navigate, interests, review, production, pin and consolidation fixtures. Root/graph implementer owns the additional term-edit, term-history, resubmission, combined and agent fixture adjustments.

TDD evidence:

- Interest ranking: four expected failures under old privilege ordering; after implementation all 17 tests passed.
- New-term body: expected 400 but received 201 before implementation; metadata creation and rejection checks passed afterward.
- Nonstring body: expected 400 but received 201 before boundary guard; all nine production integration tests passed afterward.

Verification completed so far:

- Affected content/interests tests: 27 passed after updating real seed backlink topology.
- Production + consolidation: 10 passed with dedicated PostgreSQL and Meilisearch.
- Earlier affected review, guest-discovery and schools-category tests passed.
- Content pilot Node tests: 3 passed.
- Typecheck passed. Full lint passed with zero errors; one transient unused fixture variable warning was delegated to its editing owner.
- Scoped browser coverage: 21 passing scenarios across browse, navigate, public pin removal, production, review, interests and MVP consolidation/snapshot files. Initial run had 20 passes and one search-dependent failure because search was disabled. The failing MVP scenario passed when rerun against the dedicated Meilisearch with its own `equal-app-browser-test` index. One existing opt-in consolidation browser scenario remained skipped by its disposable-database prefix/flag guard.

All database mutations used `phosky_equal_app_test` at `127.0.0.1:55435`. Final search-dependent tests use the dedicated test Meilisearch at `127.0.0.1:57735`; credentials loaded into process environment without logging them. Initial consolidation attempts used the test-only `consolidation-test` index on the default local search host, then moved to the dedicated test service. No production database changes, deployment, commits or pushes.

## Regression discovered during verification

The consolidation CLI called `process.exit` immediately after printing its JSON. Windows Node aborted with `UV_HANDLE_CLOSING` while search transport handles were closing. It now sets `process.exitCode` and drains database pools with the existing `closeDatabases` helper before normal process exit. The full consolidation integration test passes with configured search authentication. This is a narrow CLI shutdown fix; consolidation behavior is unchanged except for removal of merged pin state.

## Review and remaining coordination

Independent application reviewer found no runtime blocker. Its P3 finding about obsolete README token-auth instructions was resolved to describe current login-session auth.

Root owns schema, migration, seed, bootstrap, domain documents and full-suite verification. Search must be configured to exercise browser search behavior; the opt-in destructive consolidation browser scenario remains guarded by its existing disposable database prefix and explicit flag.
