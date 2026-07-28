import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export const SETTINGS_SCHEMA_VERSION = 1;
export const DEFAULT_PROXY_URL = "http://127.0.0.1:7890";

export function defaultSettings() {
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    updates: {
      checkOnStartup: true,
      checkIntervalHours: 6
    },
    network: {
      proxyEnabled: false,
      proxyUrl: DEFAULT_PROXY_URL
    }
  };
}

export function validateProxyUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("proxy URL must be a valid URL", { cause: error });
  }
  if (!new Set(["http:", "https:"]).has(url.protocol)) {
    throw new Error("proxy URL must use http or https");
  }
  if (!url.hostname || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("proxy URL must contain only scheme, host, and port");
  }
  return url.toString().replace(/\/$/, "");
}

function validatePositiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return value;
}

export function validateSettings(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("settings must be an object");
  }
  if (value.schemaVersion !== SETTINGS_SCHEMA_VERSION) {
    throw new Error("unsupported settings schema");
  }
  if (value.updates === null || typeof value.updates !== "object") {
    throw new Error("settings.updates must be an object");
  }
  if (value.network === null || typeof value.network !== "object") {
    throw new Error("settings.network must be an object");
  }
  if (typeof value.updates.checkOnStartup !== "boolean") {
    throw new Error("settings.updates.checkOnStartup must be boolean");
  }
  if (typeof value.network.proxyEnabled !== "boolean") {
    throw new Error("settings.network.proxyEnabled must be boolean");
  }
  return {
    schemaVersion: SETTINGS_SCHEMA_VERSION,
    updates: {
      checkOnStartup: value.updates.checkOnStartup,
      checkIntervalHours: validatePositiveNumber(
        value.updates.checkIntervalHours,
        "settings.updates.checkIntervalHours"
      )
    },
    network: {
      proxyEnabled: value.network.proxyEnabled,
      proxyUrl: validateProxyUrl(value.network.proxyUrl)
    }
  };
}

export function settingsPath(installRoot) {
  return join(installRoot, "settings.json");
}

export async function readSettings(installRoot, fsOps = {}) {
  const read = fsOps.readFile ?? readFile;
  try {
    return validateSettings(JSON.parse(await read(settingsPath(installRoot), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return defaultSettings();
    throw error;
  }
}

export async function writeSettingsAtomic(installRoot, value, fsOps = {}) {
  const settings = validateSettings(value);
  const target = settingsPath(installRoot);
  const temporary = `${target}.tmp-${randomUUID()}`;
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const write = fsOps.writeFile ?? writeFile;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  await makeDirectory(dirname(target), { recursive: true });
  try {
    await write(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx"
    });
    await move(temporary, target);
  } catch (error) {
    await remove(temporary, { force: true }).catch(() => {});
    throw error;
  }
  return settings;
}

export async function updateProxySettings(installRoot, update, options = {}) {
  const read = options.readSettings ?? readSettings;
  const write = options.writeSettingsAtomic ?? writeSettingsAtomic;
  const current = await read(installRoot, options.fsOps);
  return await write(
    installRoot,
    {
      ...current,
      network: {
        proxyEnabled:
          update.proxyEnabled === undefined
            ? current.network.proxyEnabled
            : Boolean(update.proxyEnabled),
        proxyUrl:
          update.proxyUrl === undefined
            ? current.network.proxyUrl
            : validateProxyUrl(update.proxyUrl)
      }
    },
    options.fsOps
  );
}
