#!/usr/bin/env bun
/**
 * `bun setup` entrypoint. Chains the setup steps (install → native addon
 * build → omp link). The native host build uses the local Cargo/N-API backend
 * by default; set `OMP_NATIVE_BUILD_BACKEND=bazel` to opt into bazel. Flags
 * after `--` are appended to the native build invocation.
 *
 * There is deliberately no `bun --cwd=packages/coding-agent link` step: its
 * only artifact is a bun-shebang `omp` in Bun's global bin, which the launcher
 * step exists to replace and delete. Running it mid-setup installed that
 * preload-buggy launcher for the rest of the run and relied on the launcher
 * step staying last to clean it up.
 *
 * On Windows the final `link omp` step runs natively in this file instead of
 * spawning `sh` (issue #12483): same target check, same global-bin lookup
 * order, symlink with copy fallback, and the same `OMP_BIN_DIR` override.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
const repoRoot = path.join(import.meta.dir, "..");

const argv = process.argv.slice(2);
const passthrough: string[] = [];
for (let i = 0; i < argv.length; i++) {
	const arg = argv[i];
	if (arg === "--") {
		passthrough.push(...argv.slice(i + 1));
		break;
	}
	passthrough.push(arg);
}

interface Step {
	label: string;
	cmd: string[];
	cwd?: string;
}

/**
 * Native equivalent of `scripts/link-omp.sh` for Windows, where `sh` is
 * unavailable (issue #12483). Same semantics: verify the wrapper target,
 * resolve the install dir (`OMP_BIN_DIR` when set, otherwise Bun's global bin
 * dir from `bun pm -g bin` / `${BUN_INSTALL:-$HOME/.bun}/bin`), link `omp`
 * there — symlink first, plain copy as a fallback when links need privileges
 * the user lacks — and remove a stale Bun-bin entry when the wrapper lives
 * elsewhere. Returns a process-like exit code for the shared runner below.
 */
function linkOmpWindows(repoRoot: string): number {
	const target = path.join(repoRoot, "packages", "coding-agent", "scripts", "omp");
	try {
		fs.accessSync(target, fs.constants.F_OK);
	} catch {
		console.error(`link-omp: target wrapper not found: ${target}`);
		return 1;
	}
	// Bun's global bin is the fallback install dir, but an explicit OMP_BIN_DIR
	// overrides it — the same escape hatch `scripts/link-omp.sh` gives POSIX
	// hosts. Unlike POSIX the default stays Bun's bin: `$HOME/.local/bin` is not
	// conventionally on the Windows PATH, so defaulting there would strand the
	// launcher.
	let bunBin = "";
	try {
		const out = Bun.spawnSync(["bun", "pm", "-g", "bin"], { stdout: "pipe", stderr: "ignore" });
		if (out.exitCode === 0) bunBin = Buffer.from(out.stdout).toString().trim();
	} catch {
		// fall through to the default below
	}
	if (!bunBin) bunBin = path.join(process.env.BUN_INSTALL ?? path.join(os.homedir(), ".bun"), "bin");
	const binDir = process.env.OMP_BIN_DIR || bunBin;
	const linkPath = path.join(binDir, "omp");
	try {
		fs.mkdirSync(binDir, { recursive: true });
		try {
			fs.unlinkSync(linkPath);
		} catch {
			// nothing to replace
		}
		fs.symlinkSync(target, linkPath, "file");
		console.log(`link-omp: linked ${linkPath} -> ${target}`);
	} catch (error) {
		console.error(`link-omp: symlink failed (${error}), falling back to copy`);
		try {
			fs.copyFileSync(target, linkPath);
			console.log(`link-omp: copied ${target} -> ${linkPath}`);
		} catch (copyError) {
			console.error(`link-omp: copy failed: ${copyError}`);
			return 1;
		}
	}
	// Mirror `scripts/link-omp.sh`: a bun-shebang entry left in Bun's global bin
	// shadows the wrapper wherever Bun's bin precedes the install dir on PATH, so
	// drop it once the wrapper lives elsewhere.
	if (binDir !== bunBin) {
		const stale = path.join(bunBin, "omp");
		try {
			const current = fs.readlinkSync(stale);
			if (path.resolve(bunBin, current) !== target) {
				fs.unlinkSync(stale);
				console.log(`link-omp: removed the bun-bin entry ${stale}`);
			}
		} catch {
			// absent, or not a symlink this linker owns
		}
	}
	return 0;
}

const steps: Step[] = [
	{ label: "bun install", cmd: ["bun", "install"] },
	{ label: "build:native", cmd: ["bun", "run", "build:native", ...passthrough] },
	{ label: "link omp", cmd: ["sh", "scripts/link-omp.sh"] },
];

for (const step of steps) {
	console.log(`\n▶ ${step.label}`);
	if (step.label === "link omp" && process.platform === "win32") {
		const exitCode = linkOmpWindows(repoRoot);
		if (exitCode !== 0) {
			console.error(`\nsetup step "${step.label}" failed (exit ${exitCode})`);
			process.exit(exitCode);
		}
		continue;
	}
	const proc = Bun.spawn(step.cmd, {
		cwd: step.cwd ?? repoRoot,
		env: process.env,
		stdout: "inherit",
		stderr: "inherit",
	});
	const exitCode = await proc.exited;
	if (exitCode !== 0) {
		console.error(`\nsetup step "${step.label}" failed (exit ${exitCode})`);
		process.exit(exitCode || 1);
	}
}
