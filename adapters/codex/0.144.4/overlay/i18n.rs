use std::fs;
use std::path::PathBuf;
use std::sync::OnceLock;

use fluent_bundle::FluentArgs;
use fluent_bundle::FluentResource;
use fluent_bundle::concurrent::FluentBundle;
use serde_json::Map;
use serde_json::Value;
use serde_json::json;
use strum::IntoEnumIterator;
use unic_langid::LanguageIdentifier;

use crate::slash_command::SlashCommand;

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
        let Ok(available_locale) = std::env::var("CODEX_ULTRA_LOCALE") else {
            return Self::english();
        };
        let requested_locale = language_preference_path()
            .and_then(|path| fs::read_to_string(path).ok())
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| available_locale.clone());
        if matches!(requested_locale.as_str(), "en" | "en-US") {
            return Self::english();
        }
        if requested_locale != available_locale {
            return Self::english();
        }
        let Some(path) = std::env::var_os("CODEX_ULTRA_FTL_PATH") else {
            return Self::english();
        };
        let Ok(source) = fs::read_to_string(PathBuf::from(path)) else {
            return Self::english();
        };
        Self::from_ftl(&available_locale, &source)
    }

    pub(crate) fn text<F>(&self, key: &str, args: Option<&FluentArgs>, english: F) -> String
    where
        F: FnOnce() -> String,
    {
        let Some(bundle) = self.bundle.as_ref() else {
            return english();
        };
        let Some(message) = bundle.get_message(key) else {
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

    pub(crate) fn text_with_string_arg<F>(
        &self,
        key: &str,
        arg_name: &str,
        arg_value: impl Into<String>,
        english: F,
    ) -> String
    where
        F: FnOnce() -> String,
    {
        let mut args = FluentArgs::new();
        args.set(arg_name, arg_value.into());
        self.text(key, Some(&args), english)
    }
}

fn language_preference_path() -> Option<PathBuf> {
    std::env::var_os("CODEX_ULTRA_LANGUAGE_PREFERENCE_PATH").map(PathBuf::from)
}

fn normalized_language(input: &str) -> Option<&'static str> {
    match input.trim().to_ascii_lowercase().as_str() {
        "zh" | "zh-cn" | "chinese" => Some("zh-CN"),
        "en" | "en-us" | "english" => Some("en"),
        _ => None,
    }
}

pub(crate) fn language_status() -> (String, String) {
    let localizer = global();
    let locale = localizer
        .locale
        .as_ref()
        .map(ToString::to_string)
        .unwrap_or_else(|| "en".to_string());
    let mut args = FluentArgs::new();
    args.set("locale", locale.as_str());
    let current = localizer.text("language-current", Some(&args), || {
        format!("Current language: {locale}")
    });
    let help = localizer.text("language-help", None, || {
        "Use /language zh-CN or /language en to choose a language; restart Codex to apply."
            .to_string()
    });
    (current, help)
}

pub(crate) fn save_language_preference(input: &str) -> Result<String, String> {
    let localizer = global();
    let Some(locale) = normalized_language(input) else {
        let mut args = FluentArgs::new();
        args.set("locale", input.trim());
        return Err(localizer.text("language-unsupported", Some(&args), || {
            format!(
                "Unsupported language {}. Available options: zh-CN, en.",
                input.trim()
            )
        }));
    };
    let Some(path) = language_preference_path() else {
        return Err(
            "Language selection is unavailable in this launch; start Codex through Codex Ultra."
                .to_string(),
        );
    };
    fs::write(path, format!("{locale}\n"))
        .map_err(|error| format!("Could not save language preference: {error}"))?;
    let mut args = FluentArgs::new();
    args.set("locale", locale);
    Ok(localizer.text("language-saved", Some(&args), || {
        format!("Selected {locale}; restart Codex to apply.")
    }))
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

    let mut messages = Map::new();
    for (id, key, english) in [
        (
            "tui.status-line.setup.use-theme-colors",
            "status-line-use-theme-colors",
            "Use theme colors",
        ),
        (
            "tui.status-line.setup.apply-theme-colors",
            "status-line-apply-theme-colors",
            "Apply colors from the active /theme",
        ),
        (
            "tui.status-line.setup.configure-title",
            "status-line-configure-title",
            "Configure Status Line",
        ),
        (
            "tui.status-line.setup.select-items-description",
            "status-line-select-items-description",
            "Select which items to display in the status line.",
        ),
        (
            "tui.onboarding.auth.paid-plan-intro",
            "onboarding-paid-plan-intro",
            "Sign in with ChatGPT to use Codex as part of your paid plan",
        ),
        (
            "tui.onboarding.auth.api-key-billing-intro",
            "onboarding-api-key-billing-intro",
            "or connect an API key for usage-based billing",
        ),
        (
            "tui.onboarding.auth.sign-in-chatgpt",
            "onboarding-sign-in-chatgpt",
            "Sign in with ChatGPT",
        ),
        (
            "tui.onboarding.auth.provide-api-key",
            "onboarding-provide-api-key",
            "Provide your own API key",
        ),
        (
            "tui.onboarding.auth.pay-for-usage",
            "onboarding-pay-for-usage",
            "Pay for what you use",
        ),
        (
            "tui.onboarding.auth.api-key-disabled-workspace",
            "onboarding-api-key-disabled-workspace",
            "  API key login is disabled by this workspace. Sign in with ChatGPT to continue.",
        ),
    ] {
        messages.insert(
            id.to_string(),
            Value::String(localizer.text(key, None, || english.to_string())),
        );
    }

    for (id, key, english) in [
        (
            "tui.status-card.model-label",
            "status-card-model-label",
            "Model",
        ),
        (
            "tui.status-card.directory-label",
            "status-card-directory-label",
            "Directory",
        ),
        (
            "tui.status-card.permissions-label",
            "status-card-permissions-label",
            "Permissions",
        ),
        (
            "tui.status-card.agents-label",
            "status-card-agents-label",
            "Agents.md",
        ),
        (
            "tui.status-card.model-provider-label",
            "status-card-model-provider-label",
            "Model provider",
        ),
        (
            "tui.status-card.account-label",
            "status-card-account-label",
            "Account",
        ),
        (
            "tui.status-card.thread-name-label",
            "status-card-thread-name-label",
            "Thread name",
        ),
        (
            "tui.status-card.session-label",
            "status-card-session-label",
            "Session",
        ),
        (
            "tui.status-card.forked-from-label",
            "status-card-forked-from-label",
            "Forked from",
        ),
        (
            "tui.status-card.collaboration-mode-label",
            "status-card-collaboration-mode-label",
            "Collaboration mode",
        ),
        (
            "tui.status-card.token-usage-label",
            "status-card-token-usage-label",
            "Token usage",
        ),
        (
            "tui.status-card.context-window-label",
            "status-card-context-window-label",
            "Context window",
        ),
        (
            "tui.status-card.remote-label",
            "status-card-remote-label",
            "Remote",
        ),
        (
            "tui.status-card.limits-label",
            "status-card-limits-label",
            "Limits",
        ),
        (
            "tui.status-card.warning-label",
            "status-card-warning-label",
            "Warning",
        ),
        (
            "tui.status-card.limits-unavailable",
            "status-card-limits-unavailable",
            "not available for this account",
        ),
        (
            "tui.status-card.limits-stale-run-status",
            "status-card-limits-stale-run-status",
            "limits may be stale - run /status again shortly.",
        ),
        (
            "tui.status-card.limits-stale-new-turn",
            "status-card-limits-stale-new-turn",
            "limits may be stale - start new turn to refresh.",
        ),
        (
            "tui.status-card.limits-refresh-requested",
            "status-card-limits-refresh-requested",
            "refresh requested; run /status again shortly.",
        ),
        (
            "tui.status-card.limits-data-pending",
            "status-card-limits-data-pending",
            "data not available yet",
        ),
        (
            "tui.status-card.api-key-configured",
            "status-card-api-key-configured",
            "API key configured (run codex login to use ChatGPT)",
        ),
        (
            "tui.command-popup.no-matches",
            "command-popup-no-matches",
            "no matches",
        ),
        (
            "tui.approval.run-command-title",
            "approval-run-command-title",
            "Would you like to run the following command?",
        ),
        (
            "tui.approval.grant-permissions-title",
            "approval-grant-permissions-title",
            "Would you like to grant these permissions?",
        ),
        (
            "tui.approval.apply-patch-title",
            "approval-apply-patch-title",
            "Would you like to make the following edits?",
        ),
        (
            "tui.approval.yes-once",
            "approval-yes-once",
            "Yes, just this once",
        ),
        (
            "tui.approval.yes-proceed",
            "approval-yes-proceed",
            "Yes, proceed",
        ),
        (
            "tui.approval.allow-host-conversation",
            "approval-allow-host-conversation",
            "Yes, and allow this host for this conversation",
        ),
        (
            "tui.approval.allow-permissions-session",
            "approval-allow-permissions-session",
            "Yes, and allow these permissions for this session",
        ),
        (
            "tui.approval.allow-command-session",
            "approval-allow-command-session",
            "Yes, and don't ask again for this command in this session",
        ),
        (
            "tui.approval.allow-host-future",
            "approval-allow-host-future",
            "Yes, and allow this host in the future",
        ),
        (
            "tui.approval.block-host-future",
            "approval-block-host-future",
            "No, and block this host in the future",
        ),
        (
            "tui.approval.decline-command",
            "approval-decline-command",
            "No, continue without running it",
        ),
        (
            "tui.approval.tell-codex",
            "approval-tell-codex",
            "No, and tell Codex what to do differently",
        ),
        (
            "tui.approval.allow-files-session",
            "approval-allow-files-session",
            "Yes, and don't ask again for these files",
        ),
        (
            "tui.approval.grant-permissions-turn",
            "approval-grant-permissions-turn",
            "Yes, grant these permissions for this turn",
        ),
        (
            "tui.approval.grant-strict-review-turn",
            "approval-grant-strict-review-turn",
            "Yes, grant for this turn with strict auto review",
        ),
        (
            "tui.approval.grant-permissions-session",
            "approval-grant-permissions-session",
            "Yes, grant these permissions for this session",
        ),
        (
            "tui.approval.continue-without-permissions",
            "approval-continue-without-permissions",
            "No, continue without permissions",
        ),
        (
            "tui.approval.provide-requested-info",
            "approval-provide-requested-info",
            "Yes, provide the requested info",
        ),
        (
            "tui.approval.continue-without-info",
            "approval-continue-without-info",
            "No, but continue without it",
        ),
        (
            "tui.approval.cancel-request",
            "approval-cancel-request",
            "Cancel this request",
        ),
    ] {
        messages.insert(
            id.to_string(),
            Value::String(localizer.text(key, None, || english.to_string())),
        );
    }

    for (id, key, english) in [
        (
            "tui.session-card.model-label",
            "session-card-model-label",
            "model:",
        ),
        (
            "tui.session-card.directory-label",
            "session-card-directory-label",
            "directory:",
        ),
        (
            "tui.session-card.permissions-label",
            "session-card-permissions-label",
            "permissions:",
        ),
        (
            "tui.session-card.change-model-hint",
            "session-card-change-model-hint",
            "to change",
        ),
        ("tui.tooltip.label", "tooltip-label", "Tip:"),
        (
            "tui.tooltip.rename-threads",
            "tooltip-rename-threads",
            "Use /rename to rename your threads for easier thread resuming.",
        ),
        (
            "tui.composer.placeholder.explain-codebase",
            "composer-explain-codebase",
            "Explain this codebase",
        ),
        (
            "tui.composer.placeholder.summarize-commits",
            "composer-summarize-commits",
            "Summarize recent commits",
        ),
        (
            "tui.composer.placeholder.implement-feature",
            "composer-implement-feature",
            "Implement {feature}",
        ),
        (
            "tui.composer.placeholder.fix-file-bug",
            "composer-fix-file-bug",
            "Find and fix a bug in @filename",
        ),
        (
            "tui.composer.placeholder.write-file-tests",
            "composer-write-file-tests",
            "Write tests for @filename",
        ),
        (
            "tui.composer.placeholder.improve-file-docs",
            "composer-improve-file-docs",
            "Improve documentation in @filename",
        ),
        (
            "tui.composer.placeholder.review-current-changes",
            "composer-review-current-changes",
            "Run /review on my current changes",
        ),
        (
            "tui.composer.placeholder.list-skills",
            "composer-list-skills",
            "Use /skills to list available skills",
        ),
        (
            "tui.composer.placeholder.side-check-compatibility",
            "composer-side-check-compatibility",
            "Check recently modified functions for compatibility",
        ),
        (
            "tui.composer.placeholder.side-count-modified-files",
            "composer-side-count-modified-files",
            "How many files have been modified?",
        ),
        (
            "tui.composer.placeholder.side-check-scale",
            "composer-side-check-scale",
            "Will this algorithm scale well?",
        ),
    ] {
        messages.insert(
            id.to_string(),
            Value::String(localizer.text(key, None, || english.to_string())),
        );
    }

    for (id, key, arg_name, arg_value, english) in [
        (
            "tui.mcp.client-failed-to-start",
            "mcp-client-failed-to-start",
            "name",
            "openaiDeveloperDocs",
            "MCP client for `openaiDeveloperDocs` failed to start",
        ),
        (
            "tui.status-card.usage-note",
            "status-card-usage-note",
            "url",
            "https://chatgpt.com/codex/settings/usage",
            "Visit https://chatgpt.com/codex/settings/usage for up-to-date information on rate limits and credits",
        ),
        (
            "tui.status-line.context-remaining",
            "status-line-context-remaining",
            "percent",
            "42",
            "Context 42% left",
        ),
        (
            "tui.status-line.context-used",
            "status-line-context-used",
            "percent",
            "58",
            "Context 58% used",
        ),
        (
            "tui.status-line.tokens-used",
            "status-line-tokens-used",
            "tokens",
            "12.3K",
            "12.3K used",
        ),
        (
            "tui.footer.context-remaining",
            "footer-context-remaining",
            "percent",
            "42",
            "42% context left",
        ),
        (
            "tui.footer.tokens-used",
            "footer-tokens-used",
            "tokens",
            "12.3K",
            "12.3K used",
        ),
        (
            "tui.slash-command.unrecognized",
            "slash-unrecognized-command",
            "name",
            "sdsd",
            "Unrecognized command '/sdsd'. Type \"/\" for a list of supported commands.",
        ),
    ] {
        messages.insert(
            id.to_string(),
            Value::String(
                localizer.text_with_string_arg(key, arg_name, arg_value, || english.to_string()),
            ),
        );
    }

    for command in SlashCommand::iter() {
        let (id, key) = command.description_metadata();
        messages.entry(id.to_string()).or_insert_with(|| {
            Value::String(localizer.text(key, None, || command.description().to_string()))
        });
    }

    messages.insert(
        "tui.history.worked-for".to_string(),
        Value::String(
            localizer.text("history-worked-for", Some(&duration_args), || {
                "Worked for 7m 57s".to_string()
            }),
        ),
    );
    messages.insert(
        "ultra.i18n.missing-key".to_string(),
        Value::String(localizer.text("ultra-i18n-missing-key", None, || {
            "English fallback".to_string()
        })),
    );

    json!({
        "schemaVersion": 1,
        "active": localizer.bundle.is_some(),
        "locale": localizer.locale.as_ref().map(ToString::to_string),
        "messages": messages,
    })
    .to_string()
}
