use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use fluent_bundle::FluentArgs;
use fluent_bundle::FluentResource;
use fluent_bundle::concurrent::FluentBundle;
use serde_json::json;
use unic_langid::LanguageIdentifier;

#[cfg(test)]
#[path = "i18n_tests.rs"]
mod tests;

pub(crate) struct Localizer {
    locale: Option<LanguageIdentifier>,
    bundle: Option<FluentBundle<FluentResource>>,
}

impl Localizer {
    pub(crate) fn english() -> Self {
        Self {
            locale: None,
            bundle: None,
        }
    }

    pub(crate) fn from_ftl(locale: &str, source: &str) -> Self {
        let Ok(locale) = locale.parse::<LanguageIdentifier>() else {
            return Self::english();
        };
        let Ok(resource) = FluentResource::try_new(source.to_string()) else {
            return Self::english();
        };
        let mut bundle = FluentBundle::new_concurrent(vec![locale.clone()]);
        bundle.set_use_isolating(false);
        if bundle.add_resource(resource).is_err() {
            return Self::english();
        }
        Self {
            locale: Some(locale),
            bundle: Some(bundle),
        }
    }

    pub(crate) fn from_environment() -> Self {
        let Ok(locale) = std::env::var("CODEX_ULTRA_LOCALE") else {
            return Self::english();
        };
        let Some(path) = std::env::var_os("CODEX_ULTRA_FTL_PATH") else {
            return Self::english();
        };
        let Ok(source) = fs::read_to_string(PathBuf::from(path)) else {
            return Self::english();
        };
        Self::from_ftl(&locale, &source)
    }

    pub(crate) fn text<F>(&self, id: &str, args: Option<&FluentArgs>, english: F) -> String
    where
        F: FnOnce() -> String,
    {
        let Some(bundle) = self.bundle.as_ref() else {
            return english();
        };
        let fluent_id = id.replace('.', "--");
        let Some(message) = bundle.get_message(&fluent_id) else {
            return english();
        };
        let Some(pattern) = message.value() else {
            return english();
        };
        let mut errors = Vec::new();
        let value = bundle.format_pattern(pattern, args, &mut errors);
        if !errors.is_empty() || value.trim().is_empty() {
            return english();
        }
        value.into_owned()
    }
}

impl Default for Localizer {
    fn default() -> Self {
        Self::english()
    }
}

pub(crate) fn global() -> &'static Localizer {
    static LOCALIZER: OnceLock<Localizer> = OnceLock::new();
    LOCALIZER.get_or_init(Localizer::from_environment)
}

pub(super) fn self_check_json(localizer: &Localizer) -> String {
    let mut duration_args = FluentArgs::new();
    duration_args.set("duration", "7m 57s");

    json!({
        "schemaVersion": 1,
        "active": localizer.bundle.is_some(),
        "locale": localizer.locale.as_ref().map(ToString::to_string),
        "messages": {
            "tui.status-line.setup.use-theme-colors": localizer.text(
                "tui.status-line.setup.use-theme-colors",
                None,
                || "Use theme colors".to_string(),
            ),
            "tui.status-line.setup.apply-theme-colors": localizer.text(
                "tui.status-line.setup.apply-theme-colors",
                None,
                || "Apply colors from the active /theme".to_string(),
            ),
            "tui.status-line.setup.configure-title": localizer.text(
                "tui.status-line.setup.configure-title",
                None,
                || "Configure Status Line".to_string(),
            ),
            "tui.status-line.setup.select-items-description": localizer.text(
                "tui.status-line.setup.select-items-description",
                None,
                || "Select which items to display in the status line.".to_string(),
            ),
            "tui.history.worked-for": localizer.text(
                "tui.history.worked-for",
                Some(&duration_args),
                || "Worked for 7m 57s".to_string(),
            ),
            "ultra.i18n.missing-key": localizer.text(
                "ultra.i18n.missing-key",
                None,
                || "English fallback".to_string(),
            ),
        },
    })
    .to_string()
}
