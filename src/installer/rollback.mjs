import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { validateLanguagePack } from "../language/validate.mjs";
import { sha256File } from "../release/hash.mjs";
import { readState, writeStateAtomic } from "../state/store.mjs";

async function verifyBuild(build, hashFile, statFile) {
  const [metadata, hash] = await Promise.all([
    statFile(build.binaryPath),
    hashFile(build.binaryPath)
  ]);
  if (
    !metadata.isFile() ||
    metadata.size !== build.size ||
    metadata.mtimeMs !== build.mtimeMs ||
    hash.size !== build.size ||
    hash.sha256 !== build.sha256
  ) {
    throw new Error(`installed build metadata changed: ${build.releaseId}`);
  }
}

async function restoreLocale(locale, options) {
  if (locale === null) return null;
  try {
    const [metadata, hash] = await Promise.all([
      options.statFile(locale.resourcePath),
      options.hashFile(locale.resourcePath)
    ]);
    if (
      !metadata.isFile() ||
      metadata.size !== locale.size ||
      metadata.mtimeMs !== locale.mtimeMs ||
      hash.size !== locale.size ||
      hash.sha256 !== locale.sha256
    ) {
      return null;
    }
    const packRoot = dirname(locale.manifestPath);
    const language = await options.validateLanguagePack({
      packRoot,
      catalogPath: options.catalogPath
    });
    return language.locale === locale.id ? locale : null;
  } catch {
    return null;
  }
}

export async function rollback(options) {
  if (!options?.installRoot) throw new Error("installRoot is required");
  if (!options.catalogPath) throw new Error("catalogPath is required");
  const installRoot = resolve(options.installRoot);
  const statePath = options.statePath ?? join(installRoot, "state.json");
  const readStateImpl = options.readState ?? readState;
  const writeState = options.writeStateAtomic ?? writeStateAtomic;
  const hashFile = options.sha256File ?? sha256File;
  const statFile = options.stat ?? stat;
  const validateLanguage = options.validateLanguagePack ?? validateLanguagePack;
  const state = await readStateImpl(statePath);
  if (state.active === null || state.lastKnownGood === null) {
    throw new Error("no last-known-good build is available for rollback");
  }
  await Promise.all([
    verifyBuild(state.active, hashFile, statFile),
    verifyBuild(state.lastKnownGood.build, hashFile, statFile)
  ]);
  const restoredLocale = await restoreLocale(state.lastKnownGood.locale, {
    statFile,
    hashFile,
    validateLanguagePack: validateLanguage,
    catalogPath: options.catalogPath
  });
  const nextState = {
    ...state,
    active: state.lastKnownGood.build,
    locale: restoredLocale,
    lastKnownGood: {
      build: state.active,
      locale: state.locale
    }
  };
  await writeState(statePath, nextState);
  return nextState;
}
