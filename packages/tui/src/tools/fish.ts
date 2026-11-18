/**
 * Fish card for the shell tool.
 *
 * The shell tool has two dialects and one card shape. Everything that makes a
 * command *read* right is the dialect's: fish's prompt glyph, fish's grammar for
 * highlighting, its own node roles, and — the part that is not cosmetic — the
 * `env` argument shown as fish writes it, `set -gx NAME "value"`, instead of the
 * bash assignment prefix that fish would reject at the prompt.
 */

import { type BashRenderArgs, createShellRenderer, type ShellDialect } from "./bash";

export const FISH_DIALECT: ShellDialect = {
	prompt: "❯",
	lang: "fish",
	commandRole: "omp.tool.fish.command",
	outputRole: "omp.tool.fish.output",
	env: "set-gx",
};

/** Renders fish command previews and output: same body as bash, fish's semantics. */
export const fishToolRenderer = createShellRenderer<BashRenderArgs>({
	dialect: FISH_DIALECT,
	resolveTitle: args => (args?.name ? `Fish · ${String(args.name)}` : "Fish"),
	resolveCommand: args => args?.command,
	resolveCwd: args => args?.cwd,
	resolveEnv: args => args?.env,
	showHeader: false,
});
