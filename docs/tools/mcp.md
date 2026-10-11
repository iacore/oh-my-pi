# mcp

> Enables, disables, and lists MCP (Model Context Protocol) servers for the current session. This is the model-callable counterpart of `/mcp enable` and `/mcp disable`.

## Source
- Entry: `packages/coding-agent/src/tools/mcp.ts`
- Key collaborators:
  - `packages/coding-agent/src/mcp/manager.ts` — owns the connection lifecycle and the session enable override (`enableServerForSession` / `disableServerForSession` / `getSessionEnabledServers`).
  - `packages/coding-agent/src/mcp/config.ts` — `loadAllMCPConfigs({ forceEnable })` revives a server the config disables or the user `disabledServers` list hides.
  - `packages/coding-agent/src/tools/index.ts` — registers the tool and gates it on `session.enableMCP`.
  - `packages/coding-agent/src/modes/controllers/mcp-command-controller.ts` — the `/mcp` command path, which shares the same session override.

## Inputs

The params object is a single action at the top level.

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `action` | `"enable" \| "disable" \| "list"` | Yes | Operation discriminator. |
| `server` | `string` | For `enable` and `disable` | Server name to operate on. |

## Behavior

### `enable`
Connects `server` for the **current session only** and writes no config file. It works for a server the config marks `enabled: false`, a server defined only in a third-party config, and a server the user `disabledServers` list hides. The name joins the manager's session enable set, so a later `/mcp reload` (or any rediscovery) reconnects it. The override is dropped on the next session; it is never persisted.

Returns `Server "<name>" not found.` when no source defines the server, and rolls the name back out of the override set.

### `disable`
Drops `server` from the session enable set and disconnects it. It does not touch any config file; `/mcp disable` (the command) keeps its persistent behaviour.

### `list`
Reports every configured server (config-file entries plus manager-known names, including user-denylisted ones) with `connected` state, a `session only` marker for enable-override servers, and a `disabled in config` marker for entries with `enabled: false`.

## Notes
- The tool is top-level (`loadMode: "essential"`) rather than an `xd://` device, so a model without `xd://` awareness can still call it.
- The tool is unavailable in a session created with MCP disabled (`enableMCP: false`); `execute` throws when no manager is reachable.
- A subagent borrows its parent's manager, so enabling from a child affects the parent session.
- Approval tier is `exec`: an stdio server spawns a process and a remote server makes network requests.