import { randomUUID } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { validateLanguagePack } from "../language/validate.mjs";
import { validateThemePack } from "../theme/validate.mjs";
import {
  disableHermesStatusLineConfig,
  enableHermesStatusLineConfig
} from "./statusline-config.mjs";

const PRIMARY_THEME_ID = "rainbow_color";
const PRIMARY_THEME_DIRECTORY = "rainbow_color";
const HERMES_THEME_ID = "ccu.hermes";
const HERMES_THEME_DIRECTORY = "ccu-hermes";
const LEGACY_THEME_ID = "ccu.deepseek";
const LEGACY_ICE_THEME_ID = "ccu.ice-banner";
const PREVIOUS_THEME_IDS = new Set([
  HERMES_THEME_ID,
  LEGACY_THEME_ID,
  LEGACY_ICE_THEME_ID
]);
const OWNED_THEME_IDS = new Set([
  PRIMARY_THEME_ID,
  HERMES_THEME_ID,
  LEGACY_THEME_ID,
  LEGACY_ICE_THEME_ID
]);

async function exists(path, lstatImpl = lstat) {
  try {
    await lstatImpl(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function replaceDirectoryAtomic(source, destination, fsOps = {}) {
  const copy = fsOps.cp ?? cp;
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  const statPath = fsOps.lstat ?? lstat;
  const parent = dirname(destination);
  const token = randomUUID();
  const staged = `${destination}.staged-${token}`;
  const backup = `${destination}.backup-${token}`;
  let movedExisting = false;
  await makeDirectory(parent, { recursive: true });
  try {
    await copy(source, staged, { recursive: true, errorOnExist: true });
    if (await exists(destination, statPath)) {
      await move(destination, backup);
      movedExisting = true;
    }
    await move(staged, destination);
    if (movedExisting) {
      await remove(backup, { recursive: true, force: true });
    }
  } catch (error) {
    await remove(staged, { recursive: true, force: true }).catch(() => {});
    if (movedExisting && !(await exists(destination, statPath))) {
      await move(backup, destination).catch(() => {});
    }
    throw error;
  } finally {
    await remove(backup, { recursive: true, force: true }).catch(() => {});
  }
}

async function replaceFileAtomic(source, destination, fsOps = {}) {
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const read = fsOps.readFile ?? readFile;
  const write = fsOps.writeFile ?? writeFile;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  const statPath = fsOps.lstat ?? lstat;
  const token = randomUUID();
  const staged = `${destination}.staged-${token}`;
  const backup = `${destination}.backup-${token}`;
  let movedExisting = false;
  await makeDirectory(dirname(destination), { recursive: true });
  try {
    await write(staged, await read(source), { flag: "wx" });
    if (await exists(destination, statPath)) {
      await move(destination, backup);
      movedExisting = true;
    }
    await move(staged, destination);
    if (movedExisting) {
      await remove(backup, { force: true });
    }
  } catch (error) {
    await remove(staged, { force: true }).catch(() => {});
    if (movedExisting && !(await exists(destination, statPath))) {
      await move(backup, destination).catch(() => {});
    }
    throw error;
  } finally {
    await remove(backup, { force: true }).catch(() => {});
  }
}

async function resolveContentLayout(contentRoot) {
  const repoLanguage = join(contentRoot, "packages", "languages", "zh-CN");
  const packagedLanguage = join(contentRoot, "languages", "zh-CN");
  if (await exists(repoLanguage)) {
    return {
      language: repoLanguage,
      catalog: join(contentRoot, "research", "codex-0.144.5", "tui-messages.jsonl"),
      template: join(contentRoot, "templates", "languages", "messages.en-US.ftl"),
      themes: [PRIMARY_THEME_DIRECTORY, HERMES_THEME_DIRECTORY].map((directory) =>
        join(contentRoot, "packages", "themes", directory)
      ),
      quota: join(contentRoot, "packages", "quota.example.json")
    };
  }
  return {
    language: packagedLanguage,
    catalog: join(contentRoot, "catalog", "tui-messages.jsonl"),
    template: join(contentRoot, "catalog", "messages.en-US.ftl"),
    themes: [PRIMARY_THEME_DIRECTORY, HERMES_THEME_DIRECTORY].map((directory) =>
      join(contentRoot, "themes", directory)
    ),
    quota: join(contentRoot, "quota.example.json")
  };
}

async function cacheBundledContent({
  contentRoot,
  installRoot,
  layout,
  language,
  themes,
  fsOps
}) {
  const cacheRoot = join(installRoot, "content");
  if (resolve(contentRoot).toLowerCase() === resolve(cacheRoot).toLowerCase()) {
    return cacheRoot;
  }
  await replaceDirectoryAtomic(
    layout.language,
    join(cacheRoot, "languages", language.locale),
    fsOps
  );
  for (const themePath of themes) {
    await replaceDirectoryAtomic(
      themePath,
      join(cacheRoot, "themes", basename(themePath)),
      fsOps
    );
  }
  await replaceFileAtomic(
    layout.catalog,
    join(cacheRoot, "catalog", "tui-messages.jsonl"),
    fsOps
  );
  await replaceFileAtomic(
    layout.template,
    join(cacheRoot, "catalog", "messages.en-US.ftl"),
    fsOps
  );
  if (await exists(layout.quota, fsOps?.lstat ?? lstat)) {
    await replaceFileAtomic(
      layout.quota,
      join(cacheRoot, "quota.example.json"),
      fsOps
    );
  }
  return cacheRoot;
}

export function resolveCodexHome(env = process.env) {
  if (env.CODEX_HOME) return resolve(env.CODEX_HOME);
  const home = env.USERPROFILE ?? env.HOME;
  if (!home) throw new Error("USERPROFILE or CODEX_HOME is required");
  return join(resolve(home), ".codex");
}

export async function syncBundledContent(options) {
  if (!options?.contentRoot) throw new Error("contentRoot is required");
  if (!options.installRoot) throw new Error("installRoot is required");
  const contentRoot = resolve(options.contentRoot);
  const installRoot = resolve(options.installRoot);
  const codexHome = resolveCodexHome(options.env);
  const layout = await resolveContentLayout(contentRoot);
  const language = await validateLanguagePack({
    packRoot: layout.language,
    catalogPath: layout.catalog,
    templatePath: layout.template
  });
  const themes = await Promise.all(layout.themes.map(async (themePath) =>
    validateThemePack(
      JSON.parse(await (options.readFile ?? readFile)(join(themePath, "theme.json"), "utf8"))
    )
  ));
  const theme = themes.find(({ id }) => id === PRIMARY_THEME_ID);
  if (theme === undefined) throw new Error(`missing primary theme: ${PRIMARY_THEME_ID}`);
  const cachedContentRoot = await cacheBundledContent({
    contentRoot,
    installRoot,
    layout,
    language,
    themes: layout.themes,
    fsOps: options.fsOps
  });

  await replaceDirectoryAtomic(
    layout.language,
    join(installRoot, "languages", language.locale),
    options.fsOps
  );
  for (let index = 0; index < themes.length; index += 1) {
    await replaceDirectoryAtomic(
      layout.themes[index],
      join(installRoot, "themes", themes[index].id),
      options.fsOps
    );
  }

  const makeDirectory = options.fsOps?.mkdir ?? mkdir;
  const read = options.readFile ?? readFile;
  const write = options.fsOps?.writeFile ?? writeFile;
  const remove = options.fsOps?.rm ?? rm;
  const statPath = options.fsOps?.lstat ?? lstat;
  await makeDirectory(codexHome, { recursive: true });
  const languagePreference = join(codexHome, "ui-language");
  const themePreference = join(codexHome, "ui-theme");
  const statusLinePreference = join(codexHome, "ui-statusline-preset");
  const languagePreferenceExists = await exists(languagePreference, statPath);
  const currentLanguage = languagePreferenceExists
    ? (await read(languagePreference, "utf8")).trim()
    : null;
  if (!languagePreferenceExists || currentLanguage.toLowerCase() === "zh-hans") {
    await write(languagePreference, `${language.locale}\n`, "utf8");
  }
  const themePreferenceExists = await exists(themePreference, statPath);
  const currentTheme = themePreferenceExists
    ? (await read(themePreference, "utf8")).trim()
    : null;
  const migratingPreviousTheme = PREVIOUS_THEME_IDS.has(currentTheme);
  if (!themePreferenceExists || migratingPreviousTheme) {
    await write(themePreference, `${theme.id}\n`, "utf8");
  }
  const requestedStatusLinePreset =
    PREVIOUS_THEME_IDS.has(options.statusLinePreset)
      ? theme.id
      : options.statusLinePreset;
  if (
    requestedStatusLinePreset !== undefined &&
    requestedStatusLinePreset !== null &&
    requestedStatusLinePreset !== theme.id
  ) {
    throw new Error(`unsupported status-line preset: ${requestedStatusLinePreset}`);
  }
  const statusLinePreferenceExists = await exists(statusLinePreference, statPath);
  const currentStatusLinePreset = statusLinePreferenceExists
    ? (await read(statusLinePreference, "utf8")).trim()
    : null;
  if (requestedStatusLinePreset === theme.id) {
    await write(statusLinePreference, `${theme.id}\n`, "utf8");
  } else if (
    requestedStatusLinePreset === null &&
    statusLinePreferenceExists
  ) {
    if (OWNED_THEME_IDS.has(currentStatusLinePreset)) {
      await remove(statusLinePreference, { force: true });
    }
  } else if (
    requestedStatusLinePreset === undefined &&
    (PREVIOUS_THEME_IDS.has(currentStatusLinePreset) ||
      (!statusLinePreferenceExists && migratingPreviousTheme))
  ) {
    await write(statusLinePreference, `${theme.id}\n`, "utf8");
  }
  const statusLinePresetEnabled =
    await exists(statusLinePreference, statPath) &&
    (await read(statusLinePreference, "utf8")).trim() === theme.id;
  let statusLineConfig = null;
  if (statusLinePresetEnabled) {
    statusLineConfig = await enableHermesStatusLineConfig({
      codexHome,
      fsOps: options.fsOps
    });
  } else if (requestedStatusLinePreset === null) {
    statusLineConfig = await disableHermesStatusLineConfig({
      codexHome,
      fsOps: options.fsOps
    });
  }

  if (await exists(layout.quota, statPath)) {
    await write(
      join(installRoot, "quota.example.json"),
      await read(layout.quota),
      { flag: "w" }
    );
  }

  return {
    language: {
      locale: language.locale,
      messages: language.messageCount
    },
    theme: {
      id: theme.id,
      displayName: theme.displayName,
      statusLinePresetEnabled,
      statusLineConfig
    },
    codexHome,
    contentRoot: cachedContentRoot
  };
}
