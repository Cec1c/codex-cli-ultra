use fluent_bundle::FluentArgs;
use pretty_assertions::assert_eq;
use serde_json::Value;

use super::Localizer;
use super::self_check_json;

const ZH_CN_FTL: &str = r#"
tui--status-line--setup--use-theme-colors = 使用主题颜色
tui--status-line--setup--apply-theme-colors = 应用当前 /theme 的颜色
tui--status-line--setup--configure-title = 配置状态栏
tui--status-line--setup--select-items-description = 选择要显示在状态栏中的项目。
tui--history--worked-for = 加班了 { $duration }
"#;

#[test]
fn static_message_uses_fluent_translation() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("tui.status-line.setup.configure-title", None, || {
            "Configure Status Line".to_string()
        },),
        "配置状态栏"
    );
}

#[test]
fn duration_argument_is_formatted() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);
    let mut args = FluentArgs::new();
    args.set("duration", "7m 57s");

    assert_eq!(
        localizer.text("tui.history.worked-for", Some(&args), || {
            "Worked for 7m 57s".to_string()
        }),
        "加班了 7m 57s"
    );
}

#[test]
fn missing_message_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("ultra.i18n.missing-key", None, || {
            "English fallback".to_string()
        }),
        "English fallback"
    );
}

#[test]
fn whitespace_only_message_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", r#"probe--empty = { "   " }"#);

    assert_eq!(
        localizer.text("probe.empty", None, || "English fallback".to_string()),
        "English fallback"
    );
}

#[test]
fn malformed_resource_disables_the_whole_localizer() {
    let localizer = Localizer::from_ftl(
        "zh-CN",
        "tui--status-line--setup--configure-title = 配置状态栏\nbroken = {",
    );

    assert_eq!(
        localizer.text("tui.status-line.setup.configure-title", None, || {
            "Configure Status Line".to_string()
        },),
        "Configure Status Line"
    );
}

#[test]
fn missing_fluent_argument_uses_english_closure() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);

    assert_eq!(
        localizer.text("tui.history.worked-for", None, || {
            "Worked for 7m 57s".to_string()
        }),
        "Worked for 7m 57s"
    );
}

#[test]
fn invalid_locale_disables_the_whole_localizer() {
    let localizer = Localizer::from_ftl("not a locale", ZH_CN_FTL);

    assert_eq!(
        localizer.text("tui.status-line.setup.configure-title", None, || {
            "Configure Status Line".to_string()
        },),
        "Configure Status Line"
    );
}

#[test]
fn self_check_includes_all_wired_messages_and_missing_key_fallback() {
    let localizer = Localizer::from_ftl("zh-CN", ZH_CN_FTL);
    let payload: Value = serde_json::from_str(&self_check_json(&localizer)).expect("valid JSON");

    assert_eq!(payload["schemaVersion"], 1);
    assert_eq!(payload["active"], true);
    assert_eq!(payload["locale"], "zh-CN");
    assert_eq!(
        payload["messages"]["tui.status-line.setup.use-theme-colors"],
        "使用主题颜色"
    );
    assert_eq!(
        payload["messages"]["tui.status-line.setup.apply-theme-colors"],
        "应用当前 /theme 的颜色"
    );
    assert_eq!(
        payload["messages"]["tui.status-line.setup.configure-title"],
        "配置状态栏"
    );
    assert_eq!(
        payload["messages"]["tui.status-line.setup.select-items-description"],
        "选择要显示在状态栏中的项目。"
    );
    assert_eq!(
        payload["messages"]["tui.history.worked-for"],
        "加班了 7m 57s"
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
}
