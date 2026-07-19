import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { MESSAGE_SPECS } from "../catalog/message-specs.mjs";
import {
  PLATFORM,
  STATE_SCHEMA_VERSION,
  isAbsoluteLocalWindowsPath,
  resolveInstallRoot,
  windowsPathsEqual
} from "../config/constants.mjs";
import { discoverOfficialCodex } from "../discovery/official-codex.mjs";
import { validateLanguagePack } from "../language/validate.mjs";
import { buildLaunchEnvironment } from "../launcher/select-target.mjs";
import { extractZipSecure } from "../release/archive.mjs";
import {
  FORK_MANIFEST_NAME,
  validateForkManifest
} from "../release/fork-manifest.mjs";
import { sha256File } from "../release/hash.mjs";
import { validateReleaseManifest } from "../release/manifest.mjs";
import { readState, writeStateAtomic } from "../state/store.mjs";

export const INSTALL_STAGES = Object.freeze([
  "manifest",
  "download-ultra",
  "verify-ultra",
  "extract-ultra",
  "download-language",
  "verify-language",
  "extract-language",
  "smoke-version",
  "smoke-zh-cn",
  "smoke-english",
  "move-release",
  "move-language",
  "path-add",
  "state-switch"
]);

export const FORK_INSTALL_STAGES = Object.freeze([
  "manifest",
  "download-fork",
  "verify-fork",
  "extract-fork",
  "smoke-version",
  "move-release",
  "prepare-bin",
  "path-add",
  "state-switch"
]);

const ENGLISH_MESSAGES = Object.fromEntries(
  MESSAGE_SPECS
    .filter((record) => record.mvpStatus === "wired")
    .map((record) => {
      let value = record.english;
      for (const argument of record.args) {
        value = value.replace(`{${argument.name}}`, String(argument.sample));
      }
      return [record.id, value];
    })
);

function errorWithOutput(message, result) {
  return new Error(
    `${message}\nstdout: ${result.stdout.trim()}\nstderr: ${result.stderr.trim()}`
  );
}

const DEFERRED_RELEASE_CLEANUP_CODES = new Set([
  "EBUSY",
  "ENOTEMPTY",
  "EPERM"
]);

const RECOVERABLE_ROOT_DIRECTORIES = new Set([
  "bin",
  "cache",
  "content",
  "languages",
  "releases",
  "themes"
]);
const RECOVERABLE_ROOT_FILES = new Set([
  "quota.example.json",
  "state.json"
]);
const CCU_RELEASE_ID = /^\d+\.\d+\.\d+-ccu\.i18n\.\d+$/;

async function isRecoverableCcuInstallRoot(installRoot, entries) {
  let releasesEntry = null;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) return false;
    if (RECOVERABLE_ROOT_DIRECTORIES.has(entry.name)) {
      if (!entry.isDirectory()) return false;
      if (entry.name === "releases") releasesEntry = entry;
      continue;
    }
    if (RECOVERABLE_ROOT_FILES.has(entry.name)) {
      if (!entry.isFile()) return false;
      continue;
    }
    return false;
  }
  if (releasesEntry === null) return false;

  const releaseEntries = await readdir(join(installRoot, "releases"), {
    withFileTypes: true
  });
  if (releaseEntries.length === 0) return false;
  for (const release of releaseEntries) {
    if (
      release.isSymbolicLink() ||
      !release.isDirectory() ||
      !CCU_RELEASE_ID.test(release.name)
    ) {
      return false;
    }
    const binaryPath = join(
      installRoot,
      "releases",
      release.name,
      PLATFORM,
      "package",
      "bin",
      "codex.exe"
    );
    const metadata = await pathExists(binaryPath);
    if (!metadata?.isFile() || metadata.isSymbolicLink()) return false;
  }
  return true;
}

export async function quarantineOrphanedCcuReleases(installRoot, options = {}) {
  const list = options.readdir ?? readdir;
  const move = options.rename ?? rename;
  const releasesRoot = join(installRoot, "releases");
  let entries;
  try {
    entries = await list(releasesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const recoveredReleases = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !CCU_RELEASE_ID.test(entry.name)) continue;
    const recoveredName = `${entry.name}.recovered-${randomUUID()}`;
    await move(join(releasesRoot, entry.name), join(releasesRoot, recoveredName));
    recoveredReleases.push(recoveredName);
  }
  return recoveredReleases;
}

export async function pruneInactiveReleases(
  installRoot,
  activeReleaseId,
  options = {}
) {
  const list = options.readdir ?? readdir;
  const remove = options.rm ?? rm;
  const releasesRoot = join(installRoot, "releases");
  let entries;
  try {
    entries = await list(releasesRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }

  const removedReleases = [];
  const deferredReleases = [];
  for (const entry of entries) {
    if (entry.name === activeReleaseId) continue;
    try {
      await remove(join(releasesRoot, entry.name), {
        recursive: true,
        force: true
      });
      removedReleases.push(entry.name);
    } catch (error) {
      if (!DEFERRED_RELEASE_CLEANUP_CODES.has(error?.code)) throw error;
      deferredReleases.push(entry.name);
    }
  }
  return { removedReleases, deferredReleases };
}

function runProcess(executable, args, options = {}) {
  const spawnChild = options.spawn ?? spawn;
  const childEnv = { ...(options.env ?? process.env) };
  delete childEnv.NODE_TEST_CONTEXT;
  return new Promise((resolvePromise, reject) => {
    const child = spawnChild(executable, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`Codex smoke probe timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolvePromise({ code, signal, stdout, stderr });
    });
  });
}

function parseSelfCheck(result, label) {
  if (result.signal || result.code !== 0) {
    throw errorWithOutput(`${label} failed`, result);
  }
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`${label} returned invalid JSON`, { cause: error });
  }
}

function assertMessages(actual, expected, label) {
  for (const [id, value] of Object.entries(expected)) {
    if (actual?.[id] !== value) {
      throw new Error(
        `${label} message ${id} was ${JSON.stringify(actual?.[id])}, expected ${JSON.stringify(value)}`
      );
    }
  }
}

export async function runBinarySmokeChecks(options) {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const prefix = options.binaryArgsPrefix ?? [];
  const phases = new Set(options.phases ?? ["version", "zh-CN", "english"]);
  const run = (args, env) => runProcess(
    options.binaryPath,
    [...prefix, ...args],
    { spawn: options.spawn, timeoutMs, env }
  );

  let version = null;
  let chinese = null;
  let english = null;
  if (phases.has("version")) {
    version = await run(["--version"], options.env ?? process.env);
    const expectedVersion = options.displayVersion ?? options.upstreamVersion;
    if (
      version.signal ||
      version.code !== 0 ||
      !version.stdout.includes(expectedVersion)
    ) {
      throw errorWithOutput("Codex version smoke probe failed", version);
    }
  }

  if (phases.has("zh-CN")) {
    const chineseEnvironment = buildLaunchEnvironment(
      options.env ?? process.env,
      {
        CODEX_ULTRA_LOCALE: options.language.locale,
        CODEX_ULTRA_FTL_PATH: options.resourcePath
      }
    );
    chinese = parseSelfCheck(
      await run(["--ultra-i18n-self-check"], chineseEnvironment),
      "Chinese i18n smoke probe"
    );
    if (chinese.active !== true || chinese.locale !== options.language.locale) {
      throw new Error("Chinese i18n smoke probe did not activate the requested locale");
    }
    assertMessages(chinese.messages, options.language.messages, "Chinese i18n smoke probe");
  }

  if (phases.has("english")) {
    const missingResource = `${options.resourcePath}.missing-${randomUUID()}`;
    const englishEnvironment = buildLaunchEnvironment(
      options.env ?? process.env,
      {
        CODEX_ULTRA_LOCALE: options.language.locale,
        CODEX_ULTRA_FTL_PATH: missingResource
      }
    );
    english = parseSelfCheck(
      await run(["--ultra-i18n-self-check"], englishEnvironment),
      "English fallback smoke probe"
    );
    if (english.active !== false || english.locale !== null) {
      throw new Error("English fallback smoke probe unexpectedly activated translation");
    }
    assertMessages(english.messages, ENGLISH_MESSAGES, "English fallback smoke probe");
  }

  return { version, chinese, english };
}

function exactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function readOptionalState(path, readStateImpl) {
  try {
    return await readStateImpl(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function ensureOwnershipMarker(installRoot) {
  let rootMetadata = await pathExists(installRoot);
  if (rootMetadata) {
    if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
      throw new Error("install root must be a real directory");
    }
  } else {
    await mkdir(installRoot, { recursive: true });
    rootMetadata = await lstat(installRoot);
  }
  const markerPath = join(installRoot, ".codex-cli-ultra-owned");
  const expected = { schemaVersion: 1, root: installRoot };
  let existing;
  try {
    existing = JSON.parse(await readFile(markerPath, "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error("Codex Ultra ownership marker is invalid", { cause: error });
    }
  }
  if (existing !== undefined) {
    if (
      existing?.schemaVersion !== 1 ||
      typeof existing.root !== "string" ||
      !windowsPathsEqual(existing.root, installRoot) ||
      Reflect.ownKeys(existing).length !== 2
    ) {
      throw new Error("Codex Ultra ownership marker does not match install root");
    }
    return markerPath;
  }
  const rootEntries = await readdir(installRoot, { withFileTypes: true });
  if (
    rootEntries.length !== 0 &&
    !(await isRecoverableCcuInstallRoot(installRoot, rootEntries))
  ) {
    throw new Error("install root is not empty and has no ownership marker");
  }
  const handle = await open(markerPath, "wx");
  try {
    await handle.writeFile(exactJson(expected), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return markerPath;
}

async function pathExists(path) {
  try {
    return await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function listDirectoryFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  const files = [];
  for (const entry of entries) {
    const relativePath = prefix ? join(prefix, entry.name) : entry.name;
    if (entry.isSymbolicLink()) {
      throw new Error(`immutable directory contains a symbolic link: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listDirectoryFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`immutable directory contains an unsupported entry: ${relativePath}`);
    }
  }
  return files;
}

export async function sameDirectory(left, right, hashFile) {
  const [leftFiles, rightFiles] = await Promise.all([
    listDirectoryFiles(left),
    listDirectoryFiles(right)
  ]);
  if (leftFiles.length !== rightFiles.length) return false;
  for (let index = 0; index < leftFiles.length; index += 1) {
    if (leftFiles[index].toLowerCase() !== rightFiles[index].toLowerCase()) {
      return false;
    }
    const [leftHash, rightHash] = await Promise.all([
      hashFile(join(left, leftFiles[index])),
      hashFile(join(right, rightFiles[index]))
    ]);
    if (leftHash.size !== rightHash.size || leftHash.sha256 !== rightHash.sha256) {
      return false;
    }
  }
  return true;
}

export async function installImmutableDirectory({
  source,
  destination,
  compare,
  renameDirectory = rename
}) {
  const metadata = await pathExists(destination);
  if (metadata) {
    if (!metadata.isDirectory() || !(await compare())) {
      throw new Error(`immutable destination already exists with different content: ${destination}`);
    }
    return false;
  }
  await mkdir(dirname(destination), { recursive: true });
  await renameDirectory(source, destination);
  return true;
}

async function runStage(options, name, operation) {
  await options.onStage?.(name);
  return await operation();
}

export function assertAssetHash(actual, expected, label) {
  if (actual.size !== expected.size || actual.sha256 !== expected.sha256) {
    throw new Error(`${label} size or SHA-256 did not match the Release manifest`);
  }
}

function chooseLocale({ explicitLocale, systemLocale, language, record }) {
  const requested = explicitLocale ?? systemLocale;
  if (requested === undefined || requested === null || requested === "en-US") {
    return null;
  }
  let canonical;
  try {
    [canonical] = Intl.getCanonicalLocales(requested);
  } catch (error) {
    if (explicitLocale !== undefined) {
      throw new Error(`requested locale is invalid: ${requested}`, { cause: error });
    }
    return null;
  }
  if (canonical === language.locale) return record;
  if (explicitLocale !== undefined) {
    throw new Error(`requested locale is not installed: ${canonical}`);
  }
  return null;
}

export function statesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export async function installFromProvider(options) {
  if (!options?.provider) throw new Error("provider is required");
  if (!options.catalogPath) throw new Error("catalogPath is required");
  const env = options.env ?? process.env;
  const installRoot = resolve(
    options.installRoot ?? resolveInstallRoot(env)
  );
  if (!isAbsoluteLocalWindowsPath(installRoot)) {
    throw new Error("installRoot must be on a local Windows drive");
  }
  const statePath = join(installRoot, "state.json");
  const discover = options.discoverOfficialCodex ?? discoverOfficialCodex;
  const validateManifest = options.validateReleaseManifest ?? validateReleaseManifest;
  const hashFile = options.sha256File ?? sha256File;
  const extractZip = options.extractZipSecure ?? extractZipSecure;
  const validateLanguage = options.validateLanguagePack ?? validateLanguagePack;
  const smoke = options.smokeRunner ?? runBinarySmokeChecks;
  const readStateImpl = options.readState ?? readState;
  const writeState = options.writeStateAtomic ?? writeStateAtomic;
  const addPathEntry = options.addPathEntry ?? (async () => {
    throw new Error("PATH adapter is not implemented yet");
  });
  const removePathEntry = options.removePathEntry ?? (async () => ({ changed: false }));

  const official = await discover({ installRoot, env });
  const oldState = await readOptionalState(statePath, readStateImpl);
  let stagingRoot = null;
  let pathAdded = false;
  let stateSwitched = false;
  try {
    const rawManifest = await runStage(options, "manifest", () => options.provider.readManifest());
    const expectedCommit =
      options.expectedUpstreamCommit ?? rawManifest?.upstreamCommit;
    const manifest = validateManifest(rawManifest, {
      upstreamVersion: official.version,
      upstreamTag: options.expectedUpstreamTag ?? `rust-v${official.version}`,
      upstreamCommit: expectedCommit,
      platform: PLATFORM
    });

    await ensureOwnershipMarker(installRoot);
    stagingRoot = join(installRoot, "cache", `install-${randomUUID()}`);
    await mkdir(stagingRoot, { recursive: true });
    const ultraZip = join(stagingRoot, manifest.asset.name);
    const languageZip = join(stagingRoot, manifest.language.asset);
    const extractedRelease = join(stagingRoot, "release");
    const extractedLanguage = join(stagingRoot, "language");

    await runStage(options, "download-ultra", () =>
      options.provider.materializeAsset(manifest.asset.name, ultraZip)
    );
    const ultraArchiveHash = await runStage(options, "verify-ultra", () => hashFile(ultraZip));
    assertAssetHash(ultraArchiveHash, manifest.asset, "Ultra asset");
    await runStage(options, "extract-ultra", () =>
      extractZip(ultraZip, extractedRelease)
    );

    await runStage(options, "download-language", () =>
      options.provider.materializeAsset(manifest.language.asset, languageZip)
    );
    const languageArchiveHash = await runStage(options, "verify-language", () => hashFile(languageZip));
    assertAssetHash(languageArchiveHash, manifest.language, "language asset");
    await runStage(options, "extract-language", () =>
      extractZip(languageZip, extractedLanguage)
    );
    const language = await validateLanguage({
      packRoot: extractedLanguage,
      catalogPath: options.catalogPath
    });
    if (language.locale !== manifest.language.locale) {
      throw new Error("language pack locale does not match the Release manifest");
    }

    const stagedBinary = join(extractedRelease, "package", "bin", "codex.exe");
    const stagedResource = join(extractedLanguage, "messages.ftl");
    await runStage(options, "smoke-version", () => smoke({
      binaryPath: stagedBinary,
      binaryArgsPrefix: options.binaryArgsPrefix,
      upstreamVersion: manifest.upstreamVersion,
      language,
      resourcePath: stagedResource,
      env,
      spawn: options.spawn,
      timeoutMs: options.smokeTimeoutMs,
      phases: ["version"]
    }));
    await runStage(options, "smoke-zh-cn", () => smoke({
      binaryPath: stagedBinary,
      binaryArgsPrefix: options.binaryArgsPrefix,
      upstreamVersion: manifest.upstreamVersion,
      language,
      resourcePath: stagedResource,
      env,
      spawn: options.spawn,
      timeoutMs: options.smokeTimeoutMs,
      phases: ["zh-CN"]
    }));
    await runStage(options, "smoke-english", () => smoke({
      binaryPath: stagedBinary,
      binaryArgsPrefix: options.binaryArgsPrefix,
      upstreamVersion: manifest.upstreamVersion,
      language,
      resourcePath: stagedResource,
      env,
      spawn: options.spawn,
      timeoutMs: options.smokeTimeoutMs,
      phases: ["english"]
    }));

    await writeFile(
      join(extractedRelease, "release-manifest.json"),
      exactJson(manifest),
      "utf8"
    );
    const releaseId = `${manifest.upstreamVersion}-ultra.${manifest.ultraRevision}`;
    const finalRelease = join(
      installRoot,
      "releases",
      releaseId,
      manifest.platform
    );
    const finalLanguage = join(installRoot, "languages", language.locale);

    await runStage(options, "move-release", () =>
      installImmutableDirectory({
        source: extractedRelease,
        destination: finalRelease,
        compare: async () =>
          await sameDirectory(extractedRelease, finalRelease, hashFile)
      })
    );
    await runStage(options, "move-language", () =>
      installImmutableDirectory({
        source: extractedLanguage,
        destination: finalLanguage,
        compare: async () =>
          await sameDirectory(extractedLanguage, finalLanguage, hashFile)
      })
    );

    const finalBinary = join(finalRelease, "package", "bin", "codex.exe");
    const finalResource = join(finalLanguage, "messages.ftl");
    const finalManifest = join(finalLanguage, "manifest.json");
    const [binaryHash, binaryStat, resourceHash, resourceStat] = await Promise.all([
      hashFile(finalBinary),
      stat(finalBinary),
      hashFile(finalResource),
      stat(finalResource)
    ]);
    const buildRecord = {
      releaseId,
      upstreamVersion: manifest.upstreamVersion,
      ultraRevision: manifest.ultraRevision,
      platform: manifest.platform,
      binaryPath: finalBinary,
      size: binaryHash.size,
      mtimeMs: binaryStat.mtimeMs,
      sha256: binaryHash.sha256
    };
    const localeRecord = {
      id: language.locale,
      manifestPath: finalManifest,
      resourcePath: finalResource,
      size: resourceHash.size,
      mtimeMs: resourceStat.mtimeMs,
      sha256: resourceHash.sha256
    };
    const selectedLocale = chooseLocale({
      explicitLocale: options.locale,
      systemLocale: options.systemLocale ?? Intl.DateTimeFormat().resolvedOptions().locale,
      language,
      record: localeRecord
    });
    const replacesActiveRelease =
      oldState?.active !== null &&
      oldState?.active !== undefined &&
      oldState.active.releaseId !== buildRecord.releaseId;
    const nextState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      official,
      active: buildRecord,
      locale: selectedLocale,
      lastKnownGood:
        replacesActiveRelease
          ? { build: oldState.active, locale: oldState.locale }
          : oldState?.lastKnownGood ?? null
    };

    const binDirectory = join(installRoot, "bin");
    const pathResult = await runStage(options, "path-add", () => addPathEntry(binDirectory));
    pathAdded = pathResult?.changed === true;
    await runStage(options, "state-switch", async () => {
      if (!statesEqual(oldState, nextState)) {
        await writeState(statePath, nextState);
      }
    });
    stateSwitched = true;
    return {
      changed: !statesEqual(oldState, nextState),
      releaseId,
      state: nextState,
      languageMessages: language.messages
    };
  } catch (error) {
    if (pathAdded && !stateSwitched) {
      try {
        await removePathEntry(join(installRoot, "bin"));
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "installation failed and PATH rollback failed",
          { cause: error }
        );
      }
    }
    throw error;
  } finally {
    if (stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export async function updateFromProvider(options) {
  return await installFromProvider(options);
}

export async function installForkFromProvider(options) {
  if (!options?.provider) throw new Error("provider is required");
  const env = options.env ?? process.env;
  const installRoot = resolve(
    options.installRoot ?? resolveInstallRoot(env)
  );
  if (!isAbsoluteLocalWindowsPath(installRoot)) {
    throw new Error("installRoot must be on a local Windows drive");
  }

  const statePath = join(installRoot, "state.json");
  const discover = options.discoverOfficialCodex ?? discoverOfficialCodex;
  const validateManifest = options.validateForkManifest ?? validateForkManifest;
  const hashFile = options.sha256File ?? sha256File;
  const extractZip = options.extractZipSecure ?? extractZipSecure;
  const smoke = options.smokeRunner ?? runBinarySmokeChecks;
  const readStateImpl = options.readState ?? readState;
  const writeState = options.writeStateAtomic ?? writeStateAtomic;
  const prepareBin = options.prepareBin ?? (async () => {
    throw new Error("CCU bin preparation is not implemented");
  });
  const addPathEntry = options.addPathEntry ?? (async () => {
    throw new Error("PATH adapter is not implemented yet");
  });
  const removePathEntry = options.removePathEntry ?? (async () => ({ changed: false }));

  const official = await discover({ installRoot, env });
  const oldState = await readOptionalState(statePath, readStateImpl);
  let stagingRoot = null;
  let pathAdded = false;
  let stateSwitched = false;
  try {
    const rawManifest = await runStage(
      options,
      "manifest",
      () => options.provider.readManifest()
    );
    const manifest = validateManifest(rawManifest, { platform: PLATFORM });

    await ensureOwnershipMarker(installRoot);
    const recoveredReleases = oldState === null
      ? await quarantineOrphanedCcuReleases(installRoot, options)
      : [];
    stagingRoot = join(installRoot, "cache", `fork-install-${randomUUID()}`);
    await mkdir(stagingRoot, { recursive: true });
    const forkZip = join(stagingRoot, manifest.asset.name);
    const extractedRelease = join(stagingRoot, "release");

    await runStage(options, "download-fork", () =>
      options.provider.materializeAsset(manifest.asset.name, forkZip)
    );
    const archiveHash = await runStage(
      options,
      "verify-fork",
      () => hashFile(forkZip)
    );
    assertAssetHash(archiveHash, manifest.asset, "fork asset");
    await runStage(options, "extract-fork", () =>
      extractZip(forkZip, extractedRelease)
    );

    const stagedBinary = join(extractedRelease, "package", "bin", "codex.exe");
    await runStage(options, "smoke-version", () => smoke({
      binaryPath: stagedBinary,
      binaryArgsPrefix: options.binaryArgsPrefix,
      displayVersion: manifest.displayVersion,
      upstreamVersion: manifest.upstreamVersion,
      env,
      spawn: options.spawn,
      timeoutMs: options.smokeTimeoutMs,
      phases: ["version"]
    }));
    await writeFile(
      join(extractedRelease, FORK_MANIFEST_NAME),
      exactJson(manifest),
      "utf8"
    );

    const releaseId = manifest.displayVersion;
    const finalRelease = join(
      installRoot,
      "releases",
      releaseId,
      manifest.platform
    );
    await runStage(options, "move-release", () =>
      installImmutableDirectory({
        source: extractedRelease,
        destination: finalRelease,
        compare: async () =>
          await sameDirectory(extractedRelease, finalRelease, hashFile)
      })
    );

    const finalBinary = join(finalRelease, "package", "bin", "codex.exe");
    const [binaryHash, binaryStat] = await Promise.all([
      hashFile(finalBinary),
      stat(finalBinary)
    ]);
    const buildRecord = {
      releaseId,
      upstreamVersion: manifest.upstreamVersion,
      ultraRevision: manifest.ultraRevision,
      platform: manifest.platform,
      binaryPath: finalBinary,
      size: binaryHash.size,
      mtimeMs: binaryStat.mtimeMs,
      sha256: binaryHash.sha256
    };
    const nextState = {
      schemaVersion: STATE_SCHEMA_VERSION,
      official,
      active: buildRecord,
      locale: oldState?.locale ?? null,
      lastKnownGood: null
    };

    const binDirectory = join(installRoot, "bin");
    await runStage(options, "prepare-bin", () =>
      prepareBin({ installRoot, binDirectory })
    );
    const pathResult = await runStage(
      options,
      "path-add",
      () => addPathEntry(binDirectory)
    );
    pathAdded = pathResult?.changed === true;
    await runStage(options, "state-switch", async () => {
      if (!statesEqual(oldState, nextState)) {
        await writeState(statePath, nextState);
      }
    });
    stateSwitched = true;
    const cleanup = await pruneInactiveReleases(
      installRoot,
      buildRecord.releaseId,
      options
    );
    return {
      changed: !statesEqual(oldState, nextState),
      releaseId,
      manifest,
      state: nextState,
      recoveredReleases,
      ...cleanup
    };
  } catch (error) {
    if (pathAdded && !stateSwitched) {
      try {
        await removePathEntry(join(installRoot, "bin"));
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "fork installation failed and PATH rollback failed",
          { cause: error }
        );
      }
    }
    throw error;
  } finally {
    if (stagingRoot !== null) {
      await rm(stagingRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}
