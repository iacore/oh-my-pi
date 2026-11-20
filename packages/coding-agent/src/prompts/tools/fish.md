Fish shell: every call runs as `fish -c '<command>'` in `{{shellPath}}`, a fresh non-interactive fish (no prompt or job control) that reads the user's fish configuration — `config.fish`, `conf.d/`, and autoloaded `functions/` — so their functions, aliases, and PATH are in scope. Call configured functions by name instead of re-implementing them. Nothing carries over between calls: set variables again and change directory with the `cwd` field, not `cd`.
One command/pipeline per call; join dependencies with `&&` (or `and`). Fish supports `&&`, `||`, `and`, `or`, and `not`.
{{#if hasEval}}Use `eval` for scripts, heredocs, or complex pipelines. Fish has no heredocs; write text with `printf '%s\n' … | cmd`.{{else}}Use a dedicated tool or checked-in script for scripts, heredocs, or complex flow. Fish has no heredocs; write text with `printf '%s\n' … | cmd`.{{/if}}
Fish syntax, never bash's:
- Exit status: `$status`; per-stage pipeline codes: `$pipestatus`; arguments: `$argv`. `$?` does not exist.
- Set variables with `set`: `set -l name value` is local, `-g` global, `-x` exported. `VAR=value cmd` works as a per-call override, but prefer the `env` field. `set -e name` *erases* the variable — it is not bash's `set -e`.
- Command substitution is `(cmd)` or `$(cmd)`; backticks are ordinary characters, not substitution. A backslash before one is kept even in double quotes, so never escape a backtick when quoting text: the backslash lands in the value (a `gh --body` payload reaches the API with literal backslashes). It splits only on newlines, not `$IFS`; use `string split` for further splitting or `string collect` to keep the value whole.
- Variables undergo no word splitting: `$var` stays one value however many spaces it holds, so double quotes group text rather than prevent splitting. `''` expands nothing, `""` expands variables; escapes such as `\n` apply only when unquoted; there is no `$'…'`.
- Test with `test …` (`if test -f $p; …; end`), never `[[ ]]`. Use `for x in a b c; …; end`, `while`, `switch`, and `begin; …; end` to group.
- `( … )` is command substitution, never a subshell; group commands with `begin`/`end`.
- Use the `string` builtin for string work (`string match`, `string replace`, `string sub`) and `math` for arithmetic; bash's `${x%y}`, `${x#y}`, `$((…))` have no equivalent.
- Globs expand in arguments; `**` recurses and `{a,b}` lists alternatives.

Use `cwd`, not `cd`; use `pty` only for interactive calls. `doas`/`sudo` handle their password prompts on the terminal without `pty`; the user answers there, and the command never contains the password.
Builtins/coreutils, redirects, and globs accept internal URIs as paths.
Don't truncate output by habit; the result is summarized and saved as an artifact.
{{#if hasLaunch}}
Long-lived services:
- Use a unique name; ready requires name; no async/timeout; pty defaults to true.
- ready needs a log regex or port (both if given); host defaults to 127.0.0.1 and ready.timeout to 30s.
{{/if}}
{{#if asyncEnabled}}
`async` defers finite results but preserves the deadline (default {{defaultTimeoutSec}}s); use `timeout: 0` for watchers and long jobs.
{{/if}}
{{#if autoBackgroundEnabled}}
Non-`pty` calls still running after {{autoBackgroundSeconds}}s (or 1s before `timeout`, if sooner) usually move to background job `bg_N` and run until `timeout`.
No backgrounding when the client terminal runs the command or the job cap is reached.
The result arrives automatically as a follow-up message. NEVER poll.
{{/if}}
