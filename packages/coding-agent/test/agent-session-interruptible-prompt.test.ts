import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { createInMemoryAuthStorage, createAssistantMessage } from "./helpers/agent-session-setup";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

/**
 * `getInterruptiblePrompt()` is what the TUI hands back to the composer when
 * Escape stops a turn: the operator's own words, kept for exactly the turn's
 * lifetime. A regression here is silent — the composer simply comes back
 * empty, and the user retypes the prompt.
 */
describe("AgentSession.getInterruptiblePrompt", () => {
	it("holds the typed prompt while the turn runs and drops it once the turn settles", async () => {
		using tempDir = TempDir.createSync("@pi-interruptible-prompt-");
		const authStorage = createInMemoryAuthStorage();
		const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled Anthropic test model to exist");
		authStorage.keys.setRuntime(model.provider, "test-key");

		// The turn is held open by the test so the mid-turn state is observable:
		// `release()` ends it.
		let release: (() => void) | undefined;
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: () => {
				const stream = new AssistantMessageEventStream();
				const message: AssistantMessage = createAssistantMessage("done");
				release = () => {
					stream.push({ type: "text_delta", contentIndex: 0, delta: "done", partial: message });
					stream.push({ type: "done", reason: "stop", message });
				};
				return stream;
			},
		});
		// The settings write host prefs into the process's shared Settings singleton.
		const settings = Settings.isolated({
			"compaction.enabled": false,
			"autolearn.enabled": false,
			"composer.predictions": false,
		});
		settings.setModelRole("default", `${model.provider}/${model.id}`);
		const session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings,
			modelRegistry,
		});
		try {
			expect(session.getInterruptiblePrompt()).toBeUndefined();

			const turn = session.prompt("fix the failing test");
			// Setup (usage preflight, key resolution) is async; the prompt is
			// recorded at dispatch, right before the model is called.
			for (let attempt = 0; attempt < 200 && release === undefined; attempt++) await Bun.sleep(5);
			expect(release).toBeDefined();
			expect(session.getInterruptiblePrompt()).toEqual({ text: "fix the failing test", images: undefined });

			release?.();
			await turn;
			expect(session.getInterruptiblePrompt()).toBeUndefined();
		} finally {
			await session.dispose();
			authStorage.close();
		}
	});
});
