import { $env } from "@oh-my-pi/pi-utils/env";
import { tokenizeShellSegments } from "./shell-tokenize";

/** Minimal UI-capability fields needed to decide whether bash can use the local PTY overlay. */
export interface BashPtyContext {
	hasUI?: boolean;
	ui?: unknown;
}

/** Return whether a bash tool call should use the local interactive PTY overlay. */
export function canUseInteractiveBashPty(pty: boolean, ctx: BashPtyContext | undefined): boolean {
	if (!pty) return false;
	if ($env.PI_NO_PTY === "1") return false;
	return ctx?.hasUI === true && ctx.ui !== undefined;
}

/**
 * Commands that read a privileged password from the controlling terminal:
 * `doas` and `sudo` open `/dev/tty` themselves and never read the password from
 * stdin, so without a PTY they die with `Authentication failed` instead of
 * prompting.
 */
const TTY_AUTH_COMMANDS = new Set(["doas", "sudo"]);

/**
 * Options that already say where the answer comes from — `-n` (fail rather than
 * prompt), `-A` (askpass helper), `-S` (read the password from stdin). A caller
 * that passed one did not ask for a prompt, so no terminal is allocated.
 */
const NON_PROMPT_OPTIONS = new Set(["-n", "--non-interactive", "-A", "--askpass", "-S", "--stdin"]);

/** A leading `NAME=value` assignment, which prefixes a command word without being it. */
const SHELL_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/u;

/**
 * Return whether the command needs a controlling terminal for a password
 * prompt, so the bash tool can route it through the interactive PTY (or the
 * client terminal bridge) the way an explicit `pty` request is routed.
 *
 * Any command position counts — `echo hi && doas pacman -S x` needs the
 * terminal as much as a bare `doas` — and a command word named by path
 * (`/usr/bin/doas`) is the same command.
 */
export function bashNeedsAuthTerminal(command: string): boolean {
	for (const segment of tokenizeShellSegments(command)) {
		if (authCommandWord(segment) !== undefined) return true;
	}
	return false;
}

/**
 * The auth command word this segment runs (`doas`, `/usr/bin/sudo`), when the
 * segment runs one and its own options leave the prompt possible.
 */
function authCommandWord(segment: string[]): string | undefined {
	const commandIndex = segment.findIndex(token => !SHELL_ASSIGNMENT.test(token));
	if (commandIndex === -1) return undefined;
	const word = segment[commandIndex];
	if (!TTY_AUTH_COMMANDS.has(word.slice(word.lastIndexOf("/") + 1))) return undefined;
	// Only the auth command's own leading options decide; a `-n` in the wrapped
	// command's arguments says nothing about how the password is read.
	for (let i = commandIndex + 1; i < segment.length; i++) {
		const token = segment[i];
		if (token === "--") break;
		if (!token.startsWith("-") || token === "-") break;
		if (NON_PROMPT_OPTIONS.has(token)) return undefined;
	}
	return word;
}

/**
 * The argv that asks an auth command whether it would prompt: the command word
 * with `-n`, which makes it fail instead of reading a password, and a
 * throwaway `true` so the probe cannot run the wrapped command. The wrapped
 * command is left out on purpose — `doas` and `sudo` answer from the persisted
 * credential or a passwordless rule before they look at it.
 */
export function authProbeArgv(command: string): string[] | undefined {
	for (const segment of tokenizeShellSegments(command)) {
		const word = authCommandWord(segment);
		if (word !== undefined) return [word, "-n", "true"];
	}
	return undefined;
}

/** Exit status of a probe run, or undefined when the probe could not be started at all. */
export type AuthProbeOutcome = number | undefined;

/** Runs one probe argv; tests pass their own so no process is spawned. */
export type AuthProbeRunner = (
	argv: readonly string[],
	options: { cwd: string | undefined; env: Record<string, string> | undefined },
) => Promise<AuthProbeOutcome>;

export interface AuthProbeOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** Replaces the spawn the probe runs through. */
	run?: AuthProbeRunner;
}

/** Longest a probe may run before it is killed and read as "a password is asked". */
const AUTH_PROBE_TIMEOUT_MS = 2_000;

/**
 * Whether the command really has to be asked for a password. `doas` and `sudo`
 * take the answer from a persisted credential or a passwordless rule without
 * touching the terminal, and the plain executor runs those commands exactly as
 * well — so the interactive terminal, and the prompt the user has to answer in
 * it, is only worth opening for a call the auth command says will prompt.
 *
 * Anything but a clean exit — a prompt needed, a spawn failure, a kill — keeps
 * the terminal: reading a real prompt as "no prompt" leaves the command
 * unauthenticated, while the reverse only opens a card for nothing.
 */
export async function authPromptRequired(command: string, options: AuthProbeOptions = {}): Promise<boolean> {
	const argv = authProbeArgv(command);
	if (argv === undefined) return false;
	const exitCode = await (options.run ?? runAuthProbe)(argv, { cwd: options.cwd, env: options.env });
	return exitCode !== 0;
}

const runAuthProbe: AuthProbeRunner = async (argv, options) => {
	try {
		const child = Bun.spawn(argv as string[], {
			cwd: options.cwd,
			env: options.env,
			stdin: "ignore",
			stdout: "ignore",
			stderr: "ignore",
		});
		const timer = setTimeout(() => child.kill(), AUTH_PROBE_TIMEOUT_MS);
		try {
			return await child.exited;
		} finally {
			clearTimeout(timer);
		}
	} catch {
		return undefined;
	}
};
