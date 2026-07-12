use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::OnceLock;

use serde::Deserialize;

#[cfg(test)]
#[path = "i18n_tests.rs"]
mod tests;

#[derive(Debug, Default, Deserialize)]
struct CompiledCatalog {
    #[serde(default)]
    messages: HashMap<String, String>,
}

#[derive(Debug, Default)]
pub(crate) struct Translator {
    messages: HashMap<String, String>,
}

impl Translator {
    pub(crate) fn from_json_str(source: &str) -> Self {
        let catalog = serde_json::from_str::<CompiledCatalog>(source).unwrap_or_default();
        Self {
            messages: catalog.messages,
        }
    }

    pub(crate) fn from_catalog_path(path: &Path) -> Self {
        let Ok(source) = fs::read_to_string(path) else {
            return Self::default();
        };
        Self::from_json_str(&source)
    }

    pub(crate) fn text(&self, id: &str, english: &str) -> String {
        match self.messages.get(id) {
            Some(translation) if !translation.trim().is_empty() => translation.clone(),
            _ => english.to_string(),
        }
    }
}

pub(crate) fn global() -> &'static Translator {
    static TRANSLATOR: OnceLock<Translator> = OnceLock::new();
    TRANSLATOR.get_or_init(|| {
        let Some(catalog_path) = std::env::var_os("CODEX_ULTRA_CATALOG") else {
            return Translator::default();
        };
        Translator::from_catalog_path(Path::new(&catalog_path))
    })
}
