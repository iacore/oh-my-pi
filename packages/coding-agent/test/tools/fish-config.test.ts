import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ShellConfig } from "@oh-my-pi/pi-utils/procmgr";
import { executeBash } from "@oh-my-pi/pi-coding-agent/exec/bash-executor";
import { resolveFishShell } from "@oh-my-pi/pi-coding-agent/tools/fish";

const fish = resolveFishShell();

describe.skipIf(fish === undefined)("fish startup files", () => {
	it("loads the user's config.fish, conf.d and functions for a -c call", async () => {
		if (!fish) throw new Error("unreachable");
		const home = fs.mkdtempSync(path.join(os.tmpdir(), "omp-fish-home-"));
		const configDir = path.join(home, "fish");
		try {
			fs.mkdirSync(path.join(configDir, "conf.d"), { recursive: true });
			fs.mkdirSync(path.join(configDir, "functions"), { recursive: true });
			fs.writeFileSync(path.join(configDir, "config.fish"), "set -gx OMP_FISH_FROM_CONFIG yes\n");
			fs.writeFileSync(path.join(configDir, "conf.d", "omp.fish"), "set -gx OMP_FISH_FROM_CONFD yes\n");
			fs.writeFileSync(
				path.join(configDir, "functions", "omp_probe.fish"),
				"function omp_probe\n  echo config-function-ran\nend\n",
			);

			const shellOverride: ShellConfig = {
				shell: fish.shell,
				args: ["-c"],
				env: { ...fish.env, HOME: home, XDG_CONFIG_HOME: home },
				prefix: "",
			};
			const result = await executeBash("echo $OMP_FISH_FROM_CONFIG; echo $OMP_FISH_FROM_CONFD; omp_probe", {
				shellOverride,
				minimize: false,
				timeout: 30_000,
			});
			expect(result.exitCode).toBe(0);
			expect(result.output).toContain("config-function-ran");
			expect(result.output.match(/yes/g)).toHaveLength(2);
		} finally {
			fs.rmSync(home, { recursive: true, force: true });
		}
	});
});
