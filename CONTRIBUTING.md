# 贡献指南 / Contributing

## 中文

Codex CLI Ultra 把机制和内容分开维护：

- Rust/TUI 扩展接口进入 `Cec1c/codex` fork。
- FTL 翻译、主题包、安装器、管理 TUI 和更新策略进入本仓库。
- 翻译必须与 `templates/languages/messages.en-US.ftl` 保持完全相同的消息键和 Fluent 参数名。
- 新增可见文本时，请同时更新英文模板、语言包、源码目录和对应测试；不要只增加 FTL 而不接调用点。
- 提交前至少运行 `npm run language:validate` 和 `npm test`。核对当前 fork 调用点时运行 `npm run ftl:audit -- <Codex 源码目录>`；修改管理执行器时再运行 `npm run build`；扩展可见文本调查时运行 `npm run text:audit -- <Codex 源码目录>`；修改管理 TUI 时运行 `cargo test --locked`（`tui/`）。

提交信息优先使用简洁中文，例如：`feat: 添加日语语言包`。

## English

Codex CLI Ultra keeps mechanisms and content separate:

- Rust/TUI extension points belong in the `Cec1c/codex` fork.
- FTL translations, theme packs, installers, the manager TUI, and update policy belong here.
- Translations must use exactly the same message keys and Fluent variables as `templates/languages/messages.en-US.ftl`.
- When adding visible text, update the English template, language pack, source catalog, and tests together.
- Before submitting, run at least `npm run language:validate` and `npm test`. Use `npm run ftl:audit -- <Codex source directory>` to verify current fork call sites, `npm run build` for manager changes, `npm run text:audit -- <Codex source directory>` for broader visible-text research, and `cargo test --locked` from `tui/` for manager TUI changes.

Keep commits focused and describe the user-visible result.
