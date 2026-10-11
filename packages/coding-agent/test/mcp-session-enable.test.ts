import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { MCPManager } from "@oh-my-pi/pi-coding-agent/mcp/manager";
import type { MCPServerConfig, MCPStdioServerConfig } from "@oh-my-pi/pi-coding-agent/mcp/types";

const FIXTURE_PATH = path.join(import.meta.dir, "fixtures", "delayed-tool-mcp.ts");

const CONFIG: MCPStdioServerConfig = {
	type: "stdio",
	command: process.execPath,
	args: [FIXTURE_PATH],
};

/**
 * A loader that exposes `delayed` only when the session force-enable set names
 * it — the same shape config discovery produces for an `enabled: false` server.
 */
function createManager(): MCPManager {
	return new MCPManager(process.cwd(), null, async (_cwd, options) => {
		const configs: Record<string, MCPServerConfig> = {};
		if (options?.forceEnable?.has("delayed")) configs.delayed = CONFIG;
		return { configs, sources: {}, exaApiKeys: [] };
	});
}

/** A loader where `delayed` is enabled in config unless the session suppresses it. */
function createEnabledManager(seen: Array<ReadonlySet<string> | undefined> = []): MCPManager {
	return new MCPManager(process.cwd(), null, async (_cwd, options) => {
		seen.push(options?.forceDisable);
		const configs: Record<string, MCPServerConfig> = {};
		if (!options?.forceDisable?.has("delayed")) configs.delayed = CONFIG;
		return { configs, sources: {}, exaApiKeys: [] };
	});
}

describe("MCPManager session enable", () => {
	it("connects a server the config disables, without any discovery pass", async () => {
		const manager = createManager();
		try {
			expect(manager.getSessionEnabledServers().size).toBe(0);

			const result = await manager.enableServerForSession("delayed");

			expect(result).toBeDefined();
			expect(manager.getSessionEnabledServers().has("delayed")).toBe(true);
			await manager.waitForConnection("delayed");
			expect(manager.getConnectedServers()).toContain("delayed");
		} finally {
			await manager.disconnectAll();
		}
	});

	it("keeps the session server across rediscovery", async () => {
		const manager = createManager();
		try {
			await manager.enableServerForSession("delayed");
			await manager.discoverAndConnect();

			await manager.waitForConnection("delayed");
			expect(manager.getConnectedServers()).toContain("delayed");
		} finally {
			await manager.disconnectAll();
		}
	});

	it("rolls back an unknown name instead of remembering it", async () => {
		const manager = createManager();
		try {
			expect(await manager.enableServerForSession("missing")).toBeUndefined();
			expect(manager.getSessionEnabledServers().has("missing")).toBe(false);
		} finally {
			await manager.disconnectAll();
		}
	});

	it("disableServerForSession drops the override and the connection", async () => {
		const manager = createManager();
		try {
			await manager.enableServerForSession("delayed");
			await manager.disableServerForSession("delayed");

			expect(manager.getSessionEnabledServers().has("delayed")).toBe(false);
			expect(manager.getSessionDisabledServers().has("delayed")).toBe(true);
			expect(manager.getConnectionStatus("delayed")).toBe("disconnected");
		} finally {
			await manager.disconnectAll();
		}
	});

	it("suppresses a config-enabled server across rediscovery", async () => {
		const seen: Array<ReadonlySet<string> | undefined> = [];
		const manager = createEnabledManager(seen);
		try {
			await manager.discoverAndConnect();
			await manager.waitForConnection("delayed");
			expect(manager.getConnectedServers()).toContain("delayed");

			await manager.disableServerForSession("delayed");
			expect(manager.getConnectedServers()).not.toContain("delayed");

			seen.length = 0;
			await manager.discoverAndConnect();
			// Rediscovery was told to suppress it, so it never reconnects.
			expect(seen.at(-1)?.has("delayed")).toBe(true);
			expect(manager.getConnectedServers()).not.toContain("delayed");
		} finally {
			await manager.disconnectAll();
		}
	});

	it("enableServerForSession clears a session disable", async () => {
		const manager = createEnabledManager();
		try {
			await manager.disableServerForSession("delayed");
			await manager.enableServerForSession("delayed");

			expect(manager.getSessionDisabledServers().has("delayed")).toBe(false);
			expect(manager.getSessionEnabledServers().has("delayed")).toBe(true);
			await manager.waitForConnection("delayed");
			expect(manager.getConnectedServers()).toContain("delayed");
		} finally {
			await manager.disconnectAll();
		}
	});
});
