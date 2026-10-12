/**
 * An interrupt that lands before the model emits anything leaves the user prompt
 * unanswered: an empty aborted assistant turn is the only thing after it, and a
 * later prompt would replay an orphan user turn. Interactive mode puts such a
 * prompt back in the editor, which needs the session to hand it over
 * (`setPromptDropped`) and to drop both messages — from the live context and from
 * the persisted branch. Internal aborts must leave the transcript alone, since
 * their host has no editor to restore into.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { createMockModel, type MockResponse } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { USER_INTERRUPT_LABEL } from "@oh-my-pi/pi-coding-agent/session/messages";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { withTimeout } from "@oh-my-pi/pi-utils";

describe("AgentSession interrupt before any output", () => {
	let session: AgentSession | undefined;
	let authStorage: AuthStorage | undefined;

	afterEach(async () => {
		await session?.dispose();
		authStorage?.close();
	});

	/** A session whose first (and only) turn hangs until the test releases it. */
	async function createHangingTurnSession() {
		authStorage = await AuthStorage.create(":memory:");
		authStorage.keys.setRuntime("anthropic", "test-key");
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected claude-sonnet-4-5 model to exist");
		const model: Model = bundled;
		const turnStarted = Promise.withResolvers<void>();
		const releaseTurn = Promise.withResolvers<void>();
		const mock = createMockModel({
			responses: [
				async (): Promise<MockResponse> => {
					turnStarted.resolve();
					await releaseTurn.promise;
					return { content: ["late output"] };
				},
			],
		});
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [] },
			streamFn: mock.stream,
		});
		session = new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "todo.enabled": false }),
			modelRegistry: new ModelRegistry(authStorage),
		});
		const dropped: string[] = [];
		session.setPromptDropped(prompt => dropped.push(prompt.text));
		return { session, dropped, turnStarted, releaseTurn };
	}

	/** Run one prompt through an abort that lands before the response arrives. */
	async function interruptFirstTurn(reason?: string) {
		const { session: active, dropped, turnStarted, releaseTurn } = await createHangingTurnSession();
		const running = active.prompt("restore me");
		await withTimeout(turnStarted.promise, 2_000, "Turn never started");
		const aborting = reason ? active.abort({ reason }) : active.abort();
		releaseTurn.resolve();
		await aborting;
		await running;
		await active.waitForIdle();
		return { session: active, dropped };
	}

	it("hands the prompt back and drops both messages on a user interrupt", async () => {
		const { session: active, dropped } = await interruptFirstTurn(USER_INTERRUPT_LABEL);

		expect(dropped).toEqual(["restore me"]);
		expect(active.messages.some(message => message.role === "user")).toBe(false);
		expect(active.messages.some(message => message.role === "assistant")).toBe(false);
		const persistedUsers = active.sessionManager
			.getBranch()
			.filter(entry => entry.type === "message" && entry.message.role === "user");
		expect(persistedUsers).toEqual([]);
	});

	it("keeps the turn when the abort carries no user-interrupt reason", async () => {
		const { session: active, dropped } = await interruptFirstTurn();

		expect(dropped).toEqual([]);
		expect(active.messages.some(message => message.role === "user")).toBe(true);
	});
});
