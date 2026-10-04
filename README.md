# Midnight Reminder

A [Pi](https://github.com/earendil-works/pi) extension that nudges you to wrap up and get some rest when the clock passes midnight.

## Team

Avanith Kanamarlapudi, Ayaz Mohammed

## What it does

While a Pi session is active, Midnight Reminder silently checks the local time every minute. If the time is between **00:00** and **06:00** and you haven't been reminded yet for that calendar day, it sends a friendly notification:

> *"It is past midnight - time to wrap up and get some rest."*

Only **one reminder per local calendar day** — repeated checks or late-night sessions won't spam you.

## How it works

| File | Role |
|---|---|
| `src/extension.ts` | Pi extension entry point. Hooks into `session_start`/`session_shutdown`, starts a polling timer, and registers the `/bedtime-test` command. |
| `src/reminder.ts` | Stateful checker that deduplicates reminders by local calendar day. |
| `src/midnight.ts` | Pure, testable time-policy logic. Reminder window is `[00:00, 06:00)` local time. |

The design keeps side effects in `extension.ts` and the decision logic in pure, fast unit-testable functions.

## Prerequisites

- [Node.js](https://nodejs.org/) (for testing)
- [npm](https://www.npmjs.com/) (to install devDependencies)
- [Pi](https://github.com/earendil-works/pi) (to run the extension)

## Setup

```bash
git clone https://github.com/your-username/midnight-reminder.git
cd midnight-reminder
npm install
```

This installs `typescript` and `@types/node` into `node_modules`.

## Installation

Clone or copy this project, then load it into Pi:

```bash
pi --extension /path/to/midnight-reminder/src/extension.ts
```

Or, from inside the project folder:

```bash
pi --extension ./src/extension.ts
```

Or let Pi auto-discover it by placing the folder in your [Pi extensions directory](https://github.com/earendil-works/pi/blob/main/docs/extensions.md). The `package.json` already declares the extension entry point under the `"pi"` field:

```json
"pi": {
  "extensions": ["./src/extension.ts"]
}
```

## Commands

| Command | Description |
|---|---|
| `/bedtime-test` | Manually run the bedtime reminder check using the real clock. Reports whether a reminder fired. |
| `/bedtime-test <YYYY-MM-DD HH:mm>` | Run the check at a simulated local time. Useful for demos and for verifying the per-day rule without waiting until midnight. |

### Simulated-time demos

The manual command accepts an optional simulated local time. The reminder window is
`[00:00, 06:00)` local time, and only one reminder fires per local calendar day:

```text
/bedtime-test 2026-01-15 00:30   # fires (inside the window, first time that day)
/bedtime-test 2026-01-15 03:00   # no reminder (same day already reminded)
/bedtime-test 2026-01-16 00:30   # fires again (new calendar day)
/bedtime-test 2026-01-15 12:00   # no reminder (outside the window)
/bedtime-test 2026-01-15 06:00   # no reminder (window end is exclusive)
/bedtime-test                    # checks the real clock
```

Both outcomes print a clear message: either the reminder fired, or no reminder
was needed (outside the window or already reminded that day). Invalid timestamps
are reported without running the check.

## Tools

### `ask_user`

The `ask_user` tool lets the model pause and ask you a question mid-turn. It is
for genuine choices that are still unresolved and would change the scope,
direction, or output of the work; the model should proceed without asking when
the task is fully specified or a safe, clearly-stated assumption is enough.

**How to run it**

```bash
pi --extension ./src/ask-user/extension.ts
```

1. **Ask a question and pick an option:**  
   Use the ask_user tool. Ask me whether reminder state should last only for this session or be saved after Pi restarts. Give those two options. Recommend session-only.

2. **Type a custom answer:**  
   Use the ask_user tool again with the same question and the same two options. I want to type my own answer.

3. **Cancel:**  
   Use the ask_user tool again with the same question and the same two options. I will dismiss the dialog.

4. **Do not ask:**  
   The reminder state must last only for this session. State that in your reply. Do not ask me anything.

| Input | Behavior |
|---|---|
| `question` (required) | The question shown in the dialog. |
| `reason` (required) | A short reason shown to the human explaining why they are being asked. Question, reason, and any recommendation are all shown in the dialog title. |
| `options` | Exactly 2 or 3 suggested answers shown with `ctx.ui.select`. Labels must be unique and non-empty after trimming/case-folding. Omit `options` entirely to request free-form text. |
| `recommendation` | Optional recommended answer, shown as `Recommended: ...`. It never overrides the human's choice; the result reports whether the answer contradicts it. |
| `allowCustom` | Defaults to `true`. Set to `false` to hide the custom-answer entry. |

The user can always pick **"Type something…"** (when custom answers are allowed)
to answer in their own words via `ctx.ui.input`. A real option whose label happens
to match the custom sentinel stays selectable: the tool generates a collision-free
custom entry and never shows duplicate options.

Every call ends in exactly one of three states:

| State | Meaning |
|---|---|
| `answered` | The human chose an option or typed a non-blank answer. Use `wasCustom` and `answer` to tell the two apart. |
| `cancelled` | The human dismissed a dialog, **or** submitted an empty/whitespace-only typed answer (flagged with `empty: true`). No default is ever invented. |
| `unavailable` | The session has no interactive UI (`ctx.hasUI === false`), so no dialog was opened. |

The model-facing details also include `question`, `reason`, `options`,
`recommendation`, and `contradictsRecommendation`. Invalid options (wrong
count, blank label, or duplicate labels) make the call fail loudly instead of
silently degrading.

The tool logic lives in `src/ask-user/contract.ts` (dependency-free and unit
tested) and is wired to Pi in `src/ask-user/extension.ts`.

## Configuration

The reminder window and message are currently defined in code:

- **Window:** 00:00 (inclusive) to 06:00 (exclusive), local time
- **Interval:** 60 seconds
- **Default message:** `"It is past midnight - time to wrap up and get some rest."`

Edit `src/midnight.ts` or `src/reminder.ts` to adjust the window or wording.

## Development

This project is pure TypeScript with `tsconfig.json` set to `"noEmit": true`, so
there is **no build step**. Pi (and the test runner) consume `.ts` files directly.

Before running tests, make sure dependencies are installed (see **Setup** above).

```bash
# Type-check
npx tsc --noEmit

# Run tests
npm test

# Watch mode
npm run test:watch
```

## File structure

```
midnight-reminder/
├── src/
│   ├── extension.ts   # Pi extension lifecycle & command
│   ├── ask-user/
│   │   ├── contract.ts  # Pure ask_user logic & schema
│   │   └── extension.ts # Registers the ask_user tool
│   ├── reminder.ts  # Stateful deduplication wrapper
│   └── midnight.ts  # Pure time-window policy
├── test/
│   ├── ask-user.test.ts
│   ├── extension.test.ts
│   ├── midnight.test.ts
│   └── reminder.test.ts
├── package.json
└── tsconfig.json
```

## License

[MIT](LICENSE). Copyright (c) 2025 Midnight Reminder Contributors.
