import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { readMCPConfigFile } from "@oh-my-pi/pi-coding-agent/mcp/config-writer";
import type { MCPServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";
import { MCPCommandController } from "@oh-my-pi/pi-coding-agent/modes/controllers/mcp-command-controller";
import { initTheme } from "@oh-my-pi/pi-tui/theme";
import {
	getConfigRootDir,
	getMCPConfigPath,
	getProjectDir,
	removeWithRetries,
	setAgentDir,
	setProjectDir,
} from "@oh-my-pi/pi-utils";
import {
	createInteractiveModeContext,
	createMcpManagerStub,
	type McpManagerOverrides,
} from "./helpers/interactive-mode-context";

const originalProjectDir = getProjectDir();
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const fallbackAgentDir = path.join(getConfigRootDir(), "agent");

function restoreAgentDir(): void {
	if (originalAgentDir) {
		setAgentDir(originalAgentDir);
		process.env.PI_CODING_AGENT_DIR = originalAgentDir;
		Bun.env.PI_CODING_AGENT_DIR = originalAgentDir;
		return;
	}
	setAgentDir(fallbackAgentDir);
	delete process.env.PI_CODING_AGENT_DIR;
	delete Bun.env.PI_CODING_AGENT_DIR;
}

function createController(overrides: McpManagerOverrides = {}) {
	const refreshMCPTools = vi.fn(async () => {});
	const mcpManager = createMcpManagerStub(overrides);
	const ctx = createInteractiveModeContext({
		session: { refreshMCPTools },
		mcpManager,
	});
	const controller = new MCPCommandController(ctx);

	return { controller, ctx, mcpManager, refreshMCPTools };
}

async function writeProjectConfig(projectDir: string, servers: Record<string, MCPServerConfig>): Promise<void> {
	await Bun.write(
		getMCPConfigPath("project", projectDir),
		`${JSON.stringify(
			{
				mcpServers: servers,
			},
			null,
			2,
		)}\n`,
	);
}

function readProjectConfig(projectDir: string): Promise<{ mcpServers?: Record<string, MCPServerConfig> }> {
	return readMCPConfigFile(getMCPConfigPath("project", projectDir)) as Promise<{
		mcpServers?: Record<string, MCPServerConfig>;
	}>;
}

describe("/mcp enable and disable", () => {
	let projectDir = "";
	let agentDir = "";

	beforeAll(() => {
		initTheme();
	});

	beforeEach(async () => {
		projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-toggle-project-"));
		agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-mcp-toggle-agent-"));
		setProjectDir(projectDir);
		setAgentDir(agentDir);
	});

	afterEach(async () => {
		vi.restoreAllMocks();
		setProjectDir(originalProjectDir);
		restoreAgentDir();
		await removeWithRetries(projectDir);
		await removeWithRetries(agentDir);
	});

	test("enable connects a config-disabled server for this session only, leaving the file untouched", async () => {
		await writeProjectConfig(projectDir, {
			mcp1: { type: "stdio", command: "mcp-one", enabled: false },
		});
		const { controller, mcpManager } = createController();

		await controller.handle("/mcp enable mcp1");

		expect(mcpManager.enableServerForSession).toHaveBeenCalledWith("mcp1");
		expect(mcpManager.discoverAndConnect).not.toHaveBeenCalled();
		// The session override must not be persisted: the file still disables it.
		expect((await readProjectConfig(projectDir)).mcpServers?.mcp1).toEqual({
			type: "stdio",
			command: "mcp-one",
			enabled: false,
		});
	});

	test("enable reports a server no source defines as not found", async () => {
		const enableServerForSession = vi.fn(async (_name: string) => undefined);
		const { controller, ctx } = createController({ enableServerForSession });

		await controller.handle("/mcp enable nope");

		expect(enableServerForSession).toHaveBeenCalledWith("nope");
		expect(ctx.showError).toHaveBeenCalledWith('Server "nope" not found.');
	});

	test("disable disconnects for this session only, leaving the file untouched", async () => {
		await writeProjectConfig(projectDir, {
			mcp1: { type: "stdio", command: "mcp-one" },
			mcp2: { type: "stdio", command: "mcp-two" },
		});
		const { controller, mcpManager, refreshMCPTools } = createController();

		await controller.handle("/mcp disable mcp1");

		expect(mcpManager.disableServerForSession).toHaveBeenCalledWith("mcp1");
		expect(refreshMCPTools).toHaveBeenCalledWith([]);
		expect(mcpManager.disconnectAll).not.toHaveBeenCalled();
		expect(mcpManager.discoverAndConnect).not.toHaveBeenCalled();
		expect(mcpManager.enableServerForSession).not.toHaveBeenCalled();
		const servers = (await readProjectConfig(projectDir)).mcpServers;
		expect(servers?.mcp1).toEqual({ type: "stdio", command: "mcp-one" });
		expect(servers?.mcp2).toEqual({ type: "stdio", command: "mcp-two" });
	});

	test("disable reports a server no source defines as not found", async () => {
		const { controller, ctx, mcpManager } = createController();

		await controller.handle("/mcp disable nope");

		expect(ctx.showError).toHaveBeenCalledWith('Server "nope" not found.');
		expect(mcpManager.disableServerForSession).not.toHaveBeenCalled();
	});

	test("disable undoes a session-only enable of a config-disabled server", async () => {
		await writeProjectConfig(projectDir, {
			mcp1: { type: "stdio", command: "mcp-one", enabled: false },
		});
		const { controller, mcpManager } = createController({
			getSessionEnabledServers: vi.fn(() => new Set(["mcp1"])),
		});

		await controller.handle("/mcp disable mcp1");

		// It was connected only through the session override, so it disconnects
		// rather than reporting "already disabled".
		expect(mcpManager.disableServerForSession).toHaveBeenCalledWith("mcp1");
		expect((await readProjectConfig(projectDir)).mcpServers?.mcp1).toEqual({
			type: "stdio",
			command: "mcp-one",
			enabled: false,
		});
	});
});
