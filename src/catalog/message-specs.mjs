const STATUS_LINE_SETUP_PATH =
  "codex-rs/tui/src/bottom_pane/status_line_setup.rs";
const ONBOARDING_AUTH_PATH = "codex-rs/tui/src/onboarding/auth.rs";

function plainMessage({
  id,
  surface,
  path,
  symbol,
  anchor,
  english,
  mvpStatus
}) {
  return {
    id,
    ftlKey: id.replaceAll(".", "--"),
    surface,
    kind: "plain",
    translation: "required",
    mvpStatus,
    path,
    symbol,
    anchor,
    english
  };
}

export const MESSAGE_SPECS = [
  plainMessage({
    id: "tui.status-line.setup.use-theme-colors",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Use theme colors".to_string()',
    english: "Use theme colors",
    mvpStatus: "wired"
  }),
  plainMessage({
    id: "tui.status-line.setup.apply-theme-colors",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Apply colors from the active /theme".to_string()',
    english: "Apply colors from the active /theme",
    mvpStatus: "wired"
  }),
  plainMessage({
    id: "tui.status-line.setup.configure-title",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Configure Status Line".to_string()',
    english: "Configure Status Line",
    mvpStatus: "wired"
  }),
  plainMessage({
    id: "tui.status-line.setup.select-items-description",
    surface: "status-line",
    path: STATUS_LINE_SETUP_PATH,
    symbol: "StatusLineSetupView::new",
    anchor: '"Select which items to display in the status line.".to_string()',
    english: "Select which items to display in the status line.",
    mvpStatus: "wired"
  }),
  plainMessage({
    id: "tui.onboarding.auth.paid-plan-intro",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor:
      '"Sign in with ChatGPT to use Codex as part of your paid plan".into()',
    english: "Sign in with ChatGPT to use Codex as part of your paid plan",
    mvpStatus: "catalogued"
  }),
  plainMessage({
    id: "tui.onboarding.auth.api-key-billing-intro",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"or connect an API key for usage-based billing".into()',
    english: "or connect an API key for usage-based billing",
    mvpStatus: "catalogued"
  }),
  plainMessage({
    id: "tui.onboarding.auth.sign-in-chatgpt",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Sign in with ChatGPT",',
    english: "Sign in with ChatGPT",
    mvpStatus: "catalogued"
  }),
  plainMessage({
    id: "tui.onboarding.auth.provide-api-key",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Provide your own API key",',
    english: "Provide your own API key",
    mvpStatus: "catalogued"
  }),
  plainMessage({
    id: "tui.onboarding.auth.pay-for-usage",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor: '"Pay for what you use",',
    english: "Pay for what you use",
    mvpStatus: "catalogued"
  }),
  plainMessage({
    id: "tui.onboarding.auth.api-key-disabled-workspace",
    surface: "onboarding",
    path: ONBOARDING_AUTH_PATH,
    symbol: "AuthWidget::render_pick_mode",
    anchor:
      '"  API key login is disabled by this workspace. Sign in with ChatGPT to continue."',
    english:
      "  API key login is disabled by this workspace. Sign in with ChatGPT to continue.",
    mvpStatus: "catalogued"
  })
];
