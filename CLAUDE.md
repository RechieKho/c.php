# Agent instructions

## Documentation layout

| Directory | Active doc | Purpose |
|---|---|---|
| `state/` | `STATE.md` | Current status, TODOs, gotchas |
| `remaining_tasks/` | `REMAINING_TASKS.md` | Open work by milestone |
| `architecture/` | `ARCHITECTURE_SPEC.md` | Architecture specification |

Read these before starting work.

## Dreaming (required after every completed implementation)

Whenever you finish an implementation (a feature, milestone item, or fix that changes project state), update the docs, then **dream** all three: `STATE.md`, `REMAINING_TASKS.md` and `ARCHITECTURE_SPEC.md`:

1. Update `STATE.md` and `REMAINING_TASKS.md` to reflect what changed (tick or remove finished items, add new TODOs and gotchas). Update `ARCHITECTURE_SPEC.md` if the design changed (e.g. a **(verify)** assumption was confirmed or refuted).
2. Keep each active doc **under 500 lines**. Check with `wc -l state/STATE.md remaining_tasks/REMAINING_TASKS.md architecture/ARCHITECTURE_SPEC.md`.
3. Extract **inactive information** (completed tasks, resolved gotchas, finished milestones, superseded decisions, verified assumptions) into a separate markdown file in the same directory's `archive/` subfolder, e.g. `state/archive/2026-10-26-milestone-0.md`. Do not delete history.
4. Leave a one-line pointer in the active doc to each archive file it was extracted into.
5. For `ARCHITECTURE_SPEC.md`, archive superseded design, resolved assumptions and rejected alternatives into `architecture/archive/`. The spec keeps only the current design.

Do not dream mid-implementation; do it once the work is complete and verified.

## Editor / npm layout

All editor code is in `editor/vscode/`, and it is the **only** npm project: `package.json`, `package-lock.json`, `node_modules/`, build output and `.vsix` files all live there. Run `npm` commands from `editor/vscode/`, never from the repo root. Do not add a root `package.json`.
