Fish shell: every call runs as `fish -c '<command>'` in `{{shellPath}}`, a fresh non-interactive fish (no prompt, no job control) that sources the user's own fish config — `config.fish`, `conf.d/` and autoloaded `functions/` — so their functions, aliases and PATH are in scope: call a configured function by name instead of re-implementing it in the command line. Nothing carries over between calls: set variables again, and move directories with the `cwd` field instead of `cd`.
One fact command/pipeline; dependencies use `&&`.
{{#if hasEval}}Scripts/heredocs/`$(...)`/complex pipelines → `eval`.{{else}}Scripts/heredocs/`$(...)`/complex flow → dedicated tool or checked-in script.{{/if}}
Fish syntax, never bash: exit status is `$status` (never `$?`), assignment is `set -gx VAR value` (never `VAR=value cmd`), command substitution is `(cmd)` (never `$(cmd)`), conditionals are `test …` with `and`/`or` (never `[[ ]]`), and a loop body is `for x in …; …; end`.
`cwd`, not `cd`; `pty` only interactive. `doas`/`sudo` get the terminal for their password prompt on their own — `pty` is not needed for them, the user answers the prompt there, and the password is never passed in the command.
Internal URIs work as paths for builtins/coreutils, redirects, globs.
Don't trunc output by habit, result will be summarized and saved as an artifact.
{{#if hasLaunch}}
Long-lived services:

- unique name; ready requires name; no async/timeout; pty defaults true.
- ready needs log regex or port (both if given); host defaults 127.0.0.1, ready.timeout 30s.
  {{/if}}
  {{#if asyncEnabled}}
  `async` defers finite results but keeps the deadline (default {{defaultTimeoutSec}}s); `timeout: 0` for watchers and long jobs.
  {{/if}}
  {{#if autoBackgroundEnabled}}
  Non-`pty` calls still running after {{autoBackgroundSeconds}}s (or 1s before `timeout`, if sooner) usually move to background job `bg_N` and keep running to `timeout`.
  No backgrounding when the client terminal runs the command or the job cap is reached.
  The result arrives automatically as a follow-up message. NEVER poll.
  {{/if}}
