import { readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { resolveInstallRoot } from "../config/constants.mjs";
import { resolveCodexHome } from "../content/sync.mjs";
import { readState, writeStateAtomic } from "../state/store.mjs";

async function readOptionalState(path, readStateImpl) {
  try {
    return await readStateImpl(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function removeManagedPreference(path, expected, options) {
  const read = options.readFile ?? readFile;
  const remove = options.rm ?? rm;
  try {
    if ((await read(path, "utf8")).trim() !== expected) return false;
    await remove(path, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function uninstallCcu(options = {}) {
  const env = options.env ?? process.env;
  const installRoot = resolve(
    options.installRoot ?? resolveInstallRoot(env)
  );
  const statePath = options.statePath ?? join(installRoot, "state.json");
  const readStateImpl = options.readState ?? readState;
  const writeState = options.writeStateAtomic ?? writeStateAtomic;
  const removePathEntry = options.removePathEntry ?? (async () => {
    throw new Error("PATH adapter is not implemented yet");
  });
  const state = await readOptionalState(statePath, readStateImpl);
  const path = await removePathEntry(join(installRoot, "bin"));
  let stateChanged = false;
  if (state !== null) {
    const nextState = {
      ...state,
      active: null,
      locale: null,
      lastKnownGood: null
    };
    stateChanged =
      state.active !== null ||
      state.locale !== null ||
      state.lastKnownGood !== null;
    if (stateChanged) await writeState(statePath, nextState);
  }

  const codexHome = resolve(options.codexHome ?? resolveCodexHome(env));
  const removedPreferences = [];
  for (const [name, expected] of [
    ["ui-language", "zh-CN"],
    ["ui-theme", "ccu.deepseek"],
    ["ui-statusline-preset", "ccu.deepseek"]
  ]) {
    if (
      await removeManagedPreference(join(codexHome, name), expected, options)
    ) {
      removedPreferences.push(name);
    }
  }

  return {
    changed: path?.changed === true || stateChanged || removedPreferences.length > 0,
    installRoot,
    official: state?.official ?? null,
    pathRemoved: path?.changed === true,
    stateChanged,
    removedPreferences
  };
}
