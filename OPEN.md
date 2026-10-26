# Open items — omp-custom

<!-- item: autoresearch-extension-removed state=done owner=- blocked=- -->
## Built-in autoresearch removed from `custom` (2026-10-27)

Never used in any past session, so the whole feature is gone: the
`packages/coding-agent/src/autoresearch/` extension (its slash command,
`init_experiment` / `run_experiment` / `log_experiment` / `update_notes` tools,
the SQLite run store and the branch/commit plumbing), its four test files, the
TUI side (`apps/autoresearch-dashboard.ts`, `apps/autoresearch-data.ts`,
`tools/autoresearch.ts` and their test), the `./autoresearch*` exports in
`packages/coding-agent/package.json`, `getAutoresearch*` in
`packages/utils/src/dirs.ts`, and the doc rows (`environment-variables.md`,
`session.md`, `DEVELOPMENT.md`).

- **Evidence of no use**: `agent.db`'s `command_usage` lists 18 commands and
  none is `autoresearch`; no session transcript contains a
  `log_experiment` / `init_experiment` tool call; the only mentions across all
  sessions were reads of the feature's own source and of its tests' temp dirs.
- **Runtime check**: a `createAgentSession` smoke on the edited tree reports
  extension commands `deepseek-sandbox,reply-envelope` — no `autoresearch`.
- **Verified**: `check:types` clean for all 16 packages; `packages/tui` 4033
  pass / 0 fail; `packages/utils` 918 pass / 0 fail; the affected
  coding-agent tests 31/31; `oxlint` silent and `oxfmt --check` clean on the
  touched files; `cli.ts --smoke-test` ok. `sdk-*.test.ts` + `slash-commands`
  batch shows one failure (`AsyncJobManager … secondary session disposes`) that
  reproduces identically on the unmodified tree — pre-existing, not this change.
- **Cost**: every future upstream merge can conflict where upstream still
  imports `./autoresearch` from `sdk.ts`. The fork took the deletion
  deliberately; when `sdk.ts` conflicts, keep the deletion.

<!-- item: doas-sudo-bash-calls-get state=blocked owner=- blocked=upstream -->
## `doas`/`sudo` bash calls get a terminal for their password prompt — landed on `custom` (`0303e0f488`), PR [#16103](https://github.com/can1357/oh-my-pi/pull/16103) open upstream (2026-10-18)

`/usr/bin/doas` here is OpenDoas (`doas [-Lns]` — no `-A`/askpass, confirmed by
its own usage line and by `strings`), and `/etc/doas.conf` grants a password
prompt, so the password can only come from a controlling terminal: `doas` opens
`/dev/tty` and never reads stdin. A bash call in omp's plain executor has no
terminal, so it answered `doas: Authentication failed` (measured: 1.58 s)
without ever prompting, and `echo hunter2 | doas true` failed the same way
(2.30 s).

- **A call whose command word is `doas` or `sudo` now runs on the same
  interactive PTY an explicit `pty: true` call uses.** The detection is
  `bashNeedsAuthTerminal` (`src/tools/bash-pty-selection.ts`, over the shared
  `tokenizeShellSegments`; any command position, path-qualified words included),
  wired through `ptyRequestedFor` (`src/tools/bash.ts`) into the PTY branch, the
  virtual-cwd guard, the direnv preflight, the auto-background gate and the
  tool's concurrency (`exclusive`). A call that already says it will not prompt
  (`-n`/`--non-interactive`, `-A`/`--askpass`, `-S`/`--stdin`) is left to the
  plain executor, an explicit `pty: false` wins, the ACP client terminal keeps
  the call where the local UI is absent, and where neither terminal exists the
  result carries a notice saying so. `src/prompts/tools/bash.md` now tells the
  model `doas`/`sudo` get the terminal on their own.
- **On `custom` as `0303e0f488`**, built in `~/.omp/wt/doas-pty-9dcdd6817e` off
  `custom` and ff-merged into `omp-custom`; `packages/natives` is untouched, so
  the launcher's memoized binary rebuilt on the next invocation. The PR branch
  `fix/doas-auth-terminal` lives in `~/.omp/wt/doas-pty-upstream-470b7efb67`, a
  clean cherry-pick rebased onto `origin/main` `df4f996e66` (the first fetch had
  left it on `470b7efb67`, which made GitHub report the PR `CONFLICTING`); its
  changelog entry stays on that branch per `skill://omp-change-and-install`.
- **Verified**: unit cases for the detection in `test/tools/bash-pty-selection.test.ts`;
  the new `test/tools/bash-auth-terminal.test.ts` drives the real PTY through the
  tool and observes `doas (user@17) password:` (its second case checks the no-UI
  notice); 87 pass across the six bash test files; `check:types`, oxlint and
  oxfmt clean on both trees. End-to-end through the installed launcher on a
  Python `pty.fork` driver (`~/.local/bin/omp "<run doas true>"` in
  `/tmp/doas-smoke`): the session's terminal card reads
  `force-kill · input forwarded to PTY` above `doas (user@17) password:`.
- **The preference that goes with it** is in `~/.omp/agent/APPEND_SYSTEM.md`:
  privileged execution is written as `doas <command>`, with no probe for `sudo`
  and no fallback chain.
- **Open:** PR #16103 awaits review. Two things not taken: a wrapper that hides
  the command word (`env doas …`, `bash -c 'doas …'`) is not detected, and the
  same one-word fix now exists twice — on `custom` and on the PR branch — so the
  PR MUST land before the next upstream merge.

<!-- item: in-process-uptime-builtin-is state=done owner=- blocked=- -->
## The in-process `uptime` builtin is gone from the shell — landed on `custom` (`09210499e7`), not upstreamed (2026-10-18)

`uptime` in the embedded shell **was** `pi-builtins`' in-process builtin
(`crates/pi-builtins/src/uptime.rs`, registered at `factory.rs:327-328`), and it
shadowed `/usr/bin/uptime`. `/var/run/utmp` on this box holds no BOOT_TIME
record, and the builtin then takes gnulib's fallback — the **first** mtime in
`BOOT_TOUCHED_FILES` (`uptime.rs:441-456`) that is ≥ `1_122_334_455`. Order is
`/var/lib/systemd/random-seed`, `/var/lib/urandom/random-seed`,
`/var/lib/random-seed`, `/var/run/utmp`; the first two do not exist here, and
`/var/lib/random-seed` carries mtime `2023-09-25 05:02:32.688`, so it wins over
the accurate `/var/run/utmp`. Measured the same day: `uptime` → `up 1118 days`,
`uptime -s` → `2023-09-25 05:02:32`; `/usr/bin/uptime` (procps-ng 4.0.7) →
`up 30 min`; `/proc/uptime` / `CLOCK_BOOTTIME` → boot `02:25:29`.

- **coreutils `who -b` lies the same way** — it uses gnulib's `readutmp`, so it
  prints the same stale date from the same file. The stale file, not either
  program, is the root cause; any box that does not run systemd can carry a
  multi-year-old `/var/lib/random-seed`.
- **No per-builtin switch.** `PI_DISABLE_UUTILS_BUILTINS=1`
  (`crates/pi-shell/src/shell.rs:845`) is all-or-nothing for the whole uutils
  set; `rm`/`mv`/`nohup` are the only individually gated ones. Dropping `uptime`
  alone needs a code change (`factory.rs` registration, or the fallback order in
  `uptime.rs`) plus a rebuild.
- **`enable -n uptime` works in a shell** and hands `uptime` back to
  `/usr/bin/uptime` for that session's shell only.
- **Landed `09210499e7`** — "dropped the in-process uptime builtin". The
  builtin, its `util.uptime` feature, its module, its arm in the `time_zone`
  gate, and its name in the registry test's expected list
  (`crates/pi-shell/src/shell.rs`) are gone, so the name resolves to the system
  binary. Built in `~/.omp/wt/drop-uptime-builtin-7914a308b5` off `custom`,
  rebased onto the two `docs(open)` commits that landed meanwhile, and
  fast-forwarded into `omp-custom`.
- **Verified**: `cargo nextest run -p pi-builtins -p pi-shell` → 2252 tests,
  2251 passed, 1 skipped, and one failure —
  `df::tests::total_row_names_target_dash_when_source_is_shown`, a column-width
  assertion that fails the same way on unmodified `custom` (environment
  dependent, milage: `total            -` vs `total          -`).
  `every_utility_builtin_is_registered_under_its_own_name` passes with the name
  removed; `cargo fmt --check` is clean. Deleting the stale
  `/var/lib/random-seed` was declined and stays undone, so coreutils `who -b`
  still prints 2023.

<!-- item: session-titles-landed-on-custom state=done owner=- blocked=- -->
## Session titles — landed on `custom` (`f1403ab55e`, `559aa975ba`), not upstreamed

A generated session title is the tab label in a TSP terminal: omp writes it to
OSC 0 (`utils/title-generator.ts`, `buildNativeTerminalTitle`), and Tern's rail
shows it. The prompts asked for a *"3-6 word imperative phrase"*, so the model
wrapped the user's own words in its own verb — "learn how to operate librewolf"
became `Learn to operate running LibreWolf`, "implement this project to your
liking" became `Implement volitare-iterum project` — and the label ellipsized in
the rail.

- **Both title prompts now ask for a 1-5 word subject label in the user's own
  words** — the concrete thing named (repo, component, service, file, error),
  framing ("can you", "learn how to") and trailing conditions dropped, ordinary
  words lowercase, and names capitalized even when the user typed them
  lowercase. Changed: `prompts/system/title-system.md` (the tiny path and the
  fork's override) and `prompts/system/title-fork.md` (the fork path, and the
  default `title.generator`).
- **On `custom` as `f1403ab55e` + `559aa975ba`**, built in
  `~/.omp/wt/title-subject-663cab63e7` off `custom` and ff-merged into
  `omp-custom`, then `bun run build` so the launcher's memoized binary carries
  it. `bun test test/agent-session-title-fork.test.ts test/title-card.test.ts
  test/slash-commands/rename.test.ts` is 78/78 and `bun run check:types` is
  clean.
- **Verified end-to-end** through the installed launcher, one fresh
  `omp --no-tools` session per first message: "the retry queue drops jobs when
  redis restarts, can u look" → `retry queue drops jobs on Redis restart`;
  "can you let tern not reorder tern sessions? currently, when i focus on a
  session, it moves to the top." → `Tern session reordering`. Both are subject
  labels with no added verb. Print mode does **not** title — `omp -p` left the
  slot empty — so a title check MUST drive a real interactive session.
- **No PR.** The style is a personal choice (the user's own tabs); nothing is
  pushed.
- **Open:** the label is still the model's pick, so it reads like the target
  list (`Tern no reorder sessions`, `operate Librewolf`) without always matching
  it word-for-word. Nothing in the harness makes a user rename win over a later
  auto-title beyond `source: "user"`; revisit only if the drift matters.

## Tern tab names — set for the five sessions the user listed (2026-10-16)

`tern rename <BLOCK> <NAME>` (Tern 0.9.0, the window's own daemon) sets a tab's
user name, which the rail shows over the program's OSC 0 title. The live tab
`Learn to operate running LibreWolf` was renamed to `operate Librewolf`
(Default tab 1). The three sessions whose panes were gone from the window had
their session title slot rewritten in place (256-byte first line, `source:
"user"`): `-computing-play-volitare-iterum/2026-10-16T15-14-21-673Z_…jsonl` →
`volitare-iterum`, `-tmp/2026-10-16T15-15-40-099Z_…jsonl` → `docs-server`,
`-tmp/2026-10-16T15-18-26-535Z_…jsonl` → `Tern no reorder sessions`; the live
`-tmp/2026-10-16T15-29-33-284Z_…jsonl` was patched to `operate Librewolf` too.
`Set tern theme to kitty` already read that.

<!-- item: running-session-cannot-be-re state=open owner=- blocked=- -->
- **A running session cannot be re-titled from outside.** Its tab label is its
  own OSC 0 write, and the user's Tern window has no control endpoint
  (`tern ctl` needs a window started with `--control`, and the session daemon
  socket is a different protocol). The file patch is read on the session's next
  start, not by the live process.

<!-- item: unauthenticated-github-release-fetch-in state=blocked owner=- blocked=upstream -->
## Unauthenticated GitHub release fetch in `tools-manager.ts` — landed on `custom` (`7ee58e5f60`), PR [#15981](https://github.com/can1357/oh-my-pi/pull/15981) open upstream

`getLatestVersion` (`packages/coding-agent/src/utils/tools-manager.ts:176`) used to fetch
`api.github.com/repos/<repo>/releases/latest` with only a `User-Agent` header, so on an egress IP
whose anonymous budget was spent (`403 API rate limit exceeded for 103.190.179.31`, 2026-10-16) a
tool install died with `GitHub API error: 403` — exporting a token did not reach it. It now sends
`GITHUB_TOKEN`/`GH_TOKEN` as a bearer credential, the same fallback as
`web/scrapers/github.ts` and `cli/git-tui/avatar.ts`.

- **On `custom` as `7ee58e5f60`**, built in `~/.omp/wt/integrate-github-release-auth-5349784d1d`
  off `custom` and ff-merged into `omp-custom` (the branch based on `origin/main` conflicted in
  `packages/tui`, so it landed as a source+test integration commit). The changelog entry stays on
  the PR branch per `skill://omp-change-and-install`, so `/changelog` does not list the fix until
  the PR lands upstream.
- **Verified on this machine**, whose egress had `remaining: 0` of 60: without a token
  `getLatestVersion("chmln/sd")` threw `GitHub API error: 403`; with `GH_TOKEN` it resolved
  `1.1.0`. `bun test test/tools-manager-download.test.ts` is 4/4, and the token case added there
  fails with the token line removed. `bun run check:ts` clean on the PR branch.
- **Not exercised through a real install here.** `sd`, `sg`, `yt-dlp` and `trafilatura` all
  resolve through `$which`, so `getToolPath` returns before the download path runs; the fix was
  checked by calling `getLatestVersion` directly.

<!-- item: local-codegraph-ignore-landed-on state=done owner=- blocked=- -->
## Local `.codegraph/` ignore — landed on `custom` (`5f67ef1bfb`), upstreaming declined

`.gitignore` now carries `.codegraph/` under `# Project specific`. It is a per-checkout index
(`codegraph init`), and the launcher's generation fingerprint already ignored untracked files, so
it never forced a rebuild — it only cluttered `git status`.

- **Not upstreamed, deliberately.** Upstream carries the same `codegraph` integration, but the
  entry stays on `custom`; do not propose it again.

<!-- item: session-pin-palette-wording-on state=blocked owner=- blocked=upstream -->
## `/session pin` palette wording — on `custom` (`a060de43da`), PR [#15479](https://github.com/can1357/oh-my-pi/pull/15479) open upstream

The row read *Pin the current provider to a stored OAuth account*: the provider as the pinned
object, and nothing saying the pin is scoped to the session — the reading a user gets is a
`/login`-style provider-wide account switch. `pinCurrentProviderOAuthAccount`
(`packages/coding-agent/src/session/agent-session.ts`) pins one stored OAuth account as this
session's credential for the current provider, which is also how `packages/ai/src/auth/affinity.ts`
and the command's own text listing phrase it. The string is unchanged since the feature landed in
`af9e8546a9`, so this is not a regression.

- **On `custom` as `a060de43da`.** The PR branch is based on `origin/main`, so merging it here
  would have dragged the whole upstream drift custom has not taken — the attempt staged
  `Cargo.lock`, `MODULE.bazel.lock` and `crates/…` against a tree 5026 commits behind. Landed
  instead as a source-only integration commit built in
  `~/.omp/wt/integrate-pin-help-5f67ef1bfb` and ff-merged into `omp-custom`. The changelog entry
  stays on the PR branch (`skill://omp-change-and-install`), so Tern's `/changelog` does not list
  the fix until the PR lands upstream.
- **Upstream PR still open.** Branch `fix/session-pin-help` (`91a926fc08`, worktree
  `~/.omp/wt/session-pin-help-c8913466dd`) is pushed to `g`; when it lands, its entry arrives with
  `origin/main` and nothing else is left to carry.
- Verified on the installed launcher (`~/.local/bin/omp` → this checkout, so it rebuilt after the
  merge): `/session ` then the `pin` row reads `Pin a stored OAuth account for this session`,
  intact at 80 columns where the old 48-character string ellipsized.

<!-- item: rows-with-no-cells-inside state=blocked owner=- blocked=upstream -->
## Rows with no cells inside a streamed table — band fixed on `custom` (`971cc3e7c4`), PR [#15499](https://github.com/can1357/oh-my-pi/pull/15499) open upstream

A reply whose body is a wide GFM table (`#renderTable`, `packages/tui/src/components/markdown.ts`)
left four rows holding **no cells at all** inside one table row of the terminal's scrollback: the
row's wrapped lines 1–2, then four empty rows, then line 3 (the row's remaining text). Seen with the
installed launcher in session `2026-10-12T14-37-11-882Z_01a1308b-…` (cwd `/tmp`) at 107 columns.

- **Not a table-render defect.** `new Markdown(doc, 0, 0, getMarkdownTheme()).render(107)` over that
  message's exact table (read back from the session JSONL) reproduces the column widths 13/19/72 and
  every line break present in the scrollback, with zero blank rows in the whole table.
- **Not a cell-highlighting rule.** A selection paints rows that hold cells — default-background
  space cells included — and skips rows that hold none (measured on kitty 0.48.2 with this config's
  font: spaces highlighted, bare `CRLF` and `EL` rows not). So those four rows reached the terminal
  with no cells; that is how a blank row is written by construction, since `#lineRewriteSequence` +
  `#terminalLine` (`packages/tui/src/tui.ts`) emit a blank line reset-only and the `blankRow` path
  skips the erase ("re-erasing every row only adds terminal parser work").
- **Searched for in ~55 runs and not found.** Streaming that table through the real components on a
  `VirtualTerminal` (kitty-vt-wasm) left no blank row inside the table and no repeated row in native
  history across: geometry 107x{24,30,40,50} and 100x{40,50} with 0/10/20/40 settled rows above;
  chunk 4/12/24/60/400 characters; a frame per chunk and one per 2/3/5/7 chunks; the working loader
  0→2→0, 3→0 and 5→0 before, during and after the stream; width resize 100→107 and 107→100, height
  50→30 and 50→70, before, during and after the stream; the loader growing or shrinking around each
  resize; a destructive `resetDisplay()` mid-stream and after finalize; the user scrolling back
  10/25 rows mid-stream, after finalize, and across a resize; `setMidStreamPublication` both ways.
- **Not a kitty reflow loss either.** 200 full-width table rows printed into kitty 0.48.2, then the
  window narrowed 1000→700 px, the font 12→11→12, and the window widened back: `get-text --extent=all`
  returned all 200 rows once, in order, with no gap.
- **A band of the same shape reproduces — in the viewport, not in history.** A block above the live
  tail collapsing (10 settled rows, a 25-row card, 2 loader rows, 107x50, card 25→1 at 70 % of the
  stream) leaves a deterministic run of blank rows at the top of the live area — 7 of them at
  viewport rows 0–6 with the answer below — inserted by `topPadding` in `renderFrame`
  (`packages/tui/src/prompt/composer.ts`, `if (topPadding > 0) mutable.unshift(…)`). That padding is
  deliberate ("Keep the input on the bottom row instead of stranding a band of blank rows under it"),
  and it cannot be the field hole: `topPadding` keeps the frame at or under the screen height, so a
  frame with slack never scrolls, and the slack is consumed by the next growth instead of being
  pushed into history. Swept for anyway across 4 heights × 3 settled widths × 2 card sizes × 4
  collapse points with a 90-row tail forcing everything into history: 0 blank rows inside a table.
- **A committed prefix of a shrunken block does strand rows.** The same run leaves the collapsed
  card's pre-collapse rows (`Tool output row 0…11`) standing in native history above the collapsed
  remainder — history keeps the old shape, which is the "cannot be retracted" trade, not the hole.
- **Still unexcluded.** The field hole needs a scroll that pushes *something* blank into native
  history while the seam sits inside a table. Remaining suspects: the chrome-into-history leak
  (`tui.ts:4231`, upstream #9783; "live chrome" is blank rows, and the field report counts 4–15 of
  them), the erase-then-scroll seam in the non-diffable paint (`#eraseBelowRow`), and a commit-prefix
  seam at a streaming table's block boundary. No fix MUST be written before a capture shows the run:
  write the bytes with `tmux -L <sock> new -d … 'script -q -f out.raw -c "OMP_LAUNCH_MODE=ts omp"'`,
  hit the toggle (`setHideThinkingBlock` / tool-output expansion) while a table streams, and look for
  a bare `\n\r\n` (a row with no cells) inside a run of `│` rows.

- **Landed as `971cc3e7c4` (PR [#15499](https://github.com/can1357/oh-my-pi/pull/15499)).** The band
  was the composer's top padding after all: a frame that shrank over committed history padded the
  live area's top, so a collapsing block punched cell-less rows into the live tail, and a selection
  could not paint them. The slack now falls below the live rows, which keeps the transcript
  contiguous and the input on the bottom row. Verified: viewport row 0 was blank before and holds
  the reply's first row after; the case in `packages/tui/test/composer-inline-shrink.test.ts` fails
  on the parent commit; `packages/tui` is 3701 pass / 0 fail; the installed launcher links and its
  suite is 13/13. The field hole's *history* variant was never reproduced in the harness, so if it
  recurs after this fix, capture the bytes before touching the retire/commit path.

<!-- item: mid-stream-scrollback-publication-off state=open owner=- blocked=- -->
## Mid-stream scrollback publication — off on `custom` (`595db56375`), not upstreamed

`createAssistantMessageComponent` (`packages/tui/src/prompt/interactive-context-helpers.ts`)
now passes `setMidStreamPublication(false)` for every wire instead of only the ones the
`stream-revision` axis marks `possible`. A turn refused or rewritten after it streamed used to
leave its published rows standing above the replacement: native scrollback cannot be
retracted, and no VT100/ECMA-48 sequence addresses lines that already scrolled into history.

- **Not upstreamed.** No PR and no branch off `origin/main`; `custom` MUST NOT carry a
  changelog entry (per `skill://omp-change-and-install`).
- **Cost.** Upstream's #11276 fix is traded away — a reply taller than the window clips its own
  beginning while it streams, which lasts only until the turn ends.
- **Only the publication is gated.** The machinery it drives (`#publishStableSnapshot`, the
  stable snapshots, the container's append-head emission) stays in the tree but is never
  enabled, so the next upstream merge does not conflict on it. Decide whether the fork should
  delete it instead.
- **Pressure retirement still runs mid-turn** for settled blocks (finished tool cards, earlier
  turns) when the viewport overflows. That is ordinary scrolling rather than early
  publication, and a rewrite of a settled turn still cannot retract its rows.
- **No config key.** The flag is wired in code, so flipping it back needs a source edit and a
  rebuild; decide whether it earns a setting.

<!-- item: compiled-launcher-started-in-omp state=done owner=- blocked=- -->
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

<!-- item: upstream-merge-landed-on-custom state=blocked owner=- blocked=upstream -->
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

<!-- item: process-niceness-for-spawned-tools state=done owner=- blocked=- -->
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

<!-- item: auto-learn-session-settle-scribe state=done owner=- blocked=- -->
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

<!-- item: interrupt-before-output-returns-the state=done owner=- blocked=- -->
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
<!-- item: upstream-pr-review-round-2026-10-23 state=blocked owner=- blocked=upstream -->
## Twelve upstream PR review rounds answered — all rebased on `upstream/main` `0b5c27ab24`, awaiting maintainer review (2026-10-23)

Each branch was rebased, its review threads answered, and the valid findings fixed in the tree.
Branches live on `g` (iacore/oh-my-pi); scratch worktrees under `/var/tmp/omp-pr/` (never `/tmp`,
a 5.8G tmpfs that fills with a dozen `bun install`s).

- #11840 `feat/tool-output-details` `9b64b26d89` — `display.hideToolOutputDetails`.
- #16103 `fix/doas-auth-terminal` `ce28e911db` — auth-terminal routing; the same fix rides `custom` as `0303e0f488`.
- #15460 `autolearn/scribe-upstream` `26ca79e48c` — session-settle scribe.
- #15258 `feat-paste-image-path-attachment` `59f9a15029`.
- #15253 `fix/jit-skill-loading` `6a3496a6e0`.
- #15251 `feat-skill-name-unicode` `129ca87919`.
- #14603 `fix/user-instructions-xml-block` `31d0291ea7`.
- #14419 `fix/focused-agent-esc-interrupt` `6d78740b71` — Esc aborting a delegated `task` run is the maintainer's call.
- #14352 `feat/tan-view-focus` `9ee009edc7`.
- #14271 `fix/model-hub-unavailable-role` `ad8b68bfb1`.
- #14206 `feat/lithosai-provider` `ebe6ea423d` — accepting the provider is the maintainer's call.
- #12695 `fix/btw-panel-top-gap` `1e4ad01b69`.

Open questions left in the threads: the 60 s one-shot settle drain (#15460), whether an explicit
`pty: true` + `async: true` pair should error (#16103), and whether the strip offers a clear for an
unavailable role (#14271). Merge order matters for #16103: it duplicates `custom`'s `0303e0f488`.

<!-- item: omp-desktop-toasts-disabled-for state=done owner=- blocked=- -->
## omp desktop toasts disabled for every future session (2026-10-23)

A toast titled `omp` with body `ping` appeared with no session name and no content, and nothing in
the tree sends `ping` from a production path — the string is the `buildDesktopNotifyCommand` test
fixture in `packages/tui/test/desktop-notify.test.ts`, and every production sender uses
`Complete` / `Waiting for input` / `Terminal protocol test`. Whichever process emitted it, the
pi-tui D-Bus fan-out is now off by default: `PI_NO_DESKTOP_NOTIFY=1` and `PI_NOTIFICATIONS=off`
are set as fish universal variables, in `~/.config/dinit.d/xserver.env`, and in
`~/.config/environment.d/90-no-omp-toasts.conf`. `shouldDeliverDesktopNotification` returns
false under that variable (checked this session). Sessions started before the change keep the old
environment until restarted.

<!-- item: follow-ups-found-in-the-2026-10 state=open owner=- blocked=human -->
## Follow-ups the 2026-10-23 review rounds surfaced but did not take

- #16103: the bash tool still silently drops an explicit `pty: true` on an `async: true` call (`packages/coding-agent/src/tools/bash.ts:1217-1221`); error vs documented no-op is a product call.
- #11840: `Ctrl+H` for the folded view needs the kitty keyboard protocol; a lone multi-target read keeps a joined-paths head.
- #15460: the 60 s one-shot settle drain — setting, shorter budget, or applied to interactive quit as well.
- #14271: the role strip omits an unavailable role's chip; whether it offers an explicit clear is open.
- #14419: whether Esc in a focused view may hard-abort a delegated `task` run, or must be gated.

<!-- item: a-shown-picture-is-a-static-frame state=open owner=- blocked=- -->
## A shown picture is a static frame

A line naming a local image file draws that file, but only its first frame: an animated GIF or
animated WebP shows its poster frame, since `RasterFigure` hands the bytes to `Image`, which places
one graphic. A picture taller than 60% of the viewport is capped to that height, and a block reads
its file once per path — replacing the bytes at the same path does not redraw it in that block.

<!-- item: inline-image-lines-pr-17118 state=blocked owner=- blocked=upstream -->
## Inline image files: upstreamed as PR #17118

The feature landed on `custom` as `d8b88efcf4`. The upstream hand-off is
[can1357/oh-my-pi#17118](https://github.com/can1357/oh-my-pi/pull/17118), branch `feat/inline-image-files`
from `dcafcef642`, two commits (feature + CHANGELOG entry), `MERGEABLE` with checks pending. Ported
cleanly apart from `OPEN.md`, which upstream does not carry and which the PR therefore omits. If the
maintainer asks for a different target syntax or a setting default, the change is `chat/image-source.ts`
(what may lift) and `chat/raster-figure.ts` (how it draws).
