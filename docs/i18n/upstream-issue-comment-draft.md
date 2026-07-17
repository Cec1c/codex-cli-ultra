# Draft comment for openai/codex issue #29309

> Draft only. Do not publish without explicit user approval.
>
> Preparation fork: https://github.com/Cec1c/codex. Add the exact demo branch and commit link before publishing.

I built and replayed a small, working TUI localization prototype against Codex CLI `0.144.4` (`8c68d4c87dc54d38861f5114e920c3de2efa5876`) to test whether an upstreamable design is practical before proposing a PR.

The prototype intentionally keeps the scope small:

- Fluent-based localization inside `codex-tui` with compiled English closures as the fallback.
- 129 user-visible strings wired from real upstream TUI call sites:
  - 4 status-line setup strings;
  - 1 worked-duration string with a Fluent argument;
  - 6 sign-in onboarding strings;
  - all 51 built-in slash-command descriptions;
  - 21 common `/status` card labels and messages;
  - one command-popup empty state;
  - 20 common approval titles and options;
  - 25 session-card, tooltip, MCP-prefix, usage-note, composer-placeholder, Context/Token, and unknown-command strings.
- `/language` shows the active language and usage.
- `/language zh-CN` and `/language en` save the preference for the next Codex launch.
- Missing, malformed, or incomplete FTL resources fall back safely to English.

The language switch is restart-based in this MVP. I did not attempt hot reload, full-string extraction, automatic OS-locale negotiation, or localization of prompts/model instructions.

Representative self-check output with the zh-CN FTL loaded:

```json
{
  "active": true,
  "locale": "zh-CN",
  "messages": {
    "tui.status-line.setup.configure-title": "配置状态栏",
    "tui.onboarding.auth.sign-in-chatgpt": "登录 ChatGPT",
    "tui.slash-command.description.model": "选择模型和推理强度",
    "tui.history.worked-for": "工作了 7m 57s"
  }
}
```

With the FTL path missing, the same binary reports `active: false`, `locale: null`, and returns the original English for all 130 localizable messages, including the fork-added `/language` description.

Validation completed:

- adapter replayed successfully on a fresh checkout and changed 29 controlled files;
- `cargo test -p codex-tui i18n::tests --locked`: 10 passed;
- `cargo test -p codex-tui slash_command::tests --locked`: 5 passed;
- `cargo test -p codex-tui bottom_pane::command_popup::tests --locked`: 15 passed;
- debug `codex.exe` build succeeded;
- Chinese and missing-resource English self-checks succeeded;
- project test suite: 199 passed;
- the zh-CN pack validates 129 upstream catalog entries with explicit, concise Fluent keys such as `slash-model-description`, `session-card-model-label`, and `slash-unrecognized-command` rather than mechanically encoded hierarchy.

For an upstream contribution, I would remove all fork-specific installer, launcher, and compatibility code. A first PR could be split down to:

1. the minimal Fluent/localizer scaffold with English fallback;
2. a language preference entry point (`/language` or a maintainer-preferred config surface);
3. only a few representative TUI strings and focused tests.

I saw the earlier response in #26136 that TUI localization was not planned at that time. Before spending more effort on a long-lived fork, would the team be open to discussing this smaller scaffold now? If the direction aligns with the current architecture and roadmap, would a maintainer be willing to invite a focused PR under the repository's contribution policy?

References:

- CLI-specific request: https://github.com/openai/codex/issues/29309
- Earlier TUI localization discussion: https://github.com/openai/codex/issues/26136
- Contribution policy: https://github.com/openai/codex/blob/main/docs/contributing.md
