# Contributing / 贡献指南

> Contributing a non-Chinese locale? English is enough. Start from the English template; no Chinese knowledge is required.

## Add a language pack

1. Create `packages/languages/<locale>/`.
2. Copy `templates/languages/messages.en-US.ftl` to `messages.ftl`.
3. Translate message values. Keep every message key and Fluent variable such as `{ $error }` unchanged.
4. Add `manifest.json` with the locale, display names, license, supported i18n API range, and the SHA256 of `messages.ftl`.
5. Validate the pack:

```powershell
node src/cli.mjs language validate `
  --pack packages/languages/<locale> `
  --catalog research/codex-0.144.5/tui-messages.jsonl `
  --template templates/languages/messages.en-US.ftl
```

The Simplified Chinese pack at `packages/languages/zh-CN/` is the reference implementation.

## Repository boundaries

- Rust/TUI i18n interfaces and compiled Codex behavior belong in [`Cec1c/codex`](https://github.com/Cec1c/codex).
- FTL language packs, themes, installers, the manager TUI, and update policy belong in this repository.
- When adding a new visible Codex message, update the English template, source catalog, language packs, and tests together.

## Checks

Run the checks that match your change:

```powershell
# Node manager, installer, language packs
npm test
npm run build

# Manager TUI
cd tui
cargo fmt --all -- --check
cargo test --locked
```

For fork call-site work, use:

```powershell
npm run ftl:audit -- <Codex-source-directory>
npm run text:audit -- <Codex-source-directory>
```

## Pull requests

- Keep the change focused.
- State the tested Codex, CCU, and i18n API versions when compatibility is relevant.
- Include a screenshot for visible UI changes.
- English Issues, pull requests, documentation, and commit messages are welcome.

## 中文说明

- 新语言包请从英文模板开始，不需要先翻译或理解中文语言包。
- 不要修改消息键和 Fluent 变量名；只翻译等号右侧的内容。
- 新增 Codex 可见文本时，请同时更新英文模板、消息目录、相关语言包和测试。
- 提交前运行对应的 Node 或 Rust 检查；界面改动请附截图。
