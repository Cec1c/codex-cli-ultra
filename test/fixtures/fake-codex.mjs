const CHINESE = {
  "tui.status-line.setup.use-theme-colors": "使用主题颜色",
  "tui.status-line.setup.apply-theme-colors": "应用当前 /theme 的颜色",
  "tui.status-line.setup.configure-title": "配置状态栏",
  "tui.status-line.setup.select-items-description": "选择要显示在状态栏中的项目。",
  "tui.history.worked-for": "加班了 7m 57s"
};

const ENGLISH = {
  "tui.status-line.setup.use-theme-colors": "Use theme colors",
  "tui.status-line.setup.apply-theme-colors": "Apply colors from the active /theme",
  "tui.status-line.setup.configure-title": "Configure Status Line",
  "tui.status-line.setup.select-items-description": "Select which items to display in the status line.",
  "tui.history.worked-for": "Worked for 7m 57s"
};

if (!process.env.NODE_TEST_CONTEXT) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("codex-cli 0.144.1\n");
  } else if (args.length === 1 && args[0] === "--ultra-i18n-self-check") {
    const active =
      process.env.CODEX_ULTRA_LOCALE === "zh-CN" &&
      !String(process.env.CODEX_ULTRA_FTL_PATH).includes(".missing-");
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      active,
      locale: active ? "zh-CN" : null,
      messages: active ? CHINESE : ENGLISH
    }));
  } else {
    process.stderr.write("unsupported fake Codex arguments\n");
    process.exitCode = 2;
  }
}
