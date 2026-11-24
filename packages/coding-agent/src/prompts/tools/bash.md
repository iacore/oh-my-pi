Persistent bash 5.3.
Each call starts in the session cwd with `set -e` off; use `cwd`, not `cd`{{#if hasPty}}; `pty` = interactive{{/if}}.
One fact command/pipeline per call; dependencies use `&&`.
{{#if hasEval}}Scripts/heredocs/`$(...)`/complex pipelines → `eval`.{{else}}Scripts/heredocs/`$(...)`/complex flow → dedicated tool or checked-in script.{{/if}}
`doas`/`sudo` get the terminal for their password prompt on their own — `pty` is not needed for them, the user answers the prompt there, and the password is never passed in the command.
Internal URIs work as paths for builtins/coreutils, redirects, globs.
In-process builtins, ahead of PATH: {{join builtins ", "}}.
{{#if asyncEnabled}}
`async` defers finite results but keeps the deadline (default {{defaultTimeoutSec}}s); `timeout: 0` for watchers and long jobs.
`notify` (regex; implies `async`) sends each matching output line as a follow-up while the job runs, ahead of its result. Match only lines you'd act on: too many matches switch it off.
{{/if}}
Don't trunc output by habit, result will be summarized and saved as an artifact.
{{#if hasLaunch}}
Long-lived services:
- unique name; ready requires name; no async/timeout; pty defaults true.
- ready needs log regex or port (both if given); host defaults localhost, ready.timeout 30s.
- `notify` (regex) sends each matching output line as a follow-up while the service runs.
{{/if}}
{{#if autoBackgroundEnabled}}
Non-`pty` calls still running after {{autoBackgroundSeconds}}s (or 1s before `timeout`, if sooner) usually move to background job `bg_N` and keep running to `timeout`.
No backgrounding when the client terminal runs the command or the job cap is reached.
The result arrives automatically as a follow-up message. NEVER poll.
{{/if}}
