# Security and reliability verification

## Scope and result

Reviewed the ECC findings against the Phase 1 implementation, with focused
regression tests for speech cancellation, state synchronization, extraction
privacy and page invalidation. No change was needed to the extraction pipeline:
it filters excluded/hidden nodes in a clone, does not mutate the live page, and
Phase 1 contains no page-text network client or background page monitor.

The review found and fixed one confirmed lifecycle defect: calling Resume after
Stop could change the store to `starting` despite there being no paused speech
job. Resume now requires the store to be `paused`.

## Evidence

- Audio hook tests cover Play → Stop, Pause → Resume, Stop → Play,
  Pause → Stop → Resume, unmount/close, navigation/session invalidation,
  article replacement, duplicate commands, delayed/stale callbacks and
  synthesis failure.
- Existing extraction tests cover hidden and excluded content, password/form
  text, editable content, widget exclusion and no live-DOM mutation.
- Existing watcher tests cover article replacement, URL changes, teardown,
  hidden-content changes and session invalidation.

Run `npm test`, `npm run typecheck`, `npm run lint` and `npm run build` for
automated verification. Real Chrome/Brave voice and extension lifecycle checks
remain manual; this report does not claim browser-level proof or complete
application security.

## ECC finding disposition

| Finding | Disposition |
|---|---|
| ECC-001 — harness manifest | Not added. No ECC manifest or ECC executable is present in this repository/environment, and the report does not specify a verifiable manifest schema. Do not invent one. |
| ECC-002 — GitHub Checks permissions | External CI configuration. No workflow is present here to change; repository/org permissions must be reviewed by its administrator. |
| ECC-003 — reference-set readiness | Neutral evidence gap; no application change indicated. |
| ECC-004 — PR taxonomy | Informational classification; no application change indicated. |
| ECC-005 — audio security evidence | Addressed with the lifecycle fix and regression tests above. |
| ECC-006 — browser/CI verification | Automated checks are strengthened by the new tests and build verification. Chrome and Brave manual runs remain outstanding. |

Hosted promotion readiness did not evaluate matching scenarios or completed
hosted jobs, so its success is not treated as application-security evidence.
