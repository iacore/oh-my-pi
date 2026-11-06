import { describe, expect, it, vi } from "bun:test";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";

function createRuntimeHarness(startAfk = false) {
	let afk = startAfk;
	const setAfkMode = vi.fn(async (enabled: boolean) => {
		afk = enabled;
	});
	const showStatus = vi.fn();
	const showError = vi.fn();
	const setText = vi.fn();

	const session = {
		get afkModeEnabled() {
			return afk;
		},
		setAfkMode,
	};

	const ctx = {
		editor: { setText } as unknown as InteractiveModeContext["editor"],
		session: session as unknown as InteractiveModeContext["session"],
		showStatus,
		showError,
	} as unknown as InteractiveModeContext;

	return { runtime: { ctx }, setAfkMode, showStatus, showError, setText, isAfk: () => afk };
}

describe("/afk slash command", () => {
	it("turns AFK mode on and says so", async () => {
		const harness = createRuntimeHarness(false);

		const handled = await executeBuiltinSlashCommand("/afk", harness.runtime);

		expect(handled).toBe(true);
		expect(harness.setAfkMode).toHaveBeenCalledWith(true);
		expect(harness.showStatus).toHaveBeenCalledWith(
			"AFK on: the ask tool now fails instead of waiting for an answer.",
		);
		expect(harness.showError).not.toHaveBeenCalled();
	});

	it("turns AFK mode back off on a second run", async () => {
		const harness = createRuntimeHarness(false);

		await executeBuiltinSlashCommand("/afk", harness.runtime);
		await executeBuiltinSlashCommand("/afk", harness.runtime);

		expect(harness.isAfk()).toBe(false);
		expect(harness.setAfkMode).toHaveBeenNthCalledWith(1, true);
		expect(harness.setAfkMode).toHaveBeenNthCalledWith(2, false);
		expect(harness.showStatus).toHaveBeenLastCalledWith("AFK off: the ask tool answers again.");
	});
});
