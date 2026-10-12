# Open items — omp-custom

## Compiled launcher started in `~/.omp/.dev-cwd` — fixed on `custom` (`3053707ab9`)

`packages/coding-agent/scripts/omp` (local commit `4c843c0d0c`) `cd`s into
`${OMP_DEV_LAUNCH_DIR:-$HOME/.omp/.dev-cwd}` before it picks a launch path, but only the
source path ever came back: the restore lives in the Bun `--preload` shim
(`scripts/omp.ts`), which the compiled artifact never loads. Any `auto` launch that hit
the memoized `dist/omp` therefore ran with `process.cwd()` = `~/.omp/.dev-cwd`, and
`getProjectDir()` (`packages/utils/src/dirs.ts`) is just `process.cwd()`, so that whole
directory was treated as the project.

Measured before the fix: `omp read .` from `/tmp/omp-cwd-probe` returned
`.omp/ssh.json`, which exists under `~/.omp/.dev-cwd/.omp/` (19:17) and not in the probe
dir; `~/.omp/agent/sessions/-.omp-.dev-cwd/` holds the sessions from that window. Fix:
the `mkdir`/`cd`/`OMP_LAUNCH_CWD` export moved inside `launch_source()`, so the compiled
path keeps the caller's cwd. Verified after: `omp read .` from a fresh
`/tmp/omp-cwd-probe3` lists `only-here.txt`, and `OMP_LAUNCH_MODE=ts` from the same
directory still resolves `.` there through the shim.

- **Committed locally, not upstreamed.** Landed as `3053707ab9` together with the
  launcher's untracked-file fingerprint change (`--untracked-files=no`, so a
  `.codegraph/` index no longer forces a rebuild) and `bun setup`'s removal of the
  `bun --cwd=packages/coding-agent link` step plus the `OMP_BIN_DIR`-aware Windows
  linker. The launcher sees a moved generation on the next `omp` invocation and rebuilds
  `dist/omp`. Decide whether this goes upstream; `custom` MUST NOT carry a changelog
  entry (per `skill://omp-change-and-install`).
- **Stale project state.** Sessions and `.omp/ssh.json` written under `~/.omp/.dev-cwd`
  while the compiled path was in use stay where they are; nothing is migrated. Decide
  whether they should be moved into the real project directories.

## Upstream merge — landed on `custom` (`d741066820`), 2026-10-12

`Merge origin/main into custom (2681 commits)` took the tree from upstream
18.5.1 to 18.10.1. Built in `~/.omp/wt/merge-upstream-20261012` (branch
`merge/upstream-20261012`), ff-merged into `omp-custom`. `packages/natives`
changed, so `bun run setup` rebuilt the native addon (18.10.1) and relinked
`~/.local/bin/omp`. `bun run check:ts` clean; the catalog, tui, and mnemopi
suites are green on the merged tree.

- **TUI streaming retirement now follows upstream's refined append path**:
  overflow-sized emission, and a stable prefix reaching onto the screen waits.
  Custom's uncapped emission (`c2baf3c5df`) and the test that pinned it were
  dropped — it was the cruder form of the same feature and opened a blank band
  once the working loader shrank (`composer-inline-shrink`). The trade kept: the
  live area may hold an on-screen stable prefix, which is the cost of never
  stranding a row above the live tail.
- **Pre-existing failures on this box**, not merge regressions — the same files
  fail on `custom` at `adf9758c9e`: `stats/test/fork-dedup` (1),
  `task/worktree` (2), `task/parked-subagent-session-release` (2), plus
  in-suite-only failures caused by missing externals (browser/Chrome, Electron,
  npm and HTML-export builds, `SYSTEM.md` discovery ordering).
- **`bun.lock` took upstream's side** and was re-resolved with `bun install`.

## Process niceness for spawned tools — landed on `custom` (`1a753eb8b8`)

`process.nice` lowers the scheduling priority of omp and every process it spawns, so
`tsgo` (the TypeScript LSP) and `cargo`/`rustc` can no longer pin every core and freeze
the desktop. Applied once at startup in `runRootCommand`
(`packages/coding-agent/src/exec/process-priority.ts`, called from `main.ts` after
settings load); `~/.omp/agent/config.yml` sets `process.nice: 19`.

- **Not upstreamed.** No PR, no branch. `custom` MUST NOT carry a changelog entry (per
  `skill://omp-change-and-install`).
- **cgroup is not available here.** No systemd (`command not found: systemctl`);
  `/sys/fs/cgroup` is root-only, the session cgroup `/sys/fs/cgroup/1` is neither
  writable nor subdividable, `/sys/fs/cgroup/omp` is root-owned and empty, and
  `systemd-run`/`cgcreate`/`cgexec` are absent; `doas` requires a password. An
  unprivileged omp therefore cannot use cgroups — niceness is the available
  equivalent. A delegated cgroup would need a one-time root setup plus a boot hook
  (dinit) to survive reboot.
- **Only the `launch` path applies it.** `omp shell`, `omp config`, and the launcher's
  own `bun run build` still run at the default priority. Decide whether they need it.
- **Startup window.** Applied after settings load (~1 s in), so threads created before
  then briefly keep nice 0; no heavy child spawns that early. Linux niceness is
  per-*thread*, so the applier walks `/proc/self/task`; children inherit the forking
  thread's niceness. Skipped under `isBunTestRuntime()` so the suite is never reniced.

## Auto-Learn session-settle scribe — landed on `custom` (`ebde23a70d`), not upstreamed

`feat(autolearn): ran a small-model scribe when a session settles`, built in
`~/.omp/wt/autolearn-scribe-5be06592e9` on branch `autolearn/scribe` and
fast-forwarded into `custom`; the launcher rebuilt `dist/omp` on first use.

- **PR opened: https://github.com/can1357/oh-my-pi/pull/15460** — 1 commit
  (`47b0ca529e`), 10 files, +248/−32, on branch `autolearn/scribe-upstream` in
  `~/.omp/wt/autolearn-scribe-upstream-5d0aaffaf1` (based on `origin/main`
  5d0aaffaf1; the change applied as a clean cherry-pick). On that base: 105/105
  auto-learn tests pass, `bun run check:ts` clean (oxlint + oxfmt over 5994
  files, 16 package typechecks), oxlint/oxfmt clean on every changed file. The
  `## [Unreleased]` changelog entry carries the PR link and `@iacore` credit;
  `custom` itself MUST NOT carry a changelog entry (per
  `skill://omp-change-and-install`). GitHub reports
  `mergeable_state: unstable` with no checks reported on the branch yet.
  Commits on this branch are **unsigned**: `~/.ssh` was emptied mid-session, so
  `commit.gpgsign=true` had no key to sign with.
- **Off until configured.** Code defaults stay conservative: `autolearn.scribe:
  false`, `autolearn.model` empty (= the `smol` role), `autolearn.autoContinue:
  false`. The install needs, in `~/.omp/agent/config.yml`:
  `autolearn.scribe: true`, `autolearn.model: ef/qwen3.5-9b`, and (for the
  in-turn capture nudge) `autolearn.autoContinue: true`.
- **Print mode can drop the pass.** Measured: an `omp -p` run whose turn made 6
  tool calls sent the stand-in scribe model **0** requests, while the same prompt
  driven in-process sent the pass. [INFERENCE] `beginDispose` sets `#isDisposed`
  and calls `#abortAutolearnCapture` while the pass is still awaiting its model
  resolution, so a short-lived process loses it. Interactive sessions are
  unaffected; decide whether the pass should survive dispose.
- **Dispose budget.** `#drainAutolearnCapture` waits 3 s for an in-flight pass
  (`agent-session.ts`). A local 9B scribe over a long transcript can exceed that
  and be dropped with "Auto-learn capture did not settle during dispose". Decide
  whether the scribe deserves its own budget.
- **Scribe writes only managed skills here.** With `memory.backend: sharpshooter`
  the `learn` tool is never registered (`tools/learn.ts` `createIf` accepts only
(`hindsight|mnemopi|local`), so the pass can mint/enhance managed skills but not
  record durable facts. Whether `learn` should gain a sharpshooter branch is an
  open decision.

## Interrupt before output returns the prompt to the editor — landed on `custom` (`adf9758c9e`), not upstreamed

`fix(prompt): returned an interrupted empty turn's prompt to the editor`, built in
`~/.omp/wt/integrate-interrupt-restore-ebde23a70d` off `custom` and
fast-forwarded in. An Esc interrupt that lands before the model emits anything
now drops the unanswered user turn (live context and persisted branch) and hands
its text back through `setPromptDropped`, so interactive mode refills the editor.

- **No PR.** Pushing is a public action and the user has not approved it. The PR
  needs a branch off `origin/main` plus a `## [Unreleased]` changelog entry;
  `custom` MUST NOT carry that entry (per `skill://omp-change-and-install`).
- **Host-scoped by design.** The rewind only runs when a host registered
  `setPromptDropped` — interactive mode. Print, RPC, and ACP keep the current
  behavior (the user message stays in the transcript). Decide whether any of them
  should gain a restore channel of their own.
- **Non-image attachments are not restored.** `#restoreInterruptedEmptyPrompt`
  builds its payload from `toRestoredQueuedMessage` (text + image blocks), so a
  video preview or other attachment submitted with the prompt is lost when the
  turn is restored. Decide whether the restore must carry them.