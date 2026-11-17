import { describe, expect, it } from "bun:test";
import { executeBash } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import { resolveFishShell } from "@oh-my-pi/pi-coding-agent/tools/fish";

const fish = resolveFishShell();

describe.skipIf(fish === undefined)("fish shell override", () => {
	it("runs the command line through fish, not the embedded bash engine", async () => {
		if (!fish) throw new Error("unreachable");
		const result = await executeBash("set -gx OMP_FISH_PROBE 41; echo (math $OMP_FISH_PROBE + 1)", {
			shellOverride: fish,
			minimize: false,
			timeout: 30_000,
		});
		expect(result.exitCode).toBe(0);
		expect(result.output.trim()).toBe("42");
	});

	it("surfaces fish's own rejection of a bash-only form", async () => {
		if (!fish) throw new Error("unreachable");
		const result = await executeBash("echo $?", { shellOverride: fish, minimize: false, timeout: 30_000 });
		expect(result.exitCode).not.toBe(0);
		expect(result.output).toContain("not the exit status");
	});

	it("resolves one cached fish config whose argv is `-c`", () => {
		expect(resolveFishShell()).toBe(fish);
		expect(fish?.args).toEqual(["-c"]);
	});
});
