import { beforeAll, describe, expect, it, vi } from "bun:test";
import type { AgentToolContext } from "@oh-my-pi/pi-agent-core";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AskTool, type ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { ToolError } from "@oh-my-pi/pi-tui/tools/tool-errors";
import { initTheme } from "@oh-my-pi/pi-tui/theme";

beforeAll(async () => {
	await initTheme(false);
});

function createSession(afk: (() => boolean) | undefined): ToolSession {
	return {
		cwd: "/tmp/test",
		hasUI: true,
		canPromptUser: true,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
		...(afk ? { afkModeEnabled: afk } : {}),
	};
}

const html = `<form>
  <label>Which database? <select name="q1"><option value="sqlite" selected>SQLite</option><option value="redis">Redis</option></select></label>
</form>`;

function createContext(select: () => Promise<string | undefined>): AgentToolContext {
	return {
		hasUI: true,
		ui: { select, editor: async () => undefined },
		abort: () => {},
	} as unknown as AgentToolContext;
}

describe("ask tool in AFK mode", () => {
	it("fails fast instead of opening a dialog", async () => {
		const select = vi.fn(async () => "SQLite");
		const tool = new AskTool(createSession(() => true));

		await expect(
			tool.execute("call-afk", { html }, undefined, undefined, createContext(select)),
		).rejects.toBeInstanceOf(ToolError);
		expect(select).not.toHaveBeenCalled();
	});

	it("asks normally once AFK mode is off", async () => {
		let afk = false;
		const select = vi.fn(async () => "SQLite");
		const tool = new AskTool(createSession(() => afk));

		afk = false;
		await tool.execute("call-back", { html }, undefined, undefined, createContext(select));
		expect(select).toHaveBeenCalledTimes(1);

		afk = true;
		await expect(
			tool.execute("call-away", { html }, undefined, undefined, createContext(select)),
		).rejects.toBeInstanceOf(ToolError);
		expect(select).toHaveBeenCalledTimes(1);
	});
});
