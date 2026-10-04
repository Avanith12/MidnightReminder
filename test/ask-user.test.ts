import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import askUserExtension, {
  CUSTOM_ANSWER_OPTION,
} from "../src/ask-user/extension.ts";

/** Shape of the tool the extension registers, narrowed for the tests. */
interface RegisteredTool {
  name: string;
  description: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: {
    type?: string;
    required?: string[];
    properties?: Record<string, unknown>;
  };
  execute: (
    toolCallId: string,
    params: unknown,
    signal: undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: {
      question: string;
      reason: string;
      options: string[];
      answer: string | null;
      state: "answered" | "cancelled" | "unavailable";
      wasCustom: boolean;
      empty: boolean;
      recommendation?: string;
      contradictsRecommendation: boolean;
    };
  }>;
}

/** Run the extension against a fake pi and return the registered ask_user tool. */
function loadAskUserTool(): RegisteredTool {
  const tools = new Map<string, RegisteredTool>();
  const fakePi = {
    registerTool: (tool: RegisteredTool) => tools.set(tool.name, tool),
  };

  askUserExtension(fakePi as unknown as ExtensionAPI);

  const tool = tools.get("ask_user");
  assert.ok(tool, "ask_user should be registered via pi.registerTool");
  return tool;
}

interface MakeContextOptions {
  hasUI?: boolean;
  selectResult?: string | undefined | ((title: string, options: string[]) => string | undefined);
  inputResult?: string | undefined | ((title: string, placeholder?: string) => string | undefined);
}

/** Fake ExtensionContext with spy-able UI dialogs. */
function makeContext(options: MakeContextOptions = {}) {
  const selectCalls: Array<{ title: string; options: string[] }> = [];
  const inputCalls: Array<{ title: string; placeholder?: string }> = [];

  const ctx = {
    hasUI: options.hasUI ?? true,
    mode: options.hasUI === false ? "print" : "tui",
    ui: {
      select: async (title: string, choices: string[]) => {
        selectCalls.push({ title, options: choices });
        return typeof options.selectResult === "function"
          ? options.selectResult(title, choices)
          : options.selectResult;
      },
      input: async (title: string, placeholder?: string) => {
        inputCalls.push({ title, placeholder });
        return typeof options.inputResult === "function"
          ? options.inputResult(title, placeholder)
          : options.inputResult;
      },
    },
  };

  return { ctx, selectCalls, inputCalls };
}

async function run(
  tool: RegisteredTool,
  params: unknown,
  options: MakeContextOptions = {},
) {
  const { ctx, selectCalls, inputCalls } = makeContext(options);
  const result = await tool.execute("call-1", params, undefined, undefined, ctx);
  return { result, selectCalls, inputCalls };
}

const QUESTION = "Which target should we deploy to?";
const REASON = "The deployment target changes blast radius and rollback plan.";

function baseParams(extra: Record<string, unknown> = {}) {
  return { question: QUESTION, reason: REASON, ...extra };
}

describe("ask_user registration", () => {
  it("registers an ask_user tool requiring question and reason", () => {
    const tool = loadAskUserTool();

    assert.equal(tool.name, "ask_user");
    assert.deepEqual(tool.parameters.required, ["question", "reason"]);
    assert.ok(tool.parameters.properties?.question);
    assert.ok(tool.parameters.properties?.reason);
    assert.ok(tool.parameters.properties?.options);
    assert.ok(tool.parameters.properties?.recommendation);
  });

  it("documents when to ask and when to proceed without asking", () => {
    const tool = loadAskUserTool();

    assert.ok(tool.promptSnippet, "promptSnippet should be set");
    assert.ok(Array.isArray(tool.promptGuidelines) && tool.promptGuidelines.length > 0);

    const guidance = [tool.description, tool.promptSnippet, ...(tool.promptGuidelines ?? [])].join("\n");
    assert.match(guidance, /reason/i);
    assert.match(guidance, /unresolved/i);
    assert.match(guidance, /fully specified|proceed/i);
    assert.match(guidance, /do not use/i);
  });
});

// D1 — required reason surfaces to the human and in the result.
describe("ask_user reason (D1)", () => {
  it("includes the question and reason in the dialog title and details", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { selectResult: "Staging" },
    );

    assert.match(selectCalls[0].title, new RegExp(QUESTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(selectCalls[0].title, /Reason:/);
    assert.match(selectCalls[0].title, new RegExp(REASON.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(result.details.reason, REASON);
  });

  it("rejects a missing or blank reason loudly", async () => {
    const tool = loadAskUserTool();
    await assert.rejects(
      () => run(tool, { question: QUESTION, reason: "   " }),
      /reason/i,
    );
    await assert.rejects(
      () => run(tool, { question: QUESTION }),
      /reason/i,
    );
  });
});

// D2 — optional recommendation is shown but never overrides the human.
describe("ask_user recommendation (D2)", () => {
  it("shows the recommendation in the dialog and reports a contradiction", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls } = await run(
      tool,
      baseParams({
        options: [{ label: "Staging" }, { label: "Production" }],
        recommendation: "Staging",
      }),
      { selectResult: "Production" },
    );

    assert.match(selectCalls[0].title, /Recommended: Staging/);
    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "Production", "human answer must win");
    assert.equal(result.details.recommendation, "Staging");
    assert.equal(result.details.contradictsRecommendation, true);
    assert.match(result.content[0].text, /contradicts the recommendation: Staging/);
  });

  it("does not flag a matching answer (case/whitespace-insensitive)", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(
      tool,
      baseParams({
        options: [{ label: "Staging" }, { label: "Production" }],
        recommendation: "Staging",
      }),
      { selectResult: "  staging  " },
    );

    assert.equal(result.details.contradictsRecommendation, false);
  });

  it("compares custom answers against the recommendation", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(
      tool,
      baseParams({
        options: [{ label: "Staging" }, { label: "Production" }],
        recommendation: "Canary",
      }),
      {
        selectResult: (_title, options) => options[options.length - 1],
        inputResult: "canary",
      },
    );

    assert.equal(result.details.state, "answered");
    assert.equal(result.details.wasCustom, true);
    assert.equal(result.details.contradictsRecommendation, false);
  });
});

// D3 — a real option using the sentinel label must stay selectable.
describe("ask_user sentinel collision (D3)", () => {
  it("does not route a real option labeled as the sentinel to ctx.ui.input", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams({
        options: [{ label: "Alpha" }, { label: CUSTOM_ANSWER_OPTION }],
      }),
      { selectResult: CUSTOM_ANSWER_OPTION },
    );

    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, CUSTOM_ANSWER_OPTION);
    assert.equal(result.details.wasCustom, false);
    assert.equal(inputCalls.length, 0, "a real sentinel-labeled option must not open input");

    const choices = selectCalls[0].options;
    assert.equal(new Set(choices).size, choices.length, "option list must not contain duplicates");
    assert.equal(choices.filter((c) => c === CUSTOM_ANSWER_OPTION).length, 1);
  });

  it("still offers a distinct, collision-free custom entry", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams({
        options: [{ label: "Alpha" }, { label: CUSTOM_ANSWER_OPTION }],
      }),
      {
        selectResult: (_title, options) => options[options.length - 1],
        inputResult: "My own answer",
      },
    );

    const choices = selectCalls[0].options;
    const customEntry = choices[choices.length - 1];
    assert.notEqual(customEntry, CUSTOM_ANSWER_OPTION);
    assert.equal(choices.filter((c) => c === customEntry).length, 1);
    assert.equal(inputCalls.length, 1);
    assert.equal(result.details.state, "answered");
    assert.equal(result.details.wasCustom, true);
    assert.equal(result.details.answer, "My own answer");
  });
});

describe("ask_user selected option", () => {
  it("returns the option picked from ctx.ui.select", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { selectResult: "Production" },
    );

    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "Production");
    assert.equal(result.details.wasCustom, false);
    assert.deepEqual(result.details.options, ["Staging", "Production"]);

    assert.equal(selectCalls.length, 1);
    assert.equal(selectCalls[0].title.includes(QUESTION), true);
    assert.deepEqual(selectCalls[0].options, [
      "Staging",
      "Production",
      CUSTOM_ANSWER_OPTION,
    ]);
    assert.equal(inputCalls.length, 0);
    assert.match(result.content[0].text, /Production/);
  });

  it("trims option labels before display", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls } = await run(
      tool,
      baseParams({ options: [{ label: "  Staging  " }, { label: "Production" }] }),
      { selectResult: "Staging" },
    );

    assert.deepEqual(selectCalls[0].options, ["Staging", "Production", CUSTOM_ANSWER_OPTION]);
    assert.equal(result.details.answer, "Staging");
  });

  it("hides the custom entry when allowCustom is false", async () => {
    const tool = loadAskUserTool();
    const { selectCalls } = await run(
      tool,
      baseParams({
        options: [{ label: "Yes" }, { label: "No" }],
        allowCustom: false,
      }),
      { selectResult: "No" },
    );

    assert.deepEqual(selectCalls[0].options, ["Yes", "No"]);
  });
});

describe("ask_user custom answer", () => {
  it("routes the custom entry through ctx.ui.input and returns it", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { selectResult: (_title, options) => options[options.length - 1], inputResult: "  A canary cluster  " },
    );

    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "A canary cluster");
    assert.equal(result.details.wasCustom, true);
    assert.equal(selectCalls.length, 1);
    assert.equal(inputCalls.length, 1);
    assert.match(result.content[0].text, /A canary cluster/);
  });

  it("prompts with ctx.ui.input directly when no options are given", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams(),
      { inputResult: "Midnight 1.0" },
    );

    assert.equal(selectCalls.length, 0);
    assert.equal(inputCalls.length, 1);
    assert.equal(inputCalls[0].title.includes(QUESTION), true);
    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "Midnight 1.0");
    assert.equal(result.details.wasCustom, true);
  });
});

describe("ask_user cancellation", () => {
  it("reports cancellation when the select dialog is dismissed", async () => {
    const tool = loadAskUserTool();
    const { result, inputCalls } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { selectResult: undefined },
    );

    assert.equal(result.details.state, "cancelled");
    assert.equal(result.details.answer, null);
    assert.equal(result.details.wasCustom, false);
    assert.equal(result.details.empty, false);
    assert.equal(inputCalls.length, 0);
    assert.match(result.content[0].text, /cancel/i);
  });

  it("reports cancellation when the input dialog is dismissed", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(tool, baseParams(), { inputResult: undefined });

    assert.equal(result.details.state, "cancelled");
    assert.equal(result.details.answer, null);
    assert.equal(result.details.empty, false);
    assert.match(result.content[0].text, /cancel/i);
  });
});

// D5 — vocabulary is answered | cancelled | unavailable; blank input is cancelled.
describe("ask_user result vocabulary (D5)", () => {
  it("treats a blank typed answer as cancelled, not an invented answer", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { selectResult: (_title, options) => options[options.length - 1], inputResult: "   " },
    );

    assert.equal(result.details.state, "cancelled");
    assert.equal(result.details.answer, null);
    assert.equal(result.details.wasCustom, false);
    assert.equal(result.details.empty, true);
    assert.match(result.content[0].text, /cancel/i);
  });

  it("uses only the three agreed states", async () => {
    const tool = loadAskUserTool();

    const answered = await run(
      tool,
      baseParams({ options: [{ label: "Yes" }, { label: "No" }] }),
      { selectResult: "Yes" },
    );
    const cancelled = await run(
      tool,
      baseParams({ options: [{ label: "Yes" }, { label: "No" }] }),
      { selectResult: undefined },
    );
    const unavailable = await run(
      tool,
      baseParams({ options: [{ label: "Yes" }, { label: "No" }] }),
      { hasUI: false },
    );

    for (const { result } of [answered, cancelled, unavailable]) {
      assert.ok(
        ["answered", "cancelled", "unavailable"].includes(result.details.state),
        `unexpected state: ${result.details.state}`,
      );
    }
    assert.equal(answered.result.details.state, "answered");
    assert.equal(cancelled.result.details.state, "cancelled");
    assert.equal(unavailable.result.details.state, "unavailable");
  });
});

// D6 — option rules are enforced loudly.
describe("ask_user option validation (D6)", () => {
  const cases: Array<{ name: string; params: Record<string, unknown>; pattern: RegExp }> = [
    {
      name: "rejects a single option",
      params: { options: [{ label: "Only" }] },
      pattern: /exactly 2 or 3/,
    },
    {
      name: "rejects four options",
      params: {
        options: [{ label: "A" }, { label: "B" }, { label: "C" }, { label: "D" }],
      },
      pattern: /exactly 2 or 3/,
    },
    {
      name: "rejects an explicitly empty options array",
      params: { options: [] },
      pattern: /exactly 2 or 3/,
    },
    {
      name: "rejects an empty label",
      params: { options: [{ label: "Alpha" }, { label: "   " }] },
      pattern: /must not be empty/,
    },
    {
      name: "rejects duplicate labels ignoring case and whitespace",
      params: { options: [{ label: "Alpha" }, { label: " alpha " }] },
      pattern: /duplicate/i,
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, async () => {
      const tool = loadAskUserTool();
      await assert.rejects(
        () => run(tool, baseParams(testCase.params)),
        testCase.pattern,
      );
    });
  }

  it("accepts exactly 2 valid options", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(
      tool,
      baseParams({ options: [{ label: "Alpha" }, { label: "Beta" }] }),
      { selectResult: "Beta" },
    );
    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "Beta");
  });

  it("accepts exactly 3 valid options", async () => {
    const tool = loadAskUserTool();
    const { result } = await run(
      tool,
      baseParams({ options: [{ label: "Alpha" }, { label: "Beta" }, { label: "Gamma" }] }),
      { selectResult: "Gamma" },
    );
    assert.equal(result.details.state, "answered");
    assert.equal(result.details.answer, "Gamma");
  });
});

describe("ask_user unavailable UI", () => {
  it("does not open dialogs and reports unavailable when ctx.hasUI is false", async () => {
    const tool = loadAskUserTool();
    const { result, selectCalls, inputCalls } = await run(
      tool,
      baseParams({ options: [{ label: "Staging" }, { label: "Production" }] }),
      { hasUI: false, selectResult: "Production", inputResult: "ignored" },
    );

    assert.equal(result.details.state, "unavailable");
    assert.equal(result.details.answer, null);
    assert.equal(selectCalls.length, 0, "select must not be called without a UI");
    assert.equal(inputCalls.length, 0, "input must not be called without a UI");
    assert.match(result.content[0].text, /not available|unavailable/i);
  });
});
