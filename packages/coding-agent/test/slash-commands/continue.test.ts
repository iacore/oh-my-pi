import { describe, expect, it, vi } from "bun:test";
import type { AssistantMessage, ImageContent, Model, UserMessage } from "@oh-my-pi/pi-ai";
import { InputController } from "@oh-my-pi/pi-coding-agent/modes/controllers/input-controller";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent/session/messages";
import {
	ACP_BUILTIN_SLASH_COMMANDS,
	executeAcpBuiltinSlashCommand,
} from "@oh-my-pi/pi-coding-agent/slash-commands/acp-builtins";
import { BUILTIN_LIFECYCLE_SLASH_COMMANDS } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-lifecycle";
import { executeBuiltinSlashCommand } from "@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry";
import type { SlashCommandRuntime } from "@oh-my-pi/pi-coding-agent/slash-commands/types";

const model = { api: "mock", provider: "mock", id: "mock-model" } as unknown as Model;

const EMPTY_PROMPT_COPY = "Continue: nothing interrupted — sends an empty prompt";

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function userMessage(text: string): UserMessage {
	return { role: "user", content: text, timestamp: Date.now() };
}

function assistant(stopReason: AssistantMessage["stopReason"], additions?: Partial<AssistantMessage>) {
	return {
		role: "assistant",
		content: [{ type: "text", text: "partial" }],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason,
		timestamp: Date.now(),
		...additions,
	} as AssistantMessage;
}

function createTuiRuntime(options: { isStreaming?: boolean; resumed?: boolean; messages?: unknown[] }) {
	const continueInterrupted = vi.fn(() => options.resumed ?? false);
	const setText = vi.fn();
	const showError = vi.fn();
	const showStatus = vi.fn();
	return {
		continueInterrupted,
		setText,
		showError,
		showStatus,
		runtime: {
			ctx: {
				session: {
					isStreaming: options.isStreaming ?? false,
					continueInterrupted,
					messages: options.messages ?? [],
				} as unknown as InteractiveModeContext["session"],
				// `/continue` has no `handleTui`, so the TUI dispatcher adapts `handle`
				// into a `SlashCommandRuntime`, which reads these off the context.
				sessionManager: { getCwd: () => "/tmp" } as unknown as InteractiveModeContext["sessionManager"],
				settings: {} as unknown as InteractiveModeContext["settings"],
				editor: { setText } as unknown as InteractiveModeContext["editor"],
				showError,
				showStatus,
			} as unknown as InteractiveModeContext,
		},
	};
}

describe("/continue slash command (TUI)", () => {
	it("hands the dispatcher an empty prompt when the last turn is complete", async () => {
		const harness = createTuiRuntime({ resumed: false, messages: [userMessage("hi"), assistant("stop")] });

		const handled = await executeBuiltinSlashCommand("/continue", harness.runtime);

		// A returned string is the dispatcher's "send this as the prompt" contract;
		// empty means the model is asked to keep going from the settled tail.
		expect(handled).toBe("");
		expect(harness.continueInterrupted).toHaveBeenCalledTimes(1);
		expect(harness.showError).not.toHaveBeenCalled();
		expect(harness.showStatus).not.toHaveBeenCalled();
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("resumes an interrupted turn without sending a prompt", async () => {
		const harness = createTuiRuntime({ resumed: true });

		const handled = await executeBuiltinSlashCommand("/continue", harness.runtime);

		expect(handled).toBe(true);
		expect(harness.continueInterrupted).toHaveBeenCalledTimes(1);
		expect(harness.showError).not.toHaveBeenCalled();
		expect(harness.showStatus).toHaveBeenCalledWith("Continuing the interrupted turn.");
		expect(harness.setText).toHaveBeenCalledWith("");
	});

	it("reports the busy state instead of prompting while streaming", async () => {
		const harness = createTuiRuntime({ isStreaming: true });

		await executeBuiltinSlashCommand("/continue", harness.runtime);

		expect(harness.continueInterrupted).not.toHaveBeenCalled();
		expect((harness.showStatus.mock.calls[0]?.[0] as string) ?? "").toContain("before continuing");
	});

	it("describes resumability from the live transcript", () => {
		const spec = BUILTIN_LIFECYCLE_SLASH_COMMANDS.find(c => c.name === "continue");
		if (!spec?.getTuiAutocompleteDescription) throw new Error("/continue has no autocomplete description");

		const settled = createTuiRuntime({ messages: [userMessage("hi"), assistant("stop")] });
		const interrupted = createTuiRuntime({
			messages: [userMessage("hi"), assistant("aborted", { errorMessage: USER_INTERRUPT_LABEL })],
		});

		expect(spec.getTuiAutocompleteDescription(settled.runtime)).toBe(EMPTY_PROMPT_COPY);
		expect(spec.getTuiAutocompleteDescription(interrupted.runtime)).toBe("Continue: resumable interrupted turn");
	});
});

function acpRuntime({ isStreaming = false, resumed = false }: { isStreaming?: boolean; resumed?: boolean }) {
	const continueInterrupted = vi.fn(() => resumed);
	const keepTurnOpenUntilIdle = vi.fn(async () => {});
	const output = vi.fn();
	return {
		continueInterrupted,
		keepTurnOpenUntilIdle,
		output,
		runtime: {
			session: { isStreaming, continueInterrupted },
			output,
			keepTurnOpenUntilIdle,
		} as unknown as SlashCommandRuntime,
	};
}

describe("/continue dispatch (ACP)", () => {
	it("refuses to continue while streaming", async () => {
		const h = acpRuntime({ isStreaming: true });

		const result = await executeAcpBuiltinSlashCommand("/continue", h.runtime);

		expect(h.continueInterrupted).not.toHaveBeenCalled();
		expect((h.output.mock.calls[0]?.[0] as string) ?? "").toContain("before continuing");
		expect(result).toEqual({ consumed: true });
	});

	it("requests an empty prompt, keeping its ACP turn open, when there is nothing to continue", async () => {
		const h = acpRuntime({ resumed: false });

		const result = await executeAcpBuiltinSlashCommand("/continue", h.runtime);

		expect(result).toEqual({ prompt: "" });
		expect(h.output).not.toHaveBeenCalled();
		expect(h.keepTurnOpenUntilIdle).not.toHaveBeenCalled();
	});

	it("announces the continuation and holds the ACP turn open", async () => {
		const h = acpRuntime({ resumed: true });

		const result = await executeAcpBuiltinSlashCommand("/continue", h.runtime);

		expect(h.output).toHaveBeenCalledWith("Continuing the interrupted turn.");
		expect(h.keepTurnOpenUntilIdle).toHaveBeenCalledTimes(1);
		expect(result).toEqual({ consumed: true, agentInvoked: true });
	});

	it("is advertised to ACP clients", () => {
		expect(ACP_BUILTIN_SLASH_COMMANDS.find(c => c.name === "continue")).toBeDefined();
	});
});

// Drives the real editor submit handler through the real builtin dispatch: the
// empty-prompt fallback must survive the TUI hop, not just the dispatcher's
// return value.
function createInteractiveHarness(continueInterrupted: () => boolean) {
	let text = "";
	const addToHistory = vi.fn();
	const onInputCallback = vi.fn();
	const editor = {
		onSubmit: undefined as undefined | ((t: string) => Promise<void>),
		getText: () => text,
		setText: (next: string) => {
			text = next;
		},
		setCollapsedText: (next: string) => {
			text = next;
		},
		composerChips: () => [],
		addToHistory,
		pendingImages: [] as ImageContent[],
		pendingImageLinks: [] as (string | undefined)[],
		imageLinks: undefined as (string | undefined)[] | undefined,
		clearDraft(historyText?: string) {
			if (historyText !== undefined) addToHistory(historyText);
			text = "";
			this.imageLinks = undefined;
			this.pendingImages = [];
			this.pendingImageLinks = [];
		},
	};
	const ctx = {
		editor,
		session: {
			isStreaming: false,
			isCompacting: false,
			queuedMessageCount: 0,
			extensionRunner: undefined,
			customCommands: [],
			promptTemplates: [],
			messages: [],
			continueInterrupted,
			maybeStartTitleGeneration: vi.fn(),
		},
		sessionManager: { getCwd: () => "/tmp" },
		settings: {},
		focusedAgentId: undefined,
		collabGuest: undefined,
		showStatus: vi.fn(),
		showError: vi.fn(),
		onInputCallback,
		startPendingSubmission: (input: { text: string; streamingBehavior?: "steer" | "followUp" }) => ({
			...input,
			cancelled: false,
			started: false,
		}),
		ui: { requestRender: vi.fn() },
		compactionQueuedMessages: [],
		skillCommands: new Map(),
		fileSlashCommands: new Set<string>(),
		withLocalSubmission: async (_text: string, fn: () => Promise<unknown>) => fn(),
		updatePendingMessagesDisplay: vi.fn(),
		showWarning: vi.fn(),
		flushPendingBashComponents: vi.fn(),
	} as unknown as InteractiveModeContext;
	return { ctx, editor, addToHistory, onInputCallback };
}

describe("/continue in the interactive submit path", () => {
	it("submits an empty prompt when nothing is interrupted", async () => {
		const harness = createInteractiveHarness(() => false);
		new InputController(harness.ctx).setupEditorSubmitHandler();

		await harness.editor.onSubmit?.("/continue");

		expect(harness.onInputCallback).toHaveBeenCalledTimes(1);
		expect(harness.onInputCallback.mock.calls[0]?.[0]).toMatchObject({ text: "", cancelled: false });
		expect(harness.addToHistory).toHaveBeenCalledWith("/continue");
	});

	it("submits nothing when the interrupted turn was resumed", async () => {
		const harness = createInteractiveHarness(() => true);
		new InputController(harness.ctx).setupEditorSubmitHandler();

		await harness.editor.onSubmit?.("/continue");

		expect(harness.onInputCallback).not.toHaveBeenCalled();
		expect(harness.addToHistory).toHaveBeenCalledWith("/continue");
	});
});
