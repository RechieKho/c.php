# Agent instructions

## Documentation layout

| Directory | Active doc | Purpose |
|---|---|---|
| `state/` | `STATE.md` | Current status, TODOs, gotchas |
| `remaining_tasks/` | `REMAINING_TASKS.md` | Open work by milestone |
| `architecture/` | `ARCHITECTURE_SPEC.md` | Architecture specification |

Read these before starting work.

## Dreaming (required after every completed implementation)

Whenever you finish an implementation (a feature, milestone item, or fix that changes project state), update the docs, then **dream**:

1. Update `STATE.md` and `REMAINING_TASKS.md` to reflect what changed (tick or remove finished items, add new TODOs and gotchas).
2. Keep each active doc **under 500 lines**. Check with `wc -l state/STATE.md remaining_tasks/REMAINING_TASKS.md architecture/ARCHITECTURE_SPEC.md`.
3. Extract **inactive information** (completed tasks, resolved gotchas, finished milestones, superseded decisions, verified assumptions) into a separate markdown file in the same directory's `archive/` subfolder, e.g. `state/archive/2026-10-26-milestone-0.md`. Do not delete history.
4. Leave a one-line pointer in the active doc to each archive file it was extracted into.
5. Do the same for `architecture/` if the spec grows past the limit (move superseded design into `architecture/archive/`).

Do not dream mid-implementation; do it once the work is complete and verified.
