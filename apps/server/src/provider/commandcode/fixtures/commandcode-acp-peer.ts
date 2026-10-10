#!/usr/bin/env node
/** Deterministic ACP peer used by Command Code adapter lifecycle tests. */
import * as NodeReadline from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write(`${process.env.T3_COMMANDCODE_TEST_VERSION ?? "1.74.0"}\n`);
  process.exit(0);
}
if (process.argv.includes("status")) {
  const authenticated = process.env.T3_COMMANDCODE_TEST_AUTH !== "false";
  process.stdout.write(`${JSON.stringify({ authenticated, version: "1.74.0" })}\n`);
  process.exit(authenticated ? 0 : 1);
}

let nextRequest = 1;
let sessionId = "fake-command-code-session";
let mode = "default";
let mcpServers: unknown = [];
let clientCapabilities: unknown;
let pendingPrompt: { id: unknown; params: Record<string, unknown> } | undefined;

const lineReader = NodeReadline.createInterface({ input: process.stdin });
const write = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`);
const notify = (method: string, params: unknown) => write({ jsonrpc: "2.0", method, params });

function response(id: unknown, result: unknown) {
  write({ jsonrpc: "2.0", id, result });
}

lineReader.on("line", (line) => {
  const message = JSON.parse(line) as {
    id?: unknown;
    method?: string;
    params?: Record<string, unknown>;
    result?: { outcome?: { outcome?: string; optionId?: string } };
  };
  const { id, method, params = {} } = message;
  if (pendingPrompt && typeof id !== "undefined" && typeof method === "undefined") {
    const prompt = pendingPrompt;
    pendingPrompt = undefined;
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: {
          type: "text",
          text: `selected:${message.result?.outcome?.optionId ?? "cancelled"}`,
        },
      },
    });
    if (message.result?.outcome?.outcome === "cancelled") {
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "cancel-drained" },
        },
      });
      response(prompt.id, { stopReason: "cancelled" });
      return;
    }
    finishPrompt(prompt.id, prompt.params);
    return;
  }
  if (method === "initialize") {
    clientCapabilities = params.clientCapabilities;
    response(id, {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: false,
        promptCapabilities: {
          image: true,
          audio: false,
          embeddedContext: true,
        },
        sessionCapabilities: { resume: {}, close: {} },
      },
      authMethods: [{ id: "command-code-cli", name: "Command Code" }],
    });
    return;
  }
  if (method === "authenticate") {
    response(id, {});
    return;
  }
  if (method === "session/new" || method === "session/resume") {
    mcpServers = params.mcpServers;
    sessionId = method === "session/resume" ? String(params.sessionId ?? sessionId) : sessionId;
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "available_commands_update",
        availableCommands: [{ name: "compact", description: "Compact session" }],
      },
    });
    response(id, {
      sessionId,
      modes: {
        currentModeId: mode,
        availableModes: [
          { id: "default", name: "Default" },
          { id: "auto-accept", name: "Auto accept" },
          { id: "plan", name: "Plan" },
          { id: "bypass", name: "Bypass" },
        ],
      },
      configOptions: [
        {
          id: "model",
          category: "model",
          type: "select",
          name: "Model",
          currentValue: "fake-model",
          options: [{ value: "fake-model", name: "Fake model" }],
        },
        {
          id: "effort",
          category: "thought_level",
          type: "select",
          name: "Effort",
          currentValue: "medium",
          options: [
            { value: "low", name: "Low" },
            { value: "medium", name: "Medium" },
            { value: "high", name: "High" },
          ],
        },
      ],
    });
    return;
  }
  if (method === "session/set_mode") {
    mode = String(params.modeId ?? mode);
    response(id, { modeId: mode });
    notify("session/update", {
      sessionId,
      update: { sessionUpdate: "current_mode_update", currentModeId: mode },
    });
    return;
  }
  if (method === "session/set_config_option") {
    response(id, { configOptions: [] });
    return;
  }
  if (method === "session/cancel") {
    if (id !== undefined) response(id, {});
    if (pendingPrompt) {
      const prompt = pendingPrompt;
      pendingPrompt = undefined;
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "cancel-drained" },
        },
      });
      response(prompt.id, {
        stopReason: "cancelled",
        _meta: { usage: { inputTokens: 1, outputTokens: 0 } },
      });
    }
    return;
  }
  if (method === "session/close") {
    response(id, {});
    lineReader.close();
    return;
  }
  if (method === "session/prompt") {
    const promptId = id ?? nextRequest++;
    const text = JSON.stringify(params.prompt ?? "");
    if (text.includes("inspect-setup")) {
      notify("session/update", {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: JSON.stringify({ mode, mcpServers, clientCapabilities }) },
        },
      });
      response(promptId, { stopReason: "end_turn" });
      return;
    }
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "usage_update",
        used: 20,
        size: 100,
        cost: { amount: 0.01, currency: "USD" },
      },
    });
    if (text.includes("approval-request")) {
      pendingPrompt = { id: promptId, params };
      write({
        jsonrpc: "2.0",
        id: 77,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: {
            toolCallId: "tool-approval",
            kind: "execute",
            title: "Run command",
            rawInput: { command: "echo approved" },
          },
          options: [
            { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
            { optionId: "reject_once", name: "Deny", kind: "reject_once" },
          ],
        },
      });
      return;
    }
    if (text.includes("tool-loop")) {
      pendingPrompt = { id: promptId, params };
      for (let index = 0; index < 8; index++) {
        notify("session/update", {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `loop-${index}`,
            kind: "execute",
            title: "Ran command",
            status: "completed",
            rawInput: { command: "true", description: "noop" },
            content: [{ type: "content", content: { type: "text", text: "(no output)" } }],
          },
        });
      }
      return;
    }
    if (text.includes("question-request")) {
      pendingPrompt = { id: promptId, params };
      write({
        jsonrpc: "2.0",
        id: 78,
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: {
            toolCallId: "question-1",
            kind: "other",
            title: "Choose a color",
            rawInput: { question: "Choose a color", options: ["Red", "Blue"] },
          },
          options: [
            { optionId: "option_0", name: "Red", kind: "allow_once" },
            { optionId: "option_1", name: "Blue", kind: "allow_once" },
          ],
        },
      });
      return;
    }
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: `echo:${text}` },
      },
    });
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        kind: "execute",
        title: "echo",
        status: "pending",
        rawInput: { command: "echo fake" },
      },
    });
    notify("session/update", {
      sessionId,
      update: {
        sessionUpdate: "tool_call_update",
        toolCallId: "tool-1",
        status: "completed",
        content: [{ type: "content", content: { type: "text", text: "done" } }],
      },
    });
    response(promptId, {
      stopReason: "end_turn",
      _meta: { usage: { inputTokens: 3, outputTokens: 2 } },
    });
    return;
  }
  if (typeof id !== "undefined") response(id, {});
});

function finishPrompt(promptId: unknown, params: Record<string, unknown>) {
  const text = JSON.stringify(params.prompt ?? "");
  notify("session/update", {
    sessionId,
    update: {
      sessionUpdate: "agent_message_chunk",
      content: { type: "text", text: `echo:${text}` },
    },
  });
  response(promptId, {
    stopReason: "end_turn",
    _meta: { usage: { inputTokens: 3, outputTokens: 2 } },
  });
}
