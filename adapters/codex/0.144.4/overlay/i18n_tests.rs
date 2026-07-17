use fluent_bundle::FluentArgs;
use pretty_assertions::assert_eq;
use serde_json::Value;

use super::Localizer;
use super::normalized_language;
use super::self_check_json;

const ZH_CN_FTL: &str = r#"
status-line-use-theme-colors = 使用主题颜色
status-line-apply-theme-colors = 应用当前 /theme 的颜色
status-line-configure-title = 配置状态栏
status-line-select-items-description = 选择要显示在状态栏中的项目。
onboarding-paid-plan-intro = 登录 ChatGPT，将 Codex 作为付费方案的一部分使用
onboarding-api-key-billing-intro = 或连接 API 密钥，按使用量计费
onboarding-sign-in-chatgpt = 登录 ChatGPT
onboarding-provide-api-key = 提供您自己的 API 密钥
onboarding-pay-for-usage = 按使用量付费
onboarding-api-key-disabled-workspace = 此工作区已禁用 API 密钥登录。请登录 ChatGPT 以继续。
status-card-model-label = 模型
status-card-limits-stale-run-status = 用量限制可能已过期，请稍后再次运行 /status。
command-popup-no-matches = 无匹配项
approval-run-command-title = 是否运行以下命令？
approval-yes-proceed = 是，继续
session-card-model-label = 模型：
tooltip-label = 提示：
composer-write-file-tests = 为 @filename 编写测试
mcp-client-failed-to-start = MCP 客户端 `{ $name }` 启动失败
status-card-usage-note = 访问 { $url } 查看最新的用量限制和额度信息
status-line-context-used = 上下文已用 { $percent }%
slash-unrecognized-command = 无法识别命令“/{ $name }”。输入“/”查看支持的命令列表。
slash-model-description = 选择模型和推理强度
slash-language-description = 查看或选择显示语言
history-worked-for = 工作了 { $duration }
language-current = 当前语言：{ $locale }
language-help = 使用 /language zh-CN 或 /language en 选择语言；重启 Codex 后生效。
language-saved = 已选择 { $locale }；重启 Codex 后生效。
language-unsupported = 不支持语言 { $locale }。可用选项：zh-CN、en。
"#;

#[test]
fn language_aliases_are_normalized() {
    assert_eq!(normalized_language("zh-cn"), Some("zh-CN"));
    assert_eq!(normalized_language("English"), Some("en"));
    assert_eq!(normalized_language("fr-FR"), None);
}

#[test]
fn static_message_uses_fluent_translation() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("status-line-configure-title", None, || {
            "Configure Status Line".to_string()
        }),
        "配置状态栏"
    );
}

#[test]
fn duration_argument_is_formatted() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);
    let mut args = FluentArgs::new();
    args.set("duration", "7m 57s");

    assert_eq!(
        localizer.text("history-worked-for", Some(&args), || {
            "Worked for 7m 57s".to_string()
        }),
        "工作了 7m 57s"
    );
}

#[test]
fn missing_message_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("ultra-i18n-missing-key", None, || {
            "English fallback".to_string()
        }),
        "English fallback"
    );
}

#[test]
fn whitespace_only_message_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", r#"probe-empty = { "   " }"#);

    assert_eq!(
        localizer.text("probe-empty", None, || "English fallback".to_string()),
        "English fallback"
    );
}

#[test]
fn malformed_resource_disables_the_whole_localizer() {
    let localizer = Localizer::from_ftl(
        "zh-CN",
        "status-line-configure-title = 配置状态栏\nbroken = {",
    );

    assert_eq!(
        localizer.text("status-line-configure-title", None, || {
            "Configure Status Line".to_string()
        }),
        "Configure Status Line"
    );
}

#[test]
fn missing_fluent_argument_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("history-worked-for", None, || {
            "Worked for 7m 57s".to_string()
        }),
        "Worked for 7m 57s"
    );
}

#[test]
fn invalid_locale_disables_the_whole_localizer() {
    let localizer = Localizer::from_ftl("not a locale", ZH_CN_FTL);

    assert_eq!(
        localizer.text("status-line-configure-title", None, || {
            "Configure Status Line".to_string()
        }),
        "Configure Status Line"
    );
}

#[test]
fn self_check_includes_catalog_messages_and_missing_key_fallback() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);
    let payload: Value = serde_json::from_str(&self_check_json(&localizer)).expect("valid JSON");

    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["active"], true);
    assert_eq!(payload["locale"], "zh-CN");
    assert_eq!(
        payload["messages"]["tui.status-line.setup.configure-title"],
        "配置状态栏"
    );
    assert_eq!(
        payload["messages"]["tui.onboarding.auth.sign-in-chatgpt"],
        "登录 ChatGPT"
    );
    assert_eq!(payload["messages"]["tui.status-card.model-label"], "模型");
    assert_eq!(
        payload["messages"]["tui.command-popup.no-matches"],
        "无匹配项"
    );
    assert_eq!(
        payload["messages"]["tui.approval.run-command-title"],
        "是否运行以下命令？"
    );
    assert_eq!(
        payload["messages"]["tui.composer.placeholder.write-file-tests"],
        "为 @filename 编写测试"
    );
    assert_eq!(
        payload["messages"]["tui.mcp.client-failed-to-start"],
        "MCP 客户端 `openaiDeveloperDocs` 启动失败"
    );
    assert_eq!(
        payload["messages"]["tui.status-line.context-used"],
        "上下文已用 58%"
    );
    assert_eq!(
        payload["messages"]["tui.slash-command.unrecognized"],
        "无法识别命令“/sdsd”。输入“/”查看支持的命令列表。"
    );
    assert_eq!(
        payload["messages"]["tui.slash-command.description.model"],
        "选择模型和推理强度"
    );
    assert_eq!(
        payload["messages"]["tui.slash-command.description.language"],
        "查看或选择显示语言"
    );
    assert_eq!(
        payload["messages"]["tui.history.worked-for"],
        "工作了 7m 57s"
    );
    assert_eq!(
        payload["messages"].as_object().map(|value| value.len()),
        Some(131)
    );
    assert_eq!(
        payload["messages"]["ultra.i18n.missing-key"],
        "English fallback"
    );
}

#[test]
fn english_self_check_is_inactive() {
    let payload: Value =
        serde_json::from_str(&self_check_json(&Localizer::english())).expect("valid JSON");

    assert_eq!(payload["active"], false);
    assert_eq!(payload["locale"], Value::Null);
    assert_eq!(
        payload["messages"]["tui.history.worked-for"],
        "Worked for 7m 57s"
    );
    assert_eq!(
        payload["messages"]["tui.slash-command.description.model"],
        "choose what model and reasoning effort to use"
    );
}
