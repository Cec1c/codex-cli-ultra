use pretty_assertions::assert_eq;
use std::fs;
use std::path::Path;

use super::Translator;

#[test]
fn valid_catalog_translates_known_message() {
    let translator = Translator::from_json_str(
        r#"{"messages":{"tui.status-line.setup.configure-title":"配置状态栏"}}"#,
    );

    assert_eq!(
        translator.text(
            "tui.status-line.setup.configure-title",
            "Configure Status Line",
        ),
        "配置状态栏"
    );
}

#[test]
fn invalid_catalog_falls_back_to_english() {
    let translator = Translator::from_json_str("{");

    assert_eq!(
        translator.text(
            "tui.status-line.setup.configure-title",
            "Configure Status Line",
        ),
        "Configure Status Line"
    );
}

#[test]
fn missing_or_empty_message_falls_back_to_english() {
    let translator =
        Translator::from_json_str(r#"{"messages":{"tui.status-line.setup.configure-title":""}}"#);

    assert_eq!(translator.text("missing", "English"), "English");
    assert_eq!(
        translator.text(
            "tui.status-line.setup.configure-title",
            "Configure Status Line",
        ),
        "Configure Status Line"
    );
}

#[test]
fn catalog_path_loads_a_valid_file() {
    let temp_dir = tempfile::tempdir().expect("create temp directory");
    let catalog_path = temp_dir.path().join("compiled-messages.json");
    fs::write(
        &catalog_path,
        r#"{"messages":{"tui.status-line.setup.configure-title":"配置状态栏"}}"#,
    )
    .expect("write catalog");

    let translator = Translator::from_catalog_path(&catalog_path);

    assert_eq!(
        translator.text(
            "tui.status-line.setup.configure-title",
            "Configure Status Line",
        ),
        "配置状态栏"
    );
}

#[test]
fn missing_catalog_configuration_falls_back_to_english() {
    let translator = Translator::default();

    assert_eq!(translator.text("missing", "English"), "English");
}

#[test]
fn unreadable_catalog_file_falls_back_to_english() {
    let translator = Translator::from_catalog_path(Path::new("missing-codex-ultra-catalog.json"));

    assert_eq!(translator.text("missing", "English"), "English");
}
