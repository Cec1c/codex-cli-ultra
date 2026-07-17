# 状态栏设置
status-line-use-theme-colors = 使用主题颜色
status-line-apply-theme-colors = 应用当前 /theme 的颜色
status-line-configure-title = 配置状态栏
status-line-select-items-description = 选择要显示在状态栏中的项目。

# 登录引导
onboarding-paid-plan-intro = 登录 ChatGPT，将 Codex 作为付费方案的一部分使用
onboarding-api-key-billing-intro = 或连接 API 密钥，按使用量计费
onboarding-sign-in-chatgpt = 登录 ChatGPT
onboarding-provide-api-key = 提供您自己的 API 密钥
onboarding-pay-for-usage = 按使用量付费
onboarding-api-key-disabled-workspace = 此工作区已禁用 API 密钥登录。请登录 ChatGPT 以继续。

# 会话状态卡
status-card-model-label = 模型
status-card-directory-label = 目录
status-card-permissions-label = 权限
status-card-agents-label = 项目说明
status-card-model-provider-label = 模型提供方
status-card-account-label = 账户
status-card-thread-name-label = 对话名称
status-card-session-label = 会话
status-card-forked-from-label = 分支来源
status-card-collaboration-mode-label = 协作模式
status-card-token-usage-label = 令牌用量
status-card-context-window-label = 上下文窗口
status-card-remote-label = 远程连接
status-card-limits-label = 用量限制
status-card-warning-label = 警告
status-card-limits-unavailable = 此账户暂不可用
status-card-limits-stale-run-status = 用量限制可能已过期，请稍后再次运行 /status。
status-card-limits-stale-new-turn = 用量限制可能已过期，请开始新一轮对话以刷新。
status-card-limits-refresh-requested = 已请求刷新，请稍后再次运行 /status。
status-card-limits-data-pending = 数据暂未就绪
status-card-api-key-configured = 已配置 API 密钥（运行 codex login 可使用 ChatGPT）
status-card-usage-note = 访问 { $url } 查看最新的用量限制和额度信息

# 启动会话卡片
session-card-model-label = 模型：
session-card-directory-label = 目录：
session-card-permissions-label = 权限：
session-card-change-model-hint = 更改模型

# 启动提示
tooltip-label = 提示：
tooltip-rename-threads = 使用 /rename 重命名对话，之后恢复对话时更容易找到。

# MCP 启动
mcp-client-failed-to-start = MCP 客户端 `{ $name }` 启动失败

# 输入框占位文本
composer-explain-codebase = 解释此代码库
composer-summarize-commits = 总结最近的提交
composer-implement-feature = 实现一个新功能
composer-fix-file-bug = 查找并修复 @filename 中的错误
composer-write-file-tests = 为 @filename 编写测试
composer-improve-file-docs = 改进 @filename 中的文档
composer-review-current-changes = 使用 /review 审查当前更改
composer-list-skills = 使用 /skills 查看可用技能
composer-side-check-compatibility = 检查最近修改的函数是否兼容
composer-side-count-modified-files = 已修改多少个文件？
composer-side-check-scale = 此算法能否良好扩展？

# 底部状态条
status-line-context-remaining = 上下文剩余 { $percent }%
status-line-context-used = 上下文已用 { $percent }%
status-line-tokens-used = 已用 { $tokens }
footer-context-remaining = 上下文剩余 { $percent }%
footer-tokens-used = 已用 { $tokens }

# 斜杠命令面板
command-popup-no-matches = 无匹配项
slash-unrecognized-command = 无法识别命令“/{ $name }”。输入“/”查看支持的命令列表。
slash-feedback-description = 向维护者发送日志
slash-new-description = 在当前对话中开始新聊天
slash-init-description = 创建包含 Codex 项目说明的 AGENTS.md 文件
slash-compact-description = 总结对话，避免达到上下文上限
slash-review-description = 审查当前更改并查找问题
slash-rename-description = 重命名当前对话
slash-resume-description = 恢复已保存的聊天
slash-archive-description = 归档本次会话并退出
slash-delete-description = 永久删除本次会话并退出
slash-clear-description = 清空终端并开始新聊天
slash-fork-description = 从当前聊天创建分支
slash-app-description = 在 Codex Desktop 中继续本次会话
slash-exit-description = 退出 Codex
slash-copy-description = 将上一条回复复制为 Markdown
slash-raw-description = 切换原始回滚区模式，方便在终端中选择和复制
slash-diff-description = 显示 Git 差异，包括未跟踪文件
slash-mention-description = 引用一个文件
slash-skills-description = 使用技能改进 Codex 执行特定任务的方式
slash-import-description = 从 Claude Code 导入配置、当前项目和最近聊天
slash-hooks-description = 查看和管理生命周期钩子
slash-status-description = 显示当前会话配置和令牌用量
slash-usage-description = 查看账户用量或使用用量上限重置
slash-debug-config-description = 显示配置层和约束来源以便调试
slash-title-description = 配置终端标题中显示的项目
slash-statusline-description = 配置状态栏中显示的项目
slash-theme-description = 选择语法高亮主题
slash-language-description = 查看或选择显示语言
slash-pets-description = 选择或隐藏终端宠物
slash-ps-description = 列出后台终端
slash-stop-description = 停止所有后台终端
slash-internal-debug-description = 请勿使用
slash-model-description = 选择模型和推理强度
slash-ide-description = 包含 IDE 中的当前选区、已打开文件和其他上下文
slash-personality-description = 选择 Codex 的沟通风格
slash-plan-description = 切换到计划模式
slash-goal-description = 设置或查看长时间任务的目标
slash-agent-description = 切换当前智能体线程
slash-side-description = 在临时分支中开始旁路对话
slash-permissions-description = 选择允许 Codex 执行的操作
slash-keymap-description = 重新映射 TUI 快捷键
slash-vim-description = 切换输入框的 Vim 模式
slash-elevate-sandbox-description = 配置增强权限的智能体沙箱
slash-sandbox-read-root-description = 允许沙箱读取目录：/sandbox-add-read-dir <绝对路径>
slash-experimental-description = 切换实验性功能
slash-approve-description = 批准最近一次自动审查拒绝后的单次重试
slash-memories-description = 配置记忆的使用和生成
slash-mcp-description = 列出已配置的 MCP 工具；使用 /mcp verbose 查看详情
slash-apps-description = 管理应用
slash-plugins-description = 浏览插件
slash-logout-description = 退出 Codex 登录
slash-rollout-description = 输出 rollout 文件路径
slash-test-approval-description = 测试权限审批请求

# 审批界面
approval-run-command-title = 是否运行以下命令？
approval-grant-permissions-title = 是否授予以下权限？
approval-apply-patch-title = 是否进行以下修改？
approval-yes-once = 是，仅本次允许
approval-yes-proceed = 是，继续
approval-allow-host-conversation = 是，在本次对话中允许此主机
approval-allow-permissions-session = 是，在本次会话中允许这些权限
approval-allow-command-session = 是，本次会话不再询问此命令
approval-allow-host-future = 是，以后允许此主机
approval-block-host-future = 否，以后阻止此主机
approval-decline-command = 否，不运行并继续
approval-tell-codex = 否，并告诉 Codex 如何调整
approval-allow-files-session = 是，这些文件不再询问
approval-grant-permissions-turn = 是，本轮授予这些权限
approval-grant-strict-review-turn = 是，本轮授予并启用严格自动审查
approval-grant-permissions-session = 是，本次会话授予这些权限
approval-continue-without-permissions = 否，不授予权限并继续
approval-provide-requested-info = 是，提供所需信息
approval-continue-without-info = 否，不提供但继续
approval-cancel-request = 取消此请求

# 历史记录
history-worked-for = 工作了 { $duration }

# Ultra 语言选择入口
language-current = 当前语言：{ $locale }
language-help = 使用 /language zh-CN 或 /language en 选择语言；重启 Codex 后生效。
language-saved = 已选择 { $locale }；重启 Codex 后生效。
language-unsupported = 语言 { $locale } 未安装或不兼容。使用 /language 查看可用选项。
language-picker-title = 选择语言
language-picker-subtitle = 语言包由 CCU 管理。选择后请重启 Codex。
language-picker-english = 英语
language-picker-english-description = Codex 内置，始终可用。
