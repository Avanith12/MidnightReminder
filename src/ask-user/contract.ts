/**
 * Pure contract for the `ask_user` tool.
 *
 * Everything here is independent of Pi so the decision logic can be unit
 * tested with plain fakes. The extension wires these helpers to
 * `pi.registerTool`, `ctx.ui.select`, and `ctx.ui.input`.
 */

/** Sentinel option that routes the user into the free-form `ctx.ui.input` dialog. */
export const CUSTOM_ANSWER_OPTION = "Type something…";

/** One selectable answer suggested by the model. */
export interface AskUserOption {
  label: string;
  description?: string;
}

/**
 * Model-facing parameters accepted by the `ask_user` tool.
 *
 * `reason` is required: the human should always see why they are being asked.
 * `recommendation` is optional and never overrides the human's answer; the
 * result only records whether the answer contradicts it.
 */
export interface AskUserParams {
  question: string;
  reason: string;
  options?: AskUserOption[];
  recommendation?: string;
  /** When true (the default) a "Type something…" choice is appended. */
  allowCustom?: boolean;
}

/** The slice of `ctx.ui` the tool depends on. */
export interface AskUserUI {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

/** Minimal context needed to decide whether a dialog can be shown. */
export interface AskUserContext {
  hasUI: boolean;
  ui: AskUserUI;
}

/**
 * Top-level answer state. This is the whole vocabulary:
 *
 * - `answered`   — the human chose an option or typed a non-blank answer.
 * - `cancelled`  — the human dismissed a dialog, or submitted a blank answer.
 * - `unavailable`— no interactive UI was available, so nothing was asked.
 *
 * Selected versus custom answers are distinguished by `wasCustom`/`answer`,
 * not by a separate state.
 */
export type AskUserState = "answered" | "cancelled" | "unavailable";

export interface AskUserResult {
  state: AskUserState;
  answer: string | null;
  wasCustom: boolean;
  /** True only when a typed answer was blank and therefore treated as cancelled. */
  empty: boolean;
  options: string[];
  recommendation?: string;
  /** True when an `answered` result differs from the model's recommendation. */
  contradictsRecommendation: boolean;
}

/**
 * Plain JSON-schema object matching TypeBox's `Type.Object` shape. It is kept
 * dependency-free so the extension and its tests load without `typebox`
 * installed; Pi still validates tool arguments against it at runtime.
 */
export const AskUserParameters = {
  type: "object",
  properties: {
    question: {
      type: "string",
      description: "The question to ask the user. Be specific and self-contained.",
    },
    reason: {
      type: "string",
      description:
        "A short reason shown to the human explaining why the question is being asked.",
    },
    options: {
      type: "array",
      description:
        "Exactly 2 or 3 suggested answers, each with a unique non-empty label. Omit entirely to request free-form text.",
      items: {
        type: "object",
        properties: {
          label: {
            type: "string",
            description: "Short label shown in the selection list.",
          },
          description: {
            type: "string",
            description: "Optional longer explanation shown with the label.",
          },
        },
        required: ["label"],
        additionalProperties: false,
      },
    },
    recommendation: {
      type: "string",
      description:
        "Optional recommended answer shown to the human. The human's answer always wins; the result reports whether it contradicts this.",
    },
    allowCustom: {
      type: "boolean",
      description:
        'When true (the default) a "Type something…" choice lets the user answer in their own words.',
    },
  },
  required: ["question", "reason"],
  additionalProperties: false,
} as const;

/** Trim and case-fold a label for collision and duplicate detection. */
function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/** Option labels in display order, without the synthetic custom entry. */
export function optionLabels(params: AskUserParams): string[] {
  return (params.options ?? []).map((option) => option.label.trim());
}

/**
 * Validate model input loudly. Ambiguous options must never reach the user:
 * a bad call throws instead of silently degrading.
 *
 * Rules:
 * - `question` and `reason` must be non-blank strings.
 * - `options`, when provided, must have exactly 2 or 3 entries.
 * - Every option label must be non-blank and unique after trimming/case-folding.
 */
export function validateAskUserParams(params: AskUserParams): void {
  if (typeof params.question !== "string" || params.question.trim().length === 0) {
    throw new Error('ask_user: "question" is required and must be a non-empty string.');
  }
  if (typeof params.reason !== "string" || params.reason.trim().length === 0) {
    throw new Error('ask_user: "reason" is required and must be a non-empty string.');
  }

  const options = params.options;
  if (options === undefined) {
    return;
  }
  if (!Array.isArray(options) || options.length < 2 || options.length > 3) {
    throw new Error(
      "ask_user: \"options\" must contain exactly 2 or 3 entries (omit it entirely for free-form text).",
    );
  }

  const seen = new Set<string>();
  for (const option of options) {
    if (option === null || typeof option !== "object" || typeof option.label !== "string") {
      throw new Error("ask_user: every option must have a string label.");
    }
    const trimmed = option.label.trim();
    if (trimmed.length === 0) {
      throw new Error("ask_user: option labels must not be empty.");
    }
    const key = normalize(option.label);
    if (seen.has(key)) {
      throw new Error(
        `ask_user: duplicate option label "${option.label}" (labels must be unique ignoring case and surrounding whitespace).`,
      );
    }
    seen.add(key);
  }
}

/**
 * Pick a custom-entry label that cannot collide with any real option label,
 * so a real option using the sentinel text stays selectable.
 */
export function customEntryLabel(labels: string[]): string {
  const taken = new Set(labels.map(normalize));
  let candidate = CUSTOM_ANSWER_OPTION;
  let suffix = 0;
  while (taken.has(normalize(candidate))) {
    suffix += 1;
    candidate = `${CUSTOM_ANSWER_OPTION} (${suffix})`;
  }
  return candidate;
}

/** Title/prompt shown in the dialog: question, reason, and optional recommendation. */
export function buildDialogTitle(
  question: string,
  reason: string,
  recommendation?: string,
): string {
  const lines = [question.trim(), `Reason: ${reason.trim()}`];
  if (recommendation !== undefined && recommendation.trim().length > 0) {
    lines.push(`Recommended: ${recommendation.trim()}`);
  }
  return lines.join("\n\n");
}

/**
 * Ask the user and normalise every possible dialog result into an
 * `AskUserResult`. The dialogs are the only side effect, injected via `ctx.ui`.
 */
export async function askUser(
  params: AskUserParams,
  ctx: AskUserContext,
): Promise<AskUserResult> {
  validateAskUserParams(params);

  const question = params.question.trim();
  const reason = params.reason.trim();
  const recommendation =
    params.recommendation !== undefined && params.recommendation.trim().length > 0
      ? params.recommendation.trim()
      : undefined;
  const labels = optionLabels(params);
  const title = buildDialogTitle(question, reason, recommendation);
  const base = { options: labels, recommendation };

  if (!ctx.hasUI) {
    return {
      ...base,
      state: "unavailable",
      answer: null,
      wasCustom: false,
      empty: false,
      contradictsRecommendation: false,
    };
  }

  // No suggestions: go straight to free-form text.
  if (labels.length === 0) {
    const typed = await ctx.ui.input(title, "Type your answer…");
    return interpretTypedAnswer(typed, base);
  }

  const allowCustom = params.allowCustom ?? true;
  const customLabel = customEntryLabel(labels);
  const choices = allowCustom ? [...labels, customLabel] : labels;
  const selected = await ctx.ui.select(title, choices);

  if (selected === undefined) {
    return {
      ...base,
      state: "cancelled",
      answer: null,
      wasCustom: false,
      empty: false,
      contradictsRecommendation: false,
    };
  }

  // Compare against the generated custom label, never the raw sentinel, so a
  // real option with the sentinel text is treated as a normal selection.
  if (allowCustom && selected === customLabel) {
    const typed = await ctx.ui.input(title, "Type your answer…");
    return interpretTypedAnswer(typed, base);
  }

  return answeredResult(selected, false, base);
}

/** Build an `answered` result and flag contradiction with the recommendation. */
function answeredResult(
  answer: string,
  wasCustom: boolean,
  base: { options: string[]; recommendation?: string },
): AskUserResult {
  const contradictsRecommendation =
    base.recommendation !== undefined &&
    normalize(answer) !== normalize(base.recommendation);
  return {
    ...base,
    state: "answered",
    answer,
    wasCustom,
    empty: false,
    contradictsRecommendation,
  };
}

/** A dismissed dialog is `cancelled`; a blank typed answer is also `cancelled`. */
function interpretTypedAnswer(
  value: string | undefined,
  base: { options: string[]; recommendation?: string },
): AskUserResult {
  if (value === undefined) {
    return {
      ...base,
      state: "cancelled",
      answer: null,
      wasCustom: false,
      empty: false,
      contradictsRecommendation: false,
    };
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return {
      ...base,
      state: "cancelled",
      answer: null,
      wasCustom: false,
      empty: true,
      contradictsRecommendation: false,
    };
  }

  return answeredResult(trimmed, true, base);
}

/** Model-facing text for a completed `ask_user` call. */
export function formatAskUserContent(result: AskUserResult): string {
  switch (result.state) {
    case "answered": {
      const base = result.wasCustom
        ? `User wrote: ${result.answer}`
        : `User selected: ${result.answer}`;
      if (result.recommendation !== undefined && result.contradictsRecommendation) {
        return `${base} (contradicts the recommendation: ${result.recommendation})`;
      }
      return base;
    }
    case "cancelled":
      return result.empty
        ? "User submitted an empty answer; treating it as cancelled."
        : "User cancelled the question without answering.";
    case "unavailable":
      return "Error: UI not available (running without an interactive UI).";
  }
}
