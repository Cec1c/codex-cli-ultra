# FTL 语言包模板

当前翻译合同由三层组成：

- `templates/languages/messages.en-US.ftl`：完整英文模板，定义全部消息键和 Fluent 变量。
- `packages/languages/zh-CN/messages.ftl`：简体中文参考实现。
- `research/codex-0.144.5/tui-messages.jsonl`：129 条可追溯到上游源码位置的消息目录。

英文模板和简体中文包目前都包含 396 个实际使用的消息键：129 个来自可追溯源码目录，60 个为动态状态栏键，207 个由 Rust 运行时直接调用。模板是翻译合同，不会作为英语语言包安装；英语仍由 Codex 二进制内置，并在外部语言包缺失或单条翻译无效时回退。

## 新增或维护翻译

1. 复制英文模板，保持消息 ID 不变。
2. 只翻译等号右侧的文本，保留 `{ $name }` 形式的 Fluent 变量。
3. 更新语言包 `manifest.json` 中的 locale、显示名、许可证和 `messages.ftl` SHA256。
4. 运行完整校验：

```powershell
npm run language:validate
npm test
npm run ftl:audit -- <Codex fork 源码目录>
```

校验器会拒绝：

- 模板中存在但翻译包缺失的键；
- 翻译包自行增加、模板未声明的键；
- Fluent 变量缺失、改名或增加；
- 空翻译、无效 UTF-8、无效 Fluent、资源哈希不匹配；
- 正式源码目录中的 wired 消息缺失或无法使用样例参数格式化。

`ftl:audit` 还会把模板键按上游目录、动态状态栏键和 Rust 直接调用点分类，并在发现没有当前调用点的死键时失败。

## 本地同步

在仓库根目录运行以下命令，会先执行完整模板校验，再原子同步语言包和主题包：

```powershell
$env:CODEX_ULTRA_HOME = Join-Path $env:LOCALAPPDATA 'codex-cli-ultra'
node src/manage-main.mjs content sync --source . --json
```

正在运行的 Codex 会话不会热重载 FTL。无需结束旧会话；新启动一个 Codex 进程即可验证更新后的文本。

## 命令二级界面覆盖

下一版 fork 已把以下二级界面接入 FTL：

- `/model` 的模型列表、推理强度、模型说明、Plan 模式应用范围、额度警告和空状态；
- 全部本地启动 Tips，包括 `*New* Build faster with Codex.`；
- 通用选择器的当前/默认标记、无匹配状态和确认/返回提示；
- `/language` 的空状态、CCU 安装提示、locale 说明、错误标题和搜索占位；
- `/review`、`/personality`、`/permissions` 的主要标题、选项、说明、警告和搜索提示。

`/apps`、`/plugins`、`/keymap`、`/experimental`、`/pets` 以及部分 MCP/用户输入弹窗仍需按相同方法继续审计。396 键合同只表示当前已声明键都有调用点，不应被理解为整个 TUI 已经没有任何裸英文。
