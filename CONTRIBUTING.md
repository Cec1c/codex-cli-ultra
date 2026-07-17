# 贡献指南 / Contributing

## 中文

Codex CLI Ultra 把机制和内容分开维护：

- Rust/TUI 扩展接口进入 `Cec1c/codex` fork。
- FTL 翻译、主题包、安装器、管理 TUI 和更新策略进入本仓库。
- 翻译必须保留 Fluent 参数名，并通过英文逐条回退测试。
- 新增可见文本时，请同时更新文本审计、语言包和对应测试；不要只增加 FTL 而不接调用点。
- 提交前运行 `npm test`、`npm run build`、`npm run text:audit -- .upstream/codex`，以及 `cargo test --locked`（`tui/`）。

提交信息优先使用简洁中文，例如：`feat: 添加日语语言包`。

## English

Codex CLI Ultra keeps mechanisms and content separate:

- Rust/TUI extension points belong in the `Cec1c/codex` fork.
- FTL translations, theme packs, installers, the manager TUI, and update policy belong here.
- Translations must preserve Fluent argument names and pass per-message English fallback tests.
- When adding visible text, update the text audit, language pack, and tests together.
- Before submitting, run `npm test`, `npm run build`, `npm run text:audit -- .upstream/codex`, and `cargo test --locked` from `tui/`.

Keep commits focused and describe the user-visible result.
