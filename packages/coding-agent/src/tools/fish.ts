/**
 * Fish Tool - the shell tool with fish as its command language.
 *
 * Every call is parsed by the host's fish (`fish -c '<command>'`), spawned by
 * the embedded shell. Fish loads its own startup files on every start —
 * `config.fish`, `conf.d/*.fish` and the autoloaded `functions/` — so the
 * user's functions, aliases and PATH are the ones an interactive fish sees,
 * while the command itself runs non-interactively (no prompt, no job control).
 *
 * Nothing about the command line is translated. A bash line that fish rejects
 * (`$?`, `VAR=value cmd`, `[[ ]]`) fails with fish's own error, which is what
 * the prompt tells the model to avoid.
 */

import { getShellConfig, type ShellConfig } from "@oh-my-pi/pi-utils/procmgr";
import fishDescription from "../prompts/tools/fish.md" with { type: "text" };
import { BashTool } from "./bash";
import type { ToolSession } from ".";

let cachedFishShell: ShellConfig | null | undefined;

/**
 * The fish shell config every call runs in, or undefined when this host has no
 * `fish` on PATH. Cached: the binary's spawn env is built once per process.
 */
export function resolveFishShell(): ShellConfig | undefined {
	if (cachedFishShell !== undefined) return cachedFishShell ?? undefined;
	const fish = Bun.which("fish");
	// `-c` only: fish still loads config.fish, conf.d and functions for it, while
	// an interactive flag would engage the prompt and job control that a
	// non-TTY run cannot use (fish warns about zle when it does).
	cachedFishShell = fish ? { ...getShellConfig(fish), args: ["-c"] } : null;
	return cachedFishShell ?? undefined;
}

/**
 * The `fish` tool, or null when this host has no fish on PATH. A BashTool in
 * its fish dialect rather than a subclass: `bash.ts` reaches this module's
 * barrel through `../cursor`, so subclassing would put the class above
 * `BashTool`'s initialization whenever a consumer imports `tools/bash` first.
 */
export function createFishTool(session: ToolSession): BashTool | null {
	const shell = resolveFishShell();
	if (!shell) return null;
	return new BashTool(session, {
		name: "fish",
		label: "Fish",
		shell,
		description: fishDescription,
		descriptionContext: () => ({ shellPath: shell.shell }),
	});
}
