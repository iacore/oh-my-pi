import { afterEach, describe, expect, it } from "bun:test";
import {
	authProbeArgv,
	authPromptRequired,
	bashNeedsAuthTerminal,
	canUseInteractiveBashPty,
} from "@oh-my-pi/pi-coding-agent/tools/bash-pty-selection";

const originalPlatform = process.platform;
const originalNoPty = Bun.env.PI_NO_PTY;

function setPlatform(platform: NodeJS.Platform): void {
	Object.defineProperty(process, "platform", {
		value: platform,
		configurable: true,
		writable: true,
	});
}

function restorePlatform(): void {
	Object.defineProperty(process, "platform", {
		value: originalPlatform,
		configurable: true,
		writable: true,
	});
}

function setNoPty(value: string | undefined): void {
	if (value === undefined) {
		delete Bun.env.PI_NO_PTY;
		return;
	}
	Bun.env.PI_NO_PTY = value;
}

function interactiveContext() {
	return { hasUI: true, ui: {} };
}

describe("bash PTY selection", () => {
	afterEach(() => {
		restorePlatform();
		setNoPty(originalNoPty);
	});

	it("allows interactive PTY on Windows when requested with UI", () => {
		setPlatform("win32");
		setNoPty(undefined);

		expect(canUseInteractiveBashPty(true, interactiveContext())).toBe(true);
	});

	it("allows interactive PTY on non-Windows when requested with UI and not disabled", () => {
		setPlatform("linux");
		setNoPty(undefined);

		expect(canUseInteractiveBashPty(true, interactiveContext())).toBe(true);
		expect(canUseInteractiveBashPty(false, interactiveContext())).toBe(false);
		expect(canUseInteractiveBashPty(true, undefined)).toBe(false);

		setNoPty("1");
		expect(canUseInteractiveBashPty(true, interactiveContext())).toBe(false);
	});
});

describe("bash terminal auth detection", () => {
	it("detects the password-reading commands at any command position", () => {
		expect(bashNeedsAuthTerminal("doas true")).toBe(true);
		expect(bashNeedsAuthTerminal("sudo systemctl restart nginx")).toBe(true);
		expect(bashNeedsAuthTerminal("/usr/bin/doas pacman -Syu")).toBe(true);
		expect(bashNeedsAuthTerminal("PATH=/usr/bin doas true")).toBe(true);
		expect(bashNeedsAuthTerminal("echo hi && doas dinitctl restart x")).toBe(true);
		expect(bashNeedsAuthTerminal("cat foo | doas tee /etc/hosts")).toBe(true);
		expect(bashNeedsAuthTerminal("doas -u root true")).toBe(true);
	});

	it("ignores the command name outside a command position", () => {
		expect(bashNeedsAuthTerminal("echo doas")).toBe(false);
		expect(bashNeedsAuthTerminal("rg -n 'doas|sudo' src")).toBe(false);
		expect(bashNeedsAuthTerminal("true")).toBe(false);
		expect(bashNeedsAuthTerminal("sudoedit /etc/doas.conf")).toBe(false);
	});

	it("ignores a call that already says it will not prompt", () => {
		expect(bashNeedsAuthTerminal("sudo -n true")).toBe(false);
		expect(bashNeedsAuthTerminal("doas --non-interactive true")).toBe(false);
		expect(bashNeedsAuthTerminal("doas -n ls")).toBe(false);
		// Only the auth command's own options count: a `-n` in the wrapped
		// command's arguments says nothing about how the password is read.
		expect(bashNeedsAuthTerminal("doas printf -- -n")).toBe(true);
	});
});

describe("auth probe", () => {
	it("probes the auth command with its non-prompting flag and a throwaway command", () => {
		expect(authProbeArgv("doas pacman -Syu")).toEqual(["doas", "-n", "true"]);
		expect(authProbeArgv("/usr/bin/doas pacman -Syu")).toEqual(["/usr/bin/doas", "-n", "true"]);
		expect(authProbeArgv("echo hi && doas dinitctl restart x")).toEqual(["doas", "-n", "true"]);
		// The wrapped command is left out: the auth command answers first.
		expect(authProbeArgv("doas rm -rf /")).toEqual(["doas", "-n", "true"]);
	});

	it("has nothing to probe when no auth command runs", () => {
		expect(authProbeArgv("echo doas")).toBeUndefined();
		expect(authProbeArgv("sudo -n true")).toBeUndefined();
		expect(authProbeArgv("true")).toBeUndefined();
	});

	it("keeps the terminal when the auth command says it must prompt", async () => {
		const probes: string[][] = [];
		const asked = await authPromptRequired("doas pacman -Syu", {
			run: async argv => {
				probes.push([...argv]);
				return 1;
			},
		});

		expect(asked).toBe(true);
		expect(probes).toEqual([["doas", "-n", "true"]]);
	});

	it("skips the terminal when a cached credential or a nopass rule answers", async () => {
		const asked = await authPromptRequired("doas pacman -Syu", { run: async () => 0 });
		expect(asked).toBe(false);
	});

	it("keeps the terminal when the probe could not run at all", async () => {
		const asked = await authPromptRequired("doas pacman -Syu", { run: async () => undefined });
		expect(asked).toBe(true);
	});

	it("runs no probe when the command asks for no password", async () => {
		let runs = 0;
		const asked = await authPromptRequired("sudo -n true", {
			run: async () => {
				runs++;
				return 0;
			},
		});

		expect(asked).toBe(false);
		expect(runs).toBe(0);
	});
});
