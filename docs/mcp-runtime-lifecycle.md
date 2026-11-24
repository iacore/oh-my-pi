# MCP runtime lifecycle

How MCP servers are discovered, hosted, shared between sessions, exposed as tools, and stopped.

## Lifecycle at a glance

1. **Discovery** (`loadAllMCPConfigs`) resolves server configs from capability sources and filters disabled, project-level, Exa and browser entries.
2. **Connect** (`MCPManager.connectServers`): for each server the session resolves credentials, asks the **MCP host** for the server's protocol era, attaches a tunnel to the server's host unit, and reads `server/discover` and `tools/list` over it.
3. **Host** (`src/mcp/host/`, served by the daemon's `mcp` module or in-process): owns every server process and remote connection. It answers discovery and list requests from a shared store and starts a server only when a request needs it.
4. **Startup window**: `connectServers` waits up to `mcp.startupTimeoutMs` (250 ms). Servers that answered contribute tools; the rest are merged when they are ready.
5. **Live session**: list changes arrive as notifications on the tunnel; `/mcp reload` rediscovers; `/mcp reconnect <name>` restarts one server.
6. **Teardown**: closing a link releases the session's lease on the unit. Units and processes nobody holds are stopped by the host.

A session never spawns an MCP server, opens an HTTP connection to one, or performs an `initialize` handshake. It speaks MCP 2026-07-28 to the host and nothing else.

## Session side

### Discovery and startup

`createAgentSession()` (`src/sdk.ts`) starts MCP when `enableMCP` is true and tool names are not restricted. A supplied `mcpManager` is reused without discovery. Otherwise:

- **Headless/SDK**: awaits `discoverAndLoadMCPTools()`. Print mode then waits for every configured server to list tools or fail before its first prompt, bounded by `OMP_MCP_TIMEOUT_MS` (default 30 s; `0` waits indefinitely); `OMP_MCP_REQUIRE_READY=1` exits 1 instead of warning.
- **Interactive** (`hasUI: true`): constructs `MCPManager` at once and runs `discoverAndConnect()` in the background. The first turn waits up to 1.5 s for it.

Sessions that bind process state hold `holdSharedMcp(mcp.shared)` for their lifetime; that hold decides whether links attach to the daemon or to the in-process host. With no hold (embedders, tests, `omp read`) the in-process host is used.

Discovery failures are isolated: a config discovery exception yields an empty tool set and one synthetic `.mcp.json` error; a failing server yields an entry in the `errors` map while the others continue.

### Discovery filters

`loadAllMCPConfigs` drops or suppresses entries before they reach the manager, and applies the session overrides at the same step:

- `enableProjectConfig: false` removes project-level entries (`_source.level === "project"`).
- `enabled: false` entries are suppressed unless the active-profile user `enabledServers` allowlist names them; the user `disabledServers` denylist always suppresses a same-named entry.
- Exa servers are filtered out by default and API keys are extracted for native Exa tool integration, unless the config explicitly requests Exa tools the native integration does not provide (`web_fetch_exa`, `web_search_advanced_exa`); browser automation MCP servers are filtered when `filterBrowser` is true.
- The session's `forceEnable` / `forceDisable` sets (`/mcp enable|disable`, the `mcp` tool) override both suppression reasons for the current session; see [Session-scoped overrides](#session-scoped-overrides).

### Connect pipeline

For each server, `connectServers()`:

1. validates the config (`validateServerConfig`),
2. resolves OAuth credentials and `!command`/environment values (`#resolveAuthConfig`),
3. builds an `McpServerSpec` (`buildServerSpec`): absolute cwd, declared env, complete spawn environment, or URL and final headers,
4. `connectToServer()`: creates a `HostLink`, which resolves the server's era, attaches to its unit and sends its roots; then `server/discover` gives capabilities, server info and instructions,
5. `listTools()`, then resources, templates and prompts in the background,
6. opens one list-change subscription; resource subscriptions are opened when `mcp.notifications` is on.

Discovery and list requests carry the `stale-ok` hint, so a server the host already knows answers within the startup window without a process. A stale entry is served at once and revalidated by the host; a difference arrives as a list-change notification. A server the host has never seen is probed first, which takes as long as the server takes to start.

There are no deferred or cached tool handles in the session: a server that has not answered by the end of the startup window contributes nothing until it does, and then registers through the manager's tools-changed callback.

### Manager state

`MCPManager` keeps connections, pending connects, tools in stable name order, source metadata, unresolved configs (so reconnect can re-resolve credentials), listeners, per-session tool scopes, tracked resource subscriptions, and the latest upstream status per server. Each manager owns one instance id, sent with every attach; it identifies the manager's private unit for handshake-era servers.

`getConnectionStatus(name)` reports `connected` once discovery and `tools/list` succeeded on the link's current attachment, `connecting` during a connect, reconnect or re-attach, and `disconnected` otherwise; `waitForStartup` and print-mode readiness use the same test, so a server whose reload failed is not counted as ready even though its previous tools stay registered. `getServerRuntime(name)` returns the host's view (`McpUpstreamStatus`): era, `idle`/`starting`/`running`/`failed`, pid, how many sessions are attached, and the last exit. `/mcp list` shows it.

### Session-scoped overrides

`MCPManager` keeps `#sessionForceEnable: Set<string>` / `#sessionForceDisable: Set<string>` — names connected or suppressed for this session only (`/mcp enable|disable`, the `mcp` tool). Both are passed to every `loadAllMCPConfigs` call as `forceEnable` / `forceDisable`, so an override survives rediscovery: `forceDisable` suppresses a name first, and `forceEnable` then bypasses the remaining suppression reasons and reports the name with `enabled: true`. Neither is persisted.

### Tool exposure and naming

`discoverAndLoadMCPTools()` converts manager tools into `LoadedCustomTool[]` and decorates paths (`mcp:<server> via <providerName>` when known).

`createAgentSession()` then pushes these tools into `customTools`, which are wrapped and added to the runtime tool registry with names like `mcp__<server>_<tool>`.

Server and tool name components are lowercased and sanitized to letters, digits, and underscores; repeated/edge underscores are collapsed/trimmed, and a redundant server prefix on the tool is stripped. Names longer than 64 characters are capped with a deterministic hash suffix. If two distinct origins mint the same runtime name, OMP logs the collision and keeps a deterministic winner based on the original server/tool identity, so reconnect ordering cannot change ownership.

Connected manager tools become enabled immediately. Presentation is reconciled with the session's current tool policy. Registry identity and original server/tool ownership remain intact regardless of presentation.

### Tool calls

`MCPTool` calls through the connection's link. Deadlines, progress-based deadline extension and abort live in the link; on abort or deadline it sends `notifications/cancelled`. A failure the host marks retryable (the request never reached the server) is retried once after a reconnect; a request that may have reached the server is never replayed. A tool-result auth challenge can trigger the auth handler and one retry.

### Reconnect

There is no reconnect ladder, crash breaker or background retry schedule in the session; restarting servers is the host's job.

- `reconnectServer(name, { manual })` re-resolves credentials. If they changed, the link retargets to the new identity. A manual reconnect (`/mcp reconnect`) additionally sends `omp/restart`, which stops the upstream and clears the host's crash guard; automatic recovery never restarts an upstream, because a modern one is shared with other sessions. Then discovery and catalogs are reloaded.
- If the tunnel is lost (daemon restart), the link fails its in-flight requests as non-retryable, re-attaches, re-sends its roots, and the manager re-opens subscriptions and reloads catalogs.
- A 401/403 from a remote server, including one from the first era probe, calls the manager's refresh hook once; fresh headers retarget the link and the request is retried once. Resource subscriptions of the old identity are not replayed; the manager re-derives them from the reloaded catalog.
- A handshake-era HTTP server that expired its session answers 404: the host retires that session and the retried call opens a new one.
- `/mcp test`, the OAuth discovery probe and other one-off connections pass `live: true`, which sends the `no-store` hint so every answer comes from the server, not the store.

### Notifications

The manager refreshes tools, resources or prompts on the corresponding list-change notification, forwards `notifications/resources/updated` for subscribed URIs, and fans every notification out to listeners (`addNotificationListener`), buffering up to 100 until the first listener attaches.

### Reload and cwd changes

`/mcp reload` runs `disconnectAll()`, clears prompt commands, rediscovers and rebinds tools. A working-directory change calls `setCwd()`, which re-points project config discovery, re-sends roots on every link and reconnects, since a stdio server's identity includes its working directory.

## Host side

### Units and eras

One host unit (`McpEndpoint`) is one upstream server. How it is shared follows the protocol era of the server, which the host probes once and records:

- **Modern** (answers `server/discover`): stateless by specification. One unit per identity serves every session, multiplexing their requests onto one process or origin.
- **Handshake-era** (needs `initialize`; includes `sse`): the server holds a session. Each manager gets its own unit, keyed by its instance id, and the host's legacy adapter holds the `initialize` session and presents it as a modern endpoint.

Identity (`mcpIdentity`): for stdio the command, arguments, working directory, declared `env`, and every inherited variable whose name looks like a credential or account selector; for remote servers the URL and all headers. A refreshed token is therefore another unit.

### What a unit does

- **Multiplexing**: request ids, progress tokens and subscription ids are isolated per link; a link's `_meta` (revision, capabilities, client info) reaches the server unchanged.
- **Store**: results of `server/discover`, the four list methods and `resources/read` are kept in a sqlite store shared by all units, honouring `ttlMs` and `cacheScope`. Handshake-era results, which declare no TTL, are kept for 30 days and reconciled whenever the server runs.
- **Lazy start**: opening a unit starts nothing. The upstream starts on the first request the store cannot answer.
- **Freshness**: after every start, on `stale-ok` hits past their TTL, and on upstream list-change notifications the host refetches and notifies every session subscribed to that list.
- **Subscriptions**: the unit holds one upstream list-change subscription while the server runs and fans it out; list-change subscriptions of sessions never start a server. Resource subscriptions are forwarded and keep the server running.
- **Crash guard**: after 5 failed starts or unexpected exits within 30 s the unit refuses to start for 30 s and fails requests with the last error; `omp/restart` clears it.

### Lifetime and garbage collection

| Resource | Ends when |
| --- | --- |
| A session's lease on a unit | its link closes, or the session process dies (leases are bound to the daemon connection) |
| A unit | nothing holds a lease for `mcp.idleStopMinutes` (modern) or at once (handshake-era); daemon shutdown |
| A modern server process | its unit stops, or it had no request in flight and no resource subscription for `mcp.idleStopMinutes`; the next request starts it again |
| A handshake-era server process | its unit stops, i.e. its manager disconnected or died; or it has only served lists and reads so far (no session state yet) and sat idle for `mcp.idleStopMinutes` |
| An upstream request | it is answered, or its link cancels or disconnects |
| A probe process | always, before the probe returns |
| Stored results | replaced on refetch, invalidated on list change, dropped after 30 days unread |

Subprocess units survive a daemon re-exec with their pipes; sessions re-attach afterwards.

### Where the host runs

`mcpHostAccess()` picks the daemon's `mcp` module when sharing is held on and the daemon advertises the module; otherwise, or on any error, the in-process host (`LocalMcpHost`) runs the same units inside the session, shared only between managers of that process and stopped with their last lease.

## Failure modes

| Scenario | Behavior |
| --- | --- |
| Config discovery throws | empty tool set plus a synthetic `.mcp.json` error; the session starts |
| Invalid server config | that server is skipped with a validation error |
| Server cannot start or connect | error recorded for that server; status `failed` with exit code and stderr tail; others continue |
| Server slower than the startup window | no tools at startup; they register when it answers |
| Server exits with requests in flight | those requests fail (non-retryable) with exit code and stderr; the next request starts a new process |
| Server crashes repeatedly | crash guard: requests fail immediately for 30 s; `/mcp reconnect` clears it |
| Daemon restarts | links re-attach; in-flight requests fail and are not replayed |
| Daemon unreachable | the in-process host is used |
| Owning session disposed | its manager disconnects (bounded to 3 s); leases drop and the host collects what is unused |

## Implementation files

- [`src/mcp/manager.ts`](../packages/coding-agent/src/mcp/manager.ts) — connect flow, catalogs, tool scopes, reconnect, status.
- [`src/mcp/client.ts`](../packages/coding-agent/src/mcp/client.ts) — MCP 2026-07-28 operations: discover, lists, calls with input rounds, subscriptions.
- [`src/mcp/link.ts`](../packages/coding-agent/src/mcp/link.ts) — `HostLink`: tunnel, deadlines, cancellation, re-attach, auth retarget.
- [`src/mcp/protocol.ts`](../packages/coding-agent/src/mcp/protocol.ts) — revision constants, `_meta` keys, result types.
- [`src/mcp/host/contract.ts`](../packages/coding-agent/src/mcp/host/contract.ts) — server spec, identity, unit key and policy, tunnel extensions, host errors.
- [`src/mcp/host/endpoint.ts`](../packages/coding-agent/src/mcp/host/endpoint.ts) — the unit: multiplexing, store, lazy start, crash guard, subscriptions.
- [`src/mcp/host/peers.ts`](../packages/coding-agent/src/mcp/host/peers.ts) — modern peer, legacy adapter, era probe.
- [`src/mcp/host/store.ts`](../packages/coding-agent/src/mcp/host/store.ts) — era records and cached results.
- [`src/mcp/host/local.ts`](../packages/coding-agent/src/mcp/host/local.ts), [`access.ts`](../packages/coding-agent/src/mcp/host/access.ts) — in-process host and host selection.
- [`src/daemon/modules/mcp.ts`](../packages/coding-agent/src/daemon/modules/mcp.ts) — the daemon module.
- [`src/mcp/tool-bridge.ts`](../packages/coding-agent/src/mcp/tool-bridge.ts) — `MCPTool`.
- [`src/mcp/loader.ts`](../packages/coding-agent/src/mcp/loader.ts), [`src/sdk.ts`](../packages/coding-agent/src/sdk.ts) — startup wiring.
