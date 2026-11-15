/**
 * Routes one shell command to the dedicated tool that replaces it.
 *
 * `bashInterceptor` used to refuse these commands outright: a round trip spent, and a
 * policy line in the transcript that nobody can act on. The same rule match now selects
 * the dedicated tool when — and only when — the mapping reproduces the command exactly.
 * Every other command runs as the shell would have run it, so a miss costs nothing.
 *
 * Invariants:
 * - Only read-only targets (`read`, `grep`, `glob`): a redirected call needs no approval
 *   the enclosing `bash` call did not already carry.
 * - Anything not reproduced byte-for-byte returns `undefined`: compound syntax, pipes,
 *   redirection, expansion, unknown flags, several operands, unterminated quoting.
 * - The caller re-checks registration; this module never invents a tool.
 */
import { readShellWord } from "./shell-tokenize";

/** One dedicated-tool call standing in for a shell command. */
export interface BashRedirectPlan {
	/** Registered tool that replaces the command. */
	tool: "read" | "grep" | "glob";
	/** Arguments for that tool. */
	args: Record<string, unknown>;
	/** Short form of the call, used as the result's provenance line. */
	label: string;
}

/** Tools a redirect may target; read-only, so no separate approval applies. */
const REDIRECT_TOOLS = new Set(["read", "grep", "glob"]);
/**
 * Shell syntax the mapping cannot reproduce: pipes, chaining, backgrounding,
 * redirection, command and parameter expansion, and escapes (a backslash changes how
 * the shell tokenizes the rest of the word).
 */
const SHELL_SYNTAX = /[|&;<>\n\r`$\\]/;
/** `head`/`tail` line-count flags; `cat -n` means number lines, so it is not one. */
const LINE_COUNT_FLAGS = new Set(["-n", "--lines"]);
const DEFAULT_HEAD_LINES = 10;

/**
 * Plan a redirect for `command`, given the tool a `bashInterceptor` rule suggested.
 *
 * @param command Shell command after any leading `cd` hoisting.
 * @param suggestedTool Tool named by the matched rule, if any.
 * @param availableTools Tool names the call may dispatch to.
 */
export function planBashRedirect(
	command: string,
	suggestedTool: string | undefined,
	availableTools: readonly string[],
): BashRedirectPlan | undefined {
	if (suggestedTool === undefined || !REDIRECT_TOOLS.has(suggestedTool)) return undefined;
	if (!availableTools.includes(suggestedTool)) return undefined;
	if (SHELL_SYNTAX.test(command)) return undefined;
	const argv = parseArgv(command);
	if (!argv || argv.length === 0) return undefined;
	switch (suggestedTool) {
		case "read":
			return planRead(argv);
		case "grep":
			return planGrep(argv);
		default:
			return planGlob(argv);
	}
}

/** Split a command into words with shell quote removal; undefined when quoting never closes. */
function parseArgv(command: string): string[] | undefined {
	const argv: string[] = [];
	let rest = command.trim();
	while (rest.length > 0) {
		const word = readShellWord(rest);
		if (word === undefined) break;
		if (word === "unterminated") return undefined;
		argv.push(word.value);
		rest = word.rest;
	}
	return argv;
}

/** Operand shapes the shell expands before the command runs: `~`, and glob characters. */
const SHELL_EXPANDED = /[~*?[{]/;

/** `cat FILE`, `head [-n N] FILE`, `tail [-n N] FILE`, `less FILE`, `more FILE`. */
function planRead(argv: string[]): BashRedirectPlan | undefined {
	const name = argv[0];
	if (name === undefined) return undefined;
	const counts = name === "head" || name === "tail";
	if (!counts && name !== "cat" && name !== "less" && name !== "more") return undefined;
	let count: number | undefined;
	const operands: string[] = [];
	for (let index = 1; index < argv.length; index++) {
		const arg = argv[index];
		if (counts && LINE_COUNT_FLAGS.has(arg)) {
			const value = Number(argv[++index]);
			if (!Number.isInteger(value) || value <= 0) return undefined;
			count = value;
			continue;
		}
		if (counts && /^-\d+$/.test(arg)) {
			count = Number(arg.slice(1));
			continue;
		}
		if (counts && /^--lines=\d+$/.test(arg)) {
			count = Number(arg.slice(8));
			continue;
		}
		if (arg.startsWith("-")) return undefined;
		operands.push(arg);
	}
	if (operands.length !== 1) return undefined;
	const file = operands[0];
	// A `:` in the path would be parsed as a line selector by the `read` tool; `~` and
	// glob characters are expanded by the shell before `cat` sees them.
	if (file.length === 0 || file.includes(":") || SHELL_EXPANDED.test(file)) return undefined;
	const lines = count ?? DEFAULT_HEAD_LINES;
	if (name === "head") {
		return { tool: "read", args: { path: `${file}:1-${lines}` }, label: `read ${file} (lines 1-${lines})` };
	}
	if (name === "tail") {
		return { tool: "read", args: { path: `${file}:-${lines}` }, label: `read ${file} (last ${lines})` };
	}
	return { tool: "read", args: { path: file }, label: `read ${file}` };
}

/** `grep [-inrR] PATTERN [PATH]` and its `rg`/`ag`/`ack` spellings. */
function planGrep(argv: string[]): BashRedirectPlan | undefined {
	const name = argv[0];
	if (name === undefined || !["grep", "rg", "ripgrep", "ag", "ack"].includes(name)) return undefined;
	let ignoreCase = false;
	const positional: string[] = [];
	for (let index = 1; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--") continue;
		if (/^-[A-Za-z]+$/.test(arg)) {
			for (const flag of arg.slice(1)) {
				// `-n`, `-r`, `-R` are already what the `grep` tool does; anything else
				// (`-l`, `-c`, `-o`, `-A`, `-E`, …) has no equivalent argument here.
				if (flag === "i") ignoreCase = true;
				else if (flag !== "n" && flag !== "r" && flag !== "R") return undefined;
			}
			continue;
		}
		if (arg.startsWith("-")) return undefined;
		positional.push(arg);
	}
	if (positional.length < 1 || positional.length > 2) return undefined;
	const [pattern, searchPath] = positional;
	if (pattern.length === 0) return undefined;
	// The shell would expand a `~` or glob path before grep sees it.
	if (searchPath !== undefined && SHELL_EXPANDED.test(searchPath)) return undefined;
	const args: Record<string, unknown> = { pattern };
	if (searchPath !== undefined) args.path = searchPath;
	if (ignoreCase) args.case = false;
	return { tool: "grep", args, label: `grep ${pattern}${searchPath === undefined ? "" : ` ${searchPath}`}` };
}

/** `find PATH -name PATTERN` only; `-iname`, `-type`, `fd` and `locate` differ too much. */
function planGlob(argv: string[]): BashRedirectPlan | undefined {
	if (argv.length !== 4 || argv[0] !== "find" || argv[2] !== "-name") return undefined;
	const [, base, , pattern] = argv;
	if (pattern.length === 0) return undefined;
	// The shell would expand a `~` or glob base before find sees it.
	if (SHELL_EXPANDED.test(base)) return undefined;
	// A bare pattern is already depth-recursive for the `glob` tool.
	const glob = pattern.startsWith("/") || base === "." ? pattern : `${base.replace(/\/+$/, "")}/${pattern}`;
	return { tool: "glob", args: { path: glob }, label: `glob ${glob}` };
}
