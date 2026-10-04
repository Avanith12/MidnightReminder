/**
 * `ask_user` Pi extension.
 *
 * Registers a model-callable tool that pauses the turn and asks the human a
 * question through `ctx.ui.select` (suggested answers) and `ctx.ui.input`
 * (free-form or "Type something…" answers). All answer interpretation lives in
 * the dependency-free `contract.ts` so it can be unit tested with fakes.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";

import {
  AskUserParameters,
  askUser,
  formatAskUserContent,
  type AskUserParams,
  type AskUserResult,
} from "./contract.ts";

export { CUSTOM_ANSWER_OPTION } from "./contract.ts";

/** Structured details persisted with each tool result. */
interface AskUserDetails {
  question: string;
  reason: string;
  options: string[];
  answer: string | null;
  state: AskUserResult["state"];
  wasCustom: boolean;
  empty: boolean;
  recommendation?: string;
  contradictsRecommendation: boolean;
}

export default function askUserExtension(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the human a clarifying question, together with a short reason, and wait for their answer. Use it when a choice is genuinely unresolved and the answer would change scope, direction, or output. Provide 2 or 3 options to offer a multiple-choice list (the human can still type a custom answer unless allowCustom is false); omit options to request free-form text. An optional recommendation is shown but never overrides the human; the result says whether their answer contradicts it. Do not use this when the task is fully specified or a safe default lets you proceed.",
    promptSnippet:
      "Ask the human a clarifying question (with a short reason) when a choice is unresolved.",
    promptGuidelines: [
      "Use ask_user only when a genuine choice is unresolved and the answer would change scope, direction, or output; always include a short reason.",
      "Do not use ask_user when the task is fully specified or you can proceed with a safe, clearly-stated assumption.",
      "When offering options, provide exactly 2 or 3 with unique, non-empty labels; omit options for free-form text.",
    ],
    parameters: AskUserParameters as unknown as TSchema,
    // Opening dialogs is a shared, stateful UI resource: run one at a time.
    executionMode: "sequential",

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const input = params as AskUserParams;
      // `askUser` validates loudly so ambiguous options never reach the human.
      const result = await askUser(input, {
        hasUI: ctx.hasUI,
        ui: ctx.ui,
      });

      const details: AskUserDetails = {
        question: input.question.trim(),
        reason: input.reason.trim(),
        options: result.options,
        answer: result.answer,
        state: result.state,
        wasCustom: result.wasCustom,
        empty: result.empty,
        recommendation: result.recommendation,
        contradictsRecommendation: result.contradictsRecommendation,
      };

      return {
        content: [{ type: "text", text: formatAskUserContent(result) }],
        details,
      };
    },
  });
}
