import { type } from "@oh-my-pi/omptype";
import type { AgentTool, AgentToolResult } from "@oh-my-pi/pi-agent-core";
import { getMCPConfigPath } from "@oh-my-pi/pi-utils";
import { readMCPConfigFile } from "../mcp/config-writer";
import { MCPManager } from "../mcp/manager";
import type { ToolSession } from ".";

const mcpSchema = type({
	action: type("'enable' | 'disable' | 'list'").describe(
		"enable: connect a server for this session; disable: disconnect it; list: show servers.",
	),
	"server?": type("string").describe("Server name. Required for enable and disable."),
});

type McpParams = typeof mcpSchema.infer;

export interface McpToolDetails {
	action: McpParams["action"];
	server?: string;
	connected?: boolean;
	servers?: Array<{
		name: string;
		connected: boolean;
		enabledInConfig: boolean;
		sessionOnly: boolean;
		sessionDisabled: boolean;
	}>;
}

const DESCRIPTION = [
	"Enable or disable MCP (Model Context Protocol) servers for the current session, or list them.",
	"Neither action writes a config file. `enable` connects a server whose config entry is `enabled: false` or whose name the user `disabledServers` list hides; `disable` disconnects a server the config enables. Both last only for this session (surviving `/mcp reload`) and revert on the next session.",
	"`list` reports each configured server, whether it is connected, and whether a session override is in effect.",
].join("\n");

/** Model-callable counterpart of `/mcp enable|disable`: session-scoped, never persisted. */
export class McpTool implements AgentTool<typeof mcpSchema, McpToolDetails> {
	readonly name = "mcp";
	readonly label = "MCP";
	readonly summary = "Enable or disable MCP servers for this session";
	readonly description = DESCRIPTION;
	readonly parameters = mcpSchema;
	readonly strict = true;
	// Top-level, not a discoverable `xd://` device: a model that has no notion
	// of the `xd://` protocol (see issue #5973) must still be able to enable a
	// server, so the schema stays in the request rather than behind dispatch.
	readonly loadMode = "essential" as const;
	// Enabling an stdio server spawns its process and remote servers make
	// network calls, so the call carries exec-tier approval like bash.
	readonly approval = "exec" as const;
	readonly intent = "omit" as const;

	constructor(private session: ToolSession) {}

	async execute(_toolCallId: string, params: McpParams): Promise<AgentToolResult<McpToolDetails>> {
		const manager = this.session.mcpManager ?? MCPManager.instance();
		if (!manager) {
			throw new Error("MCP is unavailable in this session.");
		}

		if (params.action === "list") {
			const servers = await this.#configuredServers(manager);
			return {
				content: [
					{
						type: "text",
						text:
							servers.length === 0
								? "No MCP servers configured."
								: servers
										.map(
											s =>
												`${s.name}: ${s.connected ? "connected" : "not connected"}${
													s.sessionDisabled
														? " (disabled for this session)"
														: s.sessionOnly
															? " (session only)"
															: s.enabledInConfig
																? ""
																: " (disabled in config)"
												}`,
										)
										.join("\n"),
					},
				],
				details: { action: "list", servers },
			};
		}

		const name = params.server?.trim();
		if (!name) {
			throw new Error(`Server name required for '${params.action}'.`);
		}

		if (params.action === "enable") {
			const result = await manager.enableServerForSession(name);
			if (!result) {
				throw new Error(`Server "${name}" not found.`);
			}
			const connected = manager.getConnectionStatus(name) === "connected";
			const failure = result.errors.get(name);
			return {
				content: [
					{
						type: "text",
						text: failure
							? `Enabled "${name}" for this session, but connecting failed: ${failure}`
							: `Enabled "${name}" for this session${connected ? "" : " (still connecting)"}.`,
					},
				],
				details: { action: "enable", server: name, connected },
			};
		}

		const configured = await this.#configuredServers(manager);
		if (!configured.some(server => server.name === name)) {
			throw new Error(`Server "${name}" not found.`);
		}
		await manager.disableServerForSession(name);
		return {
			content: [{ type: "text", text: `Disabled "${name}" for this session.` }],
			details: { action: "disable", server: name, connected: false },
		};
	}

	/**
	 * Union of the config-file servers (which include entries the manager never
	 * loaded because they are disabled) and the manager's own known names.
	 */
	async #configuredServers(manager: MCPManager): Promise<NonNullable<McpToolDetails["servers"]>> {
		const [userConfig, projectConfig] = await Promise.all([
			readMCPConfigFile(getMCPConfigPath("user", this.session.cwd)),
			readMCPConfigFile(getMCPConfigPath("project", this.session.cwd)),
		]);
		const enabledInConfig = new Set<string>();
		const names = new Set<string>(manager.getAllServerNames());
		for (const [name, config] of Object.entries({
			...projectConfig.mcpServers,
			...userConfig.mcpServers,
		})) {
			names.add(name);
			if (config?.enabled !== false) enabledInConfig.add(name);
		}
		for (const name of userConfig.disabledServers ?? []) names.add(name);
		const sessionOnly = manager.getSessionEnabledServers();
		const sessionDisabled = manager.getSessionDisabledServers();
		return [...names]
			.sort((a, b) => a.localeCompare(b))
			.map(name => ({
				name,
				connected: manager.getConnectionStatus(name) === "connected",
				enabledInConfig: enabledInConfig.has(name),
				sessionOnly: sessionOnly.has(name),
				sessionDisabled: sessionDisabled.has(name),
			}));
	}
}
