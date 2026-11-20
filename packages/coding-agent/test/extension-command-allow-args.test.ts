/**
 * `allowArgs: false` makes a registered command bare-only. `/name` runs its handler,
 * while `/name anything` must reach the model as an ordinary prompt — otherwise a
 * no-argument command silently swallows text the user meant to send.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ExtensionRuntime, loadExtensionFromFactory } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";

describe("extension command allowArgs", () => {
	let session: AgentSession | undefined;
	let authStorage: AuthStorage | undefined;

	afterEach(async () => {
		await session?.dispose();
		authStorage?.close();
	});

	async function startSession(handler: (args: string) => void): Promise<AgentSession> {
		const runtime = new ExtensionRuntime();
		const extension = await loadExtensionFromFactory(
			pi => {
				pi.registerCommand("kitty", { allowArgs: false, handler: async args => handler(args) });
				pi.registerCommand("open-with-args", { handler: async args => handler(args) });
			},
			process.cwd(),
			new EventBus(),
			runtime,
			"allow-args",
		);

		authStorage = await AuthStorage.create(":memory:");
		authStorage.keys.setRuntime("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage);
		const sessionManager = SessionManager.inMemory();
		const extensionRunner = new ExtensionRunner([extension], runtime, process.cwd(), sessionManager, modelRegistry);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected claude-sonnet-4-5 model to exist");
		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: { model, systemPrompt: ["Test"], tools: [] },
			streamFn: createMockModel({ responses: [{ content: ["ok"], stopReason: "stop" }] }).stream,
		});
		return new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({ "compaction.enabled": false }),
			modelRegistry,
			extensionRunner,
		});
	}

	it("runs a bare-only command without arguments", async () => {
		const calls: string[] = [];
		session = await startSession(args => calls.push(args));

		expect(await session.prompt("/kitty")).toBe(false);
		expect(calls).toEqual([""]);
	});

	it("sends an invocation with arguments to the model instead of the handler", async () => {
		const calls: string[] = [];
		session = await startSession(args => calls.push(args));

		expect(await session.prompt("/kitty open the door")).toBe(true);
		expect(calls).toEqual([]);
		const texts = session.messages
			.filter(message => message.role === "user")
			.flatMap(message =>
				typeof message.content === "string"
					? [message.content]
					: message.content.flatMap(part => (part.type === "text" ? [part.text] : [])),
			);
		expect(texts).toContain("/kitty open the door");
	});

	it("keeps passing arguments to a command that allows them", async () => {
		const calls: string[] = [];
		session = await startSession(args => calls.push(args));

		expect(await session.prompt("/open-with-args anything here")).toBe(false);
		expect(calls).toEqual(["anything here"]);
	});
});
