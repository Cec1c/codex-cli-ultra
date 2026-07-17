const STATUS_LINE_SETUP_PATH =
  "codex-rs/tui/src/bottom_pane/status_line_setup.rs";
const ONBOARDING_AUTH_PATH = "codex-rs/tui/src/onboarding/auth.rs";
const SLASH_COMMAND_PATH = "codex-rs/tui/src/slash_command.rs";
const STATUS_CARD_PATH = "codex-rs/tui/src/status/card.rs";
const COMMAND_POPUP_PATH = "codex-rs/tui/src/bottom_pane/command_popup.rs";
const APPROVAL_OVERLAY_PATH =
  "codex-rs/tui/src/bottom_pane/approval_overlay.rs";
const SESSION_HEADER_PATH = "codex-rs/tui/src/history_cell/session.rs";
const TOOLTIPS_PATH = "codex-rs/tui/tooltips.txt";
const MCP_STARTUP_PATH = "codex-rs/tui/src/chatwidget/mcp_startup.rs";
const CHATWIDGET_PATH = "codex-rs/tui/src/chatwidget.rs";
const STATUS_SURFACES_PATH = "codex-rs/tui/src/chatwidget/status_surfaces.rs";
const FOOTER_PATH = "codex-rs/tui/src/bottom_pane/footer.rs";
const CHAT_COMPOSER_PATH = "codex-rs/tui/src/bottom_pane/chat_composer.rs";

function plainMessage({
  id,
  ftlKey,
  surface,
  path,
  symbol,
  anchor,
  english,
  mvpStatus = "wired",
  expectedOccurrences = 1
}) {
  return {
    id,
    ftlKey,
    surface,
    kind: "plain",
    translation: "required",
    mvpStatus,
    path,
    symbol,
    anchor,
    english,
    args: [],
    expectedOccurrences
  };
}

function slashDescription({ id, ftlKey, english, expectedOccurrences = 1 }) {
  return plainMessage({
    id: `tui.slash-command.description.${id}`,
    ftlKey,
    surface: "slash-command-popup",
    path: SLASH_COMMAND_PATH,
    symbol: "SlashCommand::description",
    anchor: `"${english}"`,
    english,
    expectedOccurrences
  });
}

function parameterizedMessage({
  id,
  ftlKey,
  surface,
  path,
  symbol,
  anchor,
  english,
  args,
  expectedOccurrences = 1
}) {
  return {
    id,
    ftlKey,
    surface,
    kind: "parameterized",
    translation: "required",
    mvpStatus: "wired",
    path,
    symbol,
    anchor,
    english,
    args,
    expectedOccurrences
  };
}

const SLASH_DESCRIPTION_SPECS = [
  ["feedback", "slash-feedback-description", "send logs to maintainers"],
  ["new", "slash-new-description", "start a new chat during a conversation"],
  ["init", "slash-init-description", "create an AGENTS.md file with instructions for Codex"],
  ["compact", "slash-compact-description", "summarize conversation to prevent hitting the context limit"],
  ["review", "slash-review-description", "review my current changes and find issues"],
  ["rename", "slash-rename-description", "rename the current thread"],
  ["resume", "slash-resume-description", "resume a saved chat"],
  ["archive", "slash-archive-description", "archive this session and exit"],
  ["delete", "slash-delete-description", "permanently delete this session and exit"],
  ["clear", "slash-clear-description", "clear the terminal and start a new chat"],
  ["fork", "slash-fork-description", "fork the current chat"],
  ["app", "slash-app-description", "continue this session in Codex Desktop"],
  ["exit", "slash-exit-description", "exit Codex"],
  ["copy", "slash-copy-description", "copy last response as markdown"],
  ["raw", "slash-raw-description", "toggle raw scrollback mode for copy-friendly terminal selection"],
  ["diff", "slash-diff-description", "show git diff (including untracked files)"],
  ["mention", "slash-mention-description", "mention a file"],
  ["skills", "slash-skills-description", "use skills to improve how Codex performs specific tasks"],
  ["import", "slash-import-description", "import setup, this project, and recent chats from Claude Code"],
  ["hooks", "slash-hooks-description", "view and manage lifecycle hooks"],
  ["status", "slash-status-description", "show current session configuration and token usage"],
  ["usage", "slash-usage-description", "view account usage or use a usage limit reset"],
  ["debug-config", "slash-debug-config-description", "show config layers and requirement sources for debugging"],
  ["title", "slash-title-description", "configure which items appear in the terminal title"],
  ["statusline", "slash-statusline-description", "configure which items appear in the status line"],
  ["theme", "slash-theme-description", "choose a syntax highlighting theme"],
  ["pets", "slash-pets-description", "choose or hide the terminal pet"],
  ["ps", "slash-ps-description", "list background terminals"],
  ["stop", "slash-stop-description", "stop all background terminals"],
  ["internal-debug", "slash-internal-debug-description", "DO NOT USE", 2],
  ["model", "slash-model-description", "choose what model and reasoning effort to use"],
  ["ide", "slash-ide-description", "include current selection, open files, and other context from your IDE"],
  ["personality", "slash-personality-description", "choose a communication style for Codex"],
  ["plan", "slash-plan-description", "switch to Plan mode"],
  ["goal", "slash-goal-description", "set or view the goal for a long-running task"],
  ["agent", "slash-agent-description", "switch the active agent thread"],
  ["side", "slash-side-description", "start a side conversation in an ephemeral fork"],
  ["permissions", "slash-permissions-description", "choose what Codex is allowed to do"],
  ["keymap", "slash-keymap-description", "remap TUI shortcuts"],
  ["vim", "slash-vim-description", "toggle Vim mode for the composer"],
  ["elevate-sandbox", "slash-elevate-sandbox-description", "set up elevated agent sandbox"],
  ["sandbox-read-root", "slash-sandbox-read-root-description", "let sandbox read a directory: /sandbox-add-read-dir <absolute_path>"],
  ["experimental", "slash-experimental-description", "toggle experimental features"],
  ["approve", "slash-approve-description", "approve one retry of a recent auto-review denial"],
  ["memories", "slash-memories-description", "configure memory use and generation"],
  ["mcp", "slash-mcp-description", "list configured MCP tools; use /mcp verbose for details"],
  ["apps", "slash-apps-description", "manage apps"],
  ["plugins", "slash-plugins-description", "browse plugins"],
  ["logout", "slash-logout-description", "log out of Codex"],
  ["rollout", "slash-rollout-description", "print the rollout file path"],
  ["test-approval", "slash-test-approval-description", "test approval request"]
].map(([id, ftlKey, english, expectedOccurrences]) =>
  slashDescription({ id, ftlKey, english, expectedOccurrences })
);

const STATUS_CARD_SPECS = [
  ["model-label", "status-card-model-label", "Model", 2],
  ["directory-label", "status-card-directory-label", "Directory", 2],
  ["permissions-label", "status-card-permissions-label", "Permissions", 2],
  ["agents-label", "status-card-agents-label", "Agents.md", 2],
  ["model-provider-label", "status-card-model-provider-label", "Model provider", 2],
  ["account-label", "status-card-account-label", "Account", 2],
  ["thread-name-label", "status-card-thread-name-label", "Thread name", 2],
  ["session-label", "status-card-session-label", "Session", 2],
  ["forked-from-label", "status-card-forked-from-label", "Forked from", 2],
  [
    "collaboration-mode-label",
    "status-card-collaboration-mode-label",
    "Collaboration mode",
    2
  ],
  ["token-usage-label", "status-card-token-usage-label", "Token usage", 2],
  ["context-window-label", "status-card-context-window-label", "Context window", 2],
  ["remote-label", "status-card-remote-label", "Remote"],
  ["limits-label", "status-card-limits-label", "Limits", 6],
  ["warning-label", "status-card-warning-label", "Warning", 2],
  [
    "limits-unavailable",
    "status-card-limits-unavailable",
    "not available for this account",
    2
  ],
  [
    "limits-stale-run-status",
    "status-card-limits-stale-run-status",
    "limits may be stale - run /status again shortly."
  ],
  [
    "limits-stale-new-turn",
    "status-card-limits-stale-new-turn",
    "limits may be stale - start new turn to refresh."
  ],
  [
    "limits-refresh-requested",
    "status-card-limits-refresh-requested",
    "refresh requested; run /status again shortly."
  ],
  ["limits-data-pending", "status-card-limits-data-pending", "data not available yet"],
  [
    "api-key-configured",
    "status-card-api-key-configured",
    "API key configured (run codex login to use ChatGPT)"
  ]
].map(([id, ftlKey, english, expectedOccurrences]) =>
  plainMessage({
    id: `tui.status-card.${id}`,
    ftlKey,
    surface: "status-card",
    path: STATUS_CARD_PATH,
    symbol: "StatusHistoryCell::display_lines",
    anchor: `"${english}"`,
    english,
    expectedOccurrences
  })
);

const APPROVAL_OVERLAY_SPECS = [
  [
    "run-command-title",
    "approval-run-command-title",
    "Would you like to run the following command?"
  ],
  [
    "grant-permissions-title",
    "approval-grant-permissions-title",
    "Would you like to grant these permissions?"
  ],
  [
    "apply-patch-title",
    "approval-apply-patch-title",
    "Would you like to make the following edits?"
  ],
  ["yes-once", "approval-yes-once", "Yes, just this once", 2],
  ["yes-proceed", "approval-yes-proceed", "Yes, proceed", 4],
  [
    "allow-host-conversation",
    "approval-allow-host-conversation",
    "Yes, and allow this host for this conversation",
    2
  ],
  [
    "allow-permissions-session",
    "approval-allow-permissions-session",
    "Yes, and allow these permissions for this session"
  ],
  [
    "allow-command-session",
    "approval-allow-command-session",
    "Yes, and don't ask again for this command in this session",
    2
  ],
  [
    "allow-host-future",
    "approval-allow-host-future",
    "Yes, and allow this host in the future",
    2
  ],
  [
    "block-host-future",
    "approval-block-host-future",
    "No, and block this host in the future"
  ],
  [
    "decline-command",
    "approval-decline-command",
    "No, continue without running it"
  ],
  [
    "tell-codex",
    "approval-tell-codex",
    "No, and tell Codex what to do differently",
    5
  ],
  [
    "allow-files-session",
    "approval-allow-files-session",
    "Yes, and don't ask again for these files"
  ],
  [
    "grant-permissions-turn",
    "approval-grant-permissions-turn",
    "Yes, grant these permissions for this turn",
    2
  ],
  [
    "grant-strict-review-turn",
    "approval-grant-strict-review-turn",
    "Yes, grant for this turn with strict auto review",
    2
  ],
  [
    "grant-permissions-session",
    "approval-grant-permissions-session",
    "Yes, grant these permissions for this session",
    2
  ],
  [
    "continue-without-permissions",
    "approval-continue-without-permissions",
    "No, continue without permissions",
    2
  ],
  [
    "provide-requested-info",
    "approval-provide-requested-info",
    "Yes, provide the requested info"
  ],
  [
    "continue-without-info",
    "approval-continue-without-info",
    "No, but continue without it"
  ],
  ["cancel-request", "approval-cancel-request", "Cancel this request"]
].map(([id, ftlKey, english, expectedOccurrences]) =>
  plainMessage({
    id: `tui.approval.${id}`,
    ftlKey,
    surface: "approval-overlay",
    path: APPROVAL_OVERLAY_PATH,
    symbol: "ApprovalOverlay::build_options",
    anchor: `"${english}"`,
    english,
    expectedOccurrences
  })
);

const COMPOSER_PLACEHOLDER_SPECS = [
  ["explain-codebase", "composer-explain-codebase", "Explain this codebase"],
  ["summarize-commits", "composer-summarize-commits", "Summarize recent commits"],
  ["implement-feature", "composer-implement-feature", "Implement {feature}"],
  ["fix-file-bug", "composer-fix-file-bug", "Find and fix a bug in @filename"],
  ["write-file-tests", "composer-write-file-tests", "Write tests for @filename"],
  [
    "improve-file-docs",
    "composer-improve-file-docs",
    "Improve documentation in @filename"
  ],
  [
    "review-current-changes",
    "composer-review-current-changes",
    "Run /review on my current changes"
  ],
  ["list-skills", "composer-list-skills", "Use /skills to list available skills"],
  [
    "side-check-compatibility",
    "composer-side-check-compatibility",
    "Check recently modified functions for compatibility"
  ],
  [
    "side-count-modified-files",
    "composer-side-count-modified-files",
    "How many files have been modified?"
  ],
  ["side-check-scale", "composer-side-check-scale", "Will this algorithm scale well?"]
].map(([id, ftlKey, english]) =>
  plainMessage({
    id: `tui.composer.placeholder.${id}`,
    ftlKey,
    surface: "composer",
    path: CHATWIDGET_PATH,
    symbol: "ChatWidget::new_with_op_target",
    anchor: `"${english}"`,
    english
  })
);

const ADDITIONAL_VISIBLE_SPECS = [
  plainMessage({
    id: "tui.session-card.model-label",
    ftlKey: "session-card-model-label",
    surface: "session-card",
    path: SESSION_HEADER_PATH,
    symbol: "SessionHeaderHistoryCell::display_lines",
    anchor: 'model_label = "model:"',
    english: "model:"
  }),
  plainMessage({
    id: "tui.session-card.directory-label",
    ftlKey: "session-card-directory-label",
    surface: "session-card",
    path: SESSION_HEADER_PATH,
    symbol: "SessionHeaderHistoryCell::display_lines",
    anchor: 'const DIR_LABEL: &str = "directory:"',
    english: "directory:"
  }),
  plainMessage({
    id: "tui.session-card.permissions-label",
    ftlKey: "session-card-permissions-label",
    surface: "session-card",
    path: SESSION_HEADER_PATH,
    symbol: "SessionHeaderHistoryCell::display_lines",
    anchor: 'const PERMISSIONS_LABEL: &str = "permissions:"',
    english: "permissions:"
  }),
  plainMessage({
    id: "tui.session-card.change-model-hint",
    ftlKey: "session-card-change-model-hint",
    surface: "session-card",
    path: SESSION_HEADER_PATH,
    symbol: "SessionHeaderHistoryCell::display_lines",
    anchor: 'CHANGE_MODEL_HINT_EXPLANATION: &str = " to change"',
    english: "to change"
  }),
  plainMessage({
    id: "tui.tooltip.label",
    ftlKey: "tooltip-label",
    surface: "tooltip",
    path: SESSION_HEADER_PATH,
    symbol: "TooltipHistoryCell",
    anchor: 'format!("**Tip:** {}", self.tip)',
    english: "Tip:"
  }),
  plainMessage({
    id: "tui.tooltip.rename-threads",
    ftlKey: "tooltip-rename-threads",
    surface: "tooltip",
    path: TOOLTIPS_PATH,
    symbol: "random startup tooltip",
    anchor: "Use /rename to rename your threads for easier thread resuming.",
    english: "Use /rename to rename your threads for easier thread resuming."
  }),
  parameterizedMessage({
    id: "tui.mcp.client-failed-to-start",
    ftlKey: "mcp-client-failed-to-start",
    surface: "mcp-startup",
    path: MCP_STARTUP_PATH,
    symbol: "ChatWidget::on_mcp_server_status_updated",
    anchor: 'format!("MCP client for `{}` failed to start", notification.name)',
    english: "MCP client for `{name}` failed to start",
    args: [{ name: "name", type: "string", sample: "openaiDeveloperDocs" }]
  }),
  parameterizedMessage({
    id: "tui.status-card.usage-note",
    ftlKey: "status-card-usage-note",
    surface: "status-card",
    path: STATUS_CARD_PATH,
    symbol: "StatusHistoryCell::display_lines",
    anchor: 'Span::from("Visit ").cyan()',
    english: "Visit {url} for up-to-date information on rate limits and credits",
    args: [
      {
        name: "url",
        type: "string",
        sample: "https://chatgpt.com/codex/settings/usage"
      }
    ]
  }),
  parameterizedMessage({
    id: "tui.status-line.context-remaining",
    ftlKey: "status-line-context-remaining",
    surface: "status-line",
    path: STATUS_SURFACES_PATH,
    symbol: "ChatWidget::status_line_value_for_item",
    anchor: 'format!("Context {remaining}% left")',
    english: "Context {percent}% left",
    args: [{ name: "percent", type: "integer", sample: 42 }]
  }),
  parameterizedMessage({
    id: "tui.status-line.context-used",
    ftlKey: "status-line-context-used",
    surface: "status-line",
    path: STATUS_SURFACES_PATH,
    symbol: "ChatWidget::status_line_value_for_item",
    anchor: 'format!("Context {used}% used")',
    english: "Context {percent}% used",
    args: [{ name: "percent", type: "integer", sample: 58 }]
  }),
  parameterizedMessage({
    id: "tui.status-line.tokens-used",
    ftlKey: "status-line-tokens-used",
    surface: "status-line",
    path: STATUS_SURFACES_PATH,
    symbol: "ChatWidget::status_line_value_for_item",
    anchor: 'Some(format!("{} used", format_tokens_compact(total)))',
    english: "{tokens} used",
    args: [{ name: "tokens", type: "string", sample: "12.3K" }]
  }),
  parameterizedMessage({
    id: "tui.footer.context-remaining",
    ftlKey: "footer-context-remaining",
    surface: "footer",
    path: FOOTER_PATH,
    symbol: "context_window_line",
    anchor: 'format!("{percent}% context left")',
    english: "{percent}% context left",
    args: [{ name: "percent", type: "integer", sample: 42 }]
  }),
  parameterizedMessage({
    id: "tui.footer.tokens-used",
    ftlKey: "footer-tokens-used",
    surface: "footer",
    path: FOOTER_PATH,
    symbol: "context_window_line",
    anchor: 'format!("{used_fmt} used")',
    english: "{tokens} used",
    args: [{ name: "tokens", type: "string", sample: "12.3K" }]
  }),
  parameterizedMessage({
    id: "tui.slash-command.unrecognized",
    ftlKey: "slash-unrecognized-command",
    surface: "slash-command",
    path: CHAT_COMPOSER_PATH,
    symbol: "ChatComposer::submit",
    anchor:
      'r#"Unrecognized command \'/{name}\'. Type "/" for a list of supported commands."#',
    english: "Unrecognized command '/{name}'. Type \"/\" for a list of supported commands.",
    args: [{ name: "name", type: "string", sample: "sdsd" }]
  })
];

export const MESSAGE_SPECS = [
  plainMessage({
    id: "tui.status-line.setup.use-theme-colors",
    ftlKey: "status-line-use-theme-colors",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Use theme colors".to_string()',
    english: "Use theme colors"
  }),
  plainMessage({
    id: "tui.status-line.setup.apply-theme-colors",
    ftlKey: "status-line-apply-theme-colors",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Apply colors from the active /theme".to_string()',
    english: "Apply colors from the active /theme"
  }),
  plainMessage({
    id: "tui.status-line.setup.configure-title",
    ftlKey: "status-line-configure-title",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Configure Status Line".to_string()',
    english: "Configure Status Line"
  }),
  plainMessage({
    id: "tui.status-line.setup.select-items-description",
    ftlKey: "status-line-select-items-description",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Select which items to display in the status line.".to_string()',
    english: "Select which items to display in the status line."
  }),
  plainMessage({
    id: "tui.onboarding.auth.paid-plan-intro",
    ftlKey: "onboarding-paid-plan-intro",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Sign in with ChatGPT to use Codex as part of your paid plan".into()',
    english: "Sign in with ChatGPT to use Codex as part of your paid plan"
  }),
  plainMessage({
    id: "tui.onboarding.auth.api-key-billing-intro",
    ftlKey: "onboarding-api-key-billing-intro",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"or connect an API key for usage-based billing".into()',
    english: "or connect an API key for usage-based billing"
  }),
  plainMessage({
    id: "tui.onboarding.auth.sign-in-chatgpt",
    ftlKey: "onboarding-sign-in-chatgpt",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Sign in with ChatGPT",',
    english: "Sign in with ChatGPT"
  }),
  plainMessage({
    id: "tui.onboarding.auth.provide-api-key",
    ftlKey: "onboarding-provide-api-key",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Provide your own API key",',
    english: "Provide your own API key"
  }),
  plainMessage({
    id: "tui.onboarding.auth.pay-for-usage",
    ftlKey: "onboarding-pay-for-usage",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Pay for what you use",',
    english: "Pay for what you use"
  }),
  plainMessage({
    id: "tui.onboarding.auth.api-key-disabled-workspace",
    ftlKey: "onboarding-api-key-disabled-workspace",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor:
      '"  API key login is disabled by this workspace. Sign in with ChatGPT to continue."',
    english:
      "  API key login is disabled by this workspace. Sign in with ChatGPT to continue."
  }),
  ...STATUS_CARD_SPECS,
  plainMessage({
    id: "tui.command-popup.no-matches",
    ftlKey: "command-popup-no-matches",
    surface: "slash-command-popup",
    path: COMMAND_POPUP_PATH,
    symbol: "CommandPopup::render_ref",
    anchor: '"no matches"',
    english: "no matches"
  }),
  ...APPROVAL_OVERLAY_SPECS,
  ...COMPOSER_PLACEHOLDER_SPECS,
  ...ADDITIONAL_VISIBLE_SPECS,
  ...SLASH_DESCRIPTION_SPECS,
  {
    id: "tui.history.worked-for",
    ftlKey: "history-worked-for",
    surface: "history",
    kind: "parameterized",
    translation: "required",
    mvpStatus: "wired",
    path: "codex-rs/tui/src/history_cell/separators.rs",
    symbol: "FinalMessageSeparator",
    anchor: 'format!("Worked for {elapsed_seconds}")',
    english: "Worked for {duration}",
    args: [{ name: "duration", type: "string", sample: "7m 57s" }],
    expectedOccurrences: 2
  }
];
