# `Worked for` 短语包创意 / `Worked for` Phrase-Pack Idea

> **状态：创意列表，尚未实现。** 当前 i18n MVP 不修改这段运行时文本。
>
> **Status: idea backlog, not implemented.** The current i18n MVP does not modify this runtime text.

## 目标 / Goal

Codex 完成一次实际工作后会显示类似 `Worked for 7m 57s` 的分隔文本。简体中文语言包可以把它翻译为 `加班了 7m 57s`，并允许维护一组轻量、可选的彩蛋短语。

After Codex completes concrete work, it can display a separator such as `Worked for 7m 57s`. A Simplified Chinese pack could render `加班了 7m 57s` and maintain a small optional set of playful phrases.

当前 Codex CLI 0.144.1 中有两个真实调用点：

Codex CLI 0.144.1 currently has two real call sites:

- `codex-rs/tui/src/history_cell/separators.rs:35`
- `codex-rs/tui/src/history_cell/separators.rs:63`

两处都使用 `format!("Worked for {elapsed_seconds}")`，因此未来应先抽取为同一个带参数消息，而不是分别做字符串替换。

Both use `format!("Worked for {elapsed_seconds}")`, so a future implementation should extract one parameterized message instead of patching the strings independently.

## 候选 JSON / Candidate JSON

```json
{
  "locale": "zh-CN",
  "phrases": [
    "加班了 {duration}",
    "又和代码较劲了 {duration}",
    "在代码矿井里待了 {duration}",
    "给仓库添砖加瓦 {duration}"
  ]
}
```

`{duration}` 必须保留，并继续使用 Codex 原有的紧凑时长格式。包无效、列表为空、占位符缺失或渲染失败时，应回退到 `Worked for {duration}`。

`{duration}` is required and keeps Codex's existing compact duration format. An invalid pack, empty list, missing placeholder, or rendering error falls back to `Worked for {duration}`.

## 选择规则 / Selection Rules

- 默认模式必须可重复，不能在每次重绘时随机换短语。

  The default mode must be reproducible and cannot choose a new phrase on every redraw.

- 可以提供“固定短语”和“稳定彩蛋”两种模式；稳定彩蛋使用会话内固定选择，避免快照抖动。

  A fixed-phrase mode and a stable-easter-egg mode may be offered. The latter keeps one choice stable within a session to avoid snapshot churn.

- 自动化快照默认使用固定短语 `加班了 {duration}`。

  Automated snapshots use the fixed phrase `加班了 {duration}` by default.

- 短语属于语言表达，主题包以后只能控制分隔符样式，不应偷偷改写语言包文本。

  Phrases belong to localization. A future theme pack may style the separator but should not silently rewrite language-pack text.

## 实现前置条件 / Prerequisites

1. i18n 运行时支持带参数消息，而不仅是当前 MVP 的纯文本键值。

   The i18n runtime supports parameterized messages, not only the MVP's plain string map.

2. 编译器验证 `{duration}` 的存在、数量和类型。

   The compiler validates the presence, count, and type of `{duration}`.

3. 两个调用点共用同一翻译接口，并有英文与 zh-CN 快照。

   Both call sites share one translation interface with English and zh-CN snapshots.

4. 无语言包、坏 JSON、空列表和未知模式全部安全回退到英文。

   Missing packs, malformed JSON, empty lists, and unknown modes all fall back safely to English.
