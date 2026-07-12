import { createHash, randomUUID } from "node:crypto";
import {
  link,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import {
  isAbsolute,
  posix,
  resolve,
  win32
} from "node:path";

const DEFAULT_STATE_DIRECTORY = ".codex-ultra-mvp";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function resolveFsOps(options = {}) {
  return {
    linkImpl: options.linkImpl ?? link,
    lstatImpl: options.lstatImpl ?? lstat,
    mkdirImpl: options.mkdirImpl ?? mkdir,
    readFileImpl: options.readFileImpl ?? readFile,
    readdirImpl: options.readdirImpl ?? readdir,
    realpathImpl: options.realpathImpl ?? realpath,
    renameImpl: options.renameImpl ?? rename,
    rmImpl: options.rmImpl ?? rm,
    writeFileImpl: options.writeFileImpl ?? writeFile
  };
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  throw new Error("adapter state contains an unsupported value");
}

function normalizeJsonValue(value) {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeJsonValue(item));
  }
  if (
    value &&
    typeof value === "object" &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  ) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        normalizeJsonValue(item)
      ])
    );
  }
  throw new Error("state metadata must contain only plain JSON values");
}

function normalizeStateMetadata(stateMetadata) {
  if (
    !stateMetadata ||
    typeof stateMetadata !== "object" ||
    Array.isArray(stateMetadata) ||
    (Object.getPrototypeOf(stateMetadata) !== Object.prototype &&
      Object.getPrototypeOf(stateMetadata) !== null)
  ) {
    throw new Error("state metadata must contain only plain JSON values");
  }
  const normalized = normalizeJsonValue(stateMetadata);
  if (
    "schemaVersion" in normalized ||
    "files" in normalized ||
    "stateHash" in normalized
  ) {
    throw new Error("state metadata uses a reserved field");
  }
  return normalized;
}

function hashState(state) {
  // Integrity checksum for accidental corruption, not authentication against
  // an actor that can rewrite both local state and source files.
  return sha256(Buffer.from(canonicalJson(state)));
}

function isMissingPathError(error) {
  return error?.code === "ENOENT";
}

async function lstatIfExists(path, lstatImpl = lstat) {
  try {
    return await lstatImpl(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function isWindowsPlatform(platform) {
  return platform === "win32";
}

function windowsSegmentIsReserved(segment) {
  const baseName = segment.split(".", 1)[0].toUpperCase();
  return /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(baseName);
}

function assertRelativeSlashPath(relativePath, platform = process.platform) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath) ||
    posix.isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath)
  ) {
    throw new Error("unsafe adapter file path");
  }
  const segments = relativePath.split("/");
  if (
    segments.some(
      (segment) => segment.length === 0 || segment === "." || segment === ".."
    )
  ) {
    throw new Error("unsafe adapter file path");
  }
  if (
    isWindowsPlatform(platform) &&
    segments.some(
      (segment) =>
        segment.includes(":") ||
        /[. ]$/.test(segment) ||
        windowsSegmentIsReserved(segment)
    )
  ) {
    throw new Error("unsafe Windows adapter path");
  }
  return {
    segments,
    identity: isWindowsPlatform(platform)
      ? segments.map((segment) => segment.toLowerCase()).join("/")
      : relativePath
  };
}

function absolutePathIdentity(path, platform) {
  const normalized = resolve(path).replaceAll("\\", "/");
  return isWindowsPlatform(platform) ? normalized.toLowerCase() : normalized;
}

async function createPathContext(
  sourceRoot,
  {
    platform = process.platform,
    lstatImpl = lstat,
    realpathImpl = realpath
  } = {}
) {
  const requestedRoot = resolve(sourceRoot);
  const sourceRootReal = resolve(await realpathImpl(requestedRoot));
  const rootStats = await lstatImpl(sourceRootReal);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("unsafe adapter source root");
  }
  return {
    sourceRoot: sourceRootReal,
    sourceRootIdentity: absolutePathIdentity(sourceRootReal, platform),
    platform,
    lstatImpl,
    realpathImpl
  };
}

async function assertSourceRootStable(context) {
  const rootStats = await context.lstatImpl(context.sourceRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("unsafe adapter source root");
  }
  const currentRoot = await context.realpathImpl(context.sourceRoot);
  if (
    absolutePathIdentity(currentRoot, context.platform) !==
    context.sourceRootIdentity
  ) {
    throw new Error("unsafe adapter source root");
  }
}

async function inspectSafePath(context, relativePath) {
  const { segments, identity } = assertRelativeSlashPath(
    relativePath,
    context.platform
  );
  await assertSourceRootStable(context);
  let currentPath = context.sourceRoot;
  let exists = true;
  let stats = null;
  for (const segment of segments) {
    currentPath = resolve(currentPath, segment);
    stats = await lstatIfExists(currentPath, context.lstatImpl);
    if (stats === null) {
      exists = false;
      break;
    }
    if (stats.isSymbolicLink()) {
      throw new Error(`unsafe adapter reparse point: ${relativePath}`);
    }
    const canonicalPath = await context.realpathImpl(currentPath);
    if (
      absolutePathIdentity(canonicalPath, context.platform) !==
      absolutePathIdentity(currentPath, context.platform)
    ) {
      throw new Error(`unsafe adapter reparse point: ${relativePath}`);
    }
  }
  return {
    path: resolve(context.sourceRoot, ...segments),
    relativePath,
    identity,
    exists,
    stats: exists ? stats : null
  };
}

function toBuffer(value, fieldName) {
  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (typeof value === "string") {
    return Buffer.from(value, "utf8");
  }
  throw new Error(`${fieldName} must be a string or byte buffer`);
}

function operationBytes(value, fieldName, source, preserveLineEndings) {
  if (!preserveLineEndings) {
    return toBuffer(value, fieldName);
  }
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string when preserving line endings`);
  }
  const newline = source.includes(Buffer.from("\r\n")) ? "\r\n" : "\n";
  return Buffer.from(value.replaceAll("\r\n", "\n").replaceAll("\n", newline));
}

function countOccurrences(source, anchor) {
  if (anchor.length === 0) {
    throw new Error("replace anchor must not be empty");
  }
  let count = 0;
  let offset = 0;
  while (offset <= source.length - anchor.length) {
    const index = source.indexOf(anchor, offset);
    if (index === -1) {
      break;
    }
    count += 1;
    offset = index + anchor.length;
  }
  return count;
}

function replaceExact(source, operation) {
  const anchor = operationBytes(
    operation.anchor,
    "replace anchor",
    source,
    operation.preserveLineEndings
  );
  const replacement = operationBytes(
    operation.replacement,
    "replace replacement",
    source,
    operation.preserveLineEndings
  );
  const count = countOccurrences(source, anchor);
  if (count !== 1) {
    const label = operation.label ?? operation.relativePath;
    throw new Error(
      `anchor drift for ${label}: expected 1 match, found ${count}`
    );
  }
  const index = source.indexOf(anchor);
  return Buffer.concat([
    source.subarray(0, index),
    replacement,
    source.subarray(index + anchor.length)
  ]);
}

function normalizeOperations(operations, platform = process.platform) {
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error("operations must be a non-empty array");
  }
  const groups = new Map();
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") {
      throw new Error("invalid adapter operation");
    }
    if (operation.type !== "replace" && operation.type !== "create") {
      throw new Error("invalid adapter operation type");
    }
    const { identity } = assertRelativeSlashPath(
      operation.relativePath,
      platform
    );
    const normalized = { ...operation };
    if (operation.type === "create") {
      normalized.content = toBuffer(operation.content, "create content");
    } else {
      toBuffer(operation.anchor, "replace anchor");
      toBuffer(operation.replacement, "replace replacement");
    }
    const existingGroup = groups.get(identity);
    if (
      existingGroup &&
      existingGroup[0].relativePath !== operation.relativePath
    ) {
      throw new Error(
        `adapter path identity collision: ${existingGroup[0].relativePath} and ${operation.relativePath}`
      );
    }
    const group = existingGroup ?? [];
    group.push(normalized);
    groups.set(identity, group);
  }
  for (const group of groups.values()) {
    const relativePath = group[0].relativePath;
    if (group.some((operation) => operation.type === "create") && group.length !== 1) {
      throw new Error(
        `create operation cannot share a path: ${relativePath}`
      );
    }
  }
  return groups;
}

export async function planOperations(
  sourceRoot,
  operations,
  options = {}
) {
  const stateDirectory = options.stateDirectory ?? DEFAULT_STATE_DIRECTORY;
  const platform = options.platform ?? process.platform;
  const fsOps = resolveFsOps(options);
  const context = await createPathContext(sourceRoot, {
    platform,
    lstatImpl: fsOps.lstatImpl,
    realpathImpl: fsOps.realpathImpl
  });
  const stateInfo = await inspectSafePath(context, stateDirectory);
  const stateRoot = stateInfo.path;
  const groups = normalizeOperations(operations, platform);
  for (const group of groups.values()) {
    const { identity: operationIdentity } = assertRelativeSlashPath(
      group[0].relativePath,
      platform
    );
    if (
      operationIdentity === stateInfo.identity ||
      operationIdentity.startsWith(`${stateInfo.identity}/`) ||
      stateInfo.identity.startsWith(`${operationIdentity}/`)
    ) {
      throw new Error("adapter state path overlaps an operation path");
    }
  }
  if (stateInfo.exists) {
    throw new Error("adapter state already exists");
  }

  const files = [];
  for (const group of groups.values()) {
    const relativePath = group[0].relativePath;
    const targetInfo = await inspectSafePath(context, relativePath);
    const targetPath = targetInfo.path;
    if (group[0].type === "create") {
      if (targetInfo.exists) {
        throw new Error(`create target already exists: ${relativePath}`);
      }
      const after = Buffer.from(group[0].content);
      files.push({
        relativePath,
        before: null,
        after,
        created: true,
        beforeHash: null,
        afterHash: sha256(after)
      });
      continue;
    }

    const before = await fsOps.readFileImpl(targetPath);
    let after = Buffer.from(before);
    for (const operation of group) {
      after = replaceExact(after, operation);
    }
    files.push({
      relativePath,
      before: Buffer.from(before),
      after,
      created: false,
      beforeHash: sha256(before),
      afterHash: sha256(after)
    });
  }

  return {
    sourceRoot: context.sourceRoot,
    stateRoot,
    stateDirectory,
    files,
    pathContext: context
  };
}

function parentRelativePath(relativePath) {
  const separator = relativePath.lastIndexOf("/");
  return separator === -1 ? null : relativePath.slice(0, separator);
}

async function ensureParentDirectory(context, relativePath, fsOps) {
  const parentRelative = parentRelativePath(relativePath);
  if (parentRelative === null) {
    await assertSourceRootStable(context);
    return context.sourceRoot;
  }
  const before = await inspectSafePath(context, parentRelative);
  if (before.exists && !before.stats.isDirectory()) {
    throw new Error(`adapter parent is not a directory: ${parentRelative}`);
  }
  await fsOps.mkdirImpl(before.path, { recursive: true });
  const after = await inspectSafePath(context, parentRelative);
  if (!after.exists || !after.stats.isDirectory()) {
    throw new Error(`adapter parent is not a directory: ${parentRelative}`);
  }
  return after.path;
}

async function assertSafeTree(context, relativePath, fsOps) {
  const rootInfo = await inspectSafePath(context, relativePath);
  if (!rootInfo.exists || !rootInfo.stats.isDirectory()) {
    return rootInfo;
  }
  const entries = await fsOps.readdirImpl(rootInfo.path, {
    withFileTypes: true
  });
  for (const entry of entries) {
    const childRelativePath = `${relativePath}/${entry.name}`;
    const childInfo = await inspectSafePath(context, childRelativePath);
    if (childInfo.exists && childInfo.stats.isDirectory()) {
      await assertSafeTree(context, childRelativePath, fsOps);
    }
  }
  return rootInfo;
}

async function safeRemove(context, relativePath, options, fsOps) {
  let targetInfo = await inspectSafePath(context, relativePath);
  if (!targetInfo.exists && options?.force) {
    return;
  }
  if (options?.recursive) {
    await assertSafeTree(context, relativePath, fsOps);
  }
  targetInfo = await inspectSafePath(context, relativePath);
  await fsOps.rmImpl(targetInfo.path, options);
}

async function atomicWrite(context, relativePath, content, fsOps) {
  const targetInfo = await inspectSafePath(context, relativePath);
  await ensureParentDirectory(context, relativePath, fsOps);
  const temporaryRelativePath =
    `${relativePath}.tmp-${process.pid}-${randomUUID()}`;
  const temporaryInfo = await inspectSafePath(
    context,
    temporaryRelativePath
  );
  if (temporaryInfo.exists) {
    throw createTargetExistsError(temporaryRelativePath);
  }
  let failure = null;
  try {
    await fsOps.writeFileImpl(temporaryInfo.path, content, { flag: "wx" });
    await inspectSafePath(context, temporaryRelativePath);
    await inspectSafePath(context, relativePath);
    await fsOps.renameImpl(temporaryInfo.path, targetInfo.path);
  } catch (error) {
    failure = error;
  }
  try {
    await safeRemove(
      context,
      temporaryRelativePath,
      { force: true },
      fsOps
    );
  } catch (cleanupError) {
    if (failure) {
      throw new AggregateError(
        [failure, cleanupError],
        "adapter write failed and temporary cleanup failed"
      );
    }
    throw cleanupError;
  }
  if (failure) {
    throw failure;
  }
}

function createTargetExistsError(relativePath) {
  return Object.assign(
    new Error(`create target already exists: ${relativePath}`),
    { code: "EEXIST" }
  );
}

async function atomicCreate(
  context,
  relativePath,
  content,
  {
    beforeCommit,
    beforeWrite,
    onCommitted,
    fsOps
  }
) {
  const targetInfo = await inspectSafePath(context, relativePath);
  await ensureParentDirectory(context, relativePath, fsOps);
  const temporaryRelativePath =
    `${relativePath}.tmp-${process.pid}-${randomUUID()}`;
  const temporaryInfo = await inspectSafePath(
    context,
    temporaryRelativePath
  );
  if (temporaryInfo.exists) {
    throw createTargetExistsError(temporaryRelativePath);
  }
  let failure = null;
  try {
    await beforeWrite();
    await fsOps.writeFileImpl(temporaryInfo.path, content, { flag: "wx" });
    await inspectSafePath(context, temporaryRelativePath);
    await beforeCommit();
    await inspectSafePath(context, relativePath);
    await fsOps.linkImpl(temporaryInfo.path, targetInfo.path);
    onCommitted();
  } catch (error) {
    failure = error;
  }
  try {
    await safeRemove(
      context,
      temporaryRelativePath,
      { force: true },
      fsOps
    );
  } catch (cleanupError) {
    if (failure) {
      throw new AggregateError(
        [failure, cleanupError],
        "adapter create failed and temporary cleanup failed"
      );
    }
    throw cleanupError;
  }
  if (failure) {
    throw failure;
  }
}

function stateForPlan(plan, stateMetadata) {
  const normalizedMetadata = normalizeStateMetadata(stateMetadata);
  const state = {
    schemaVersion: 1,
    ...normalizedMetadata,
    files: plan.files.map((file) => ({
      relativePath: file.relativePath,
      created: file.created,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash
    }))
  };
  return { ...state, stateHash: hashState(state) };
}

async function verifyPlanStillCurrent(plan, fsOps) {
  for (const file of plan.files) {
    const targetInfo = await inspectSafePath(
      plan.pathContext,
      file.relativePath
    );
    const targetPath = targetInfo.path;
    if (file.created) {
      if (targetInfo.exists) {
        throw new Error(`source changed after planning: ${file.relativePath}`);
      }
      continue;
    }
    const current = await fsOps.readFileImpl(targetPath);
    if (sha256(current) !== file.beforeHash) {
      throw new Error(`source changed after planning: ${file.relativePath}`);
    }
  }
}

async function rollbackAppliedFiles(plan, written, fsOps) {
  const rollbackErrors = [];
  for (const file of [...written].reverse()) {
    try {
      if (file.created) {
        await safeRemove(
          plan.pathContext,
          file.relativePath,
          { force: true },
          fsOps
        );
      } else {
        await atomicWrite(
          plan.pathContext,
          file.relativePath,
          file.before,
          fsOps
        );
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

export async function applyOperations(sourceRoot, operations, options = {}) {
  const fsOps = resolveFsOps(options);
  const plan = await planOperations(sourceRoot, operations, options);
  const stateMetadata = options.stateMetadata ?? {};
  const backupsRelativePath = `${plan.stateDirectory}/backups`;
  const stateRelativePath = `${plan.stateDirectory}/state.json`;
  const state = stateForPlan(plan, stateMetadata);
  const written = [];

  try {
    for (const file of plan.files) {
      if (file.created) {
        continue;
      }
      const backupRelativePath =
        `${backupsRelativePath}/${file.relativePath}`;
      await atomicWrite(
        plan.pathContext,
        backupRelativePath,
        file.before,
        fsOps
      );
    }
    await atomicWrite(
      plan.pathContext,
      stateRelativePath,
      Buffer.from(JSON.stringify(state, null, 2) + "\n"),
      fsOps
    );
    await verifyPlanStillCurrent(plan, fsOps);

    for (const file of plan.files) {
      if (file.created) {
        const assertCreateTargetMissing = async () => {
          const targetInfo = await inspectSafePath(
            plan.pathContext,
            file.relativePath
          );
          if (targetInfo.exists) {
            throw createTargetExistsError(file.relativePath);
          }
        };
        await atomicCreate(plan.pathContext, file.relativePath, file.after, {
          fsOps,
          beforeWrite: assertCreateTargetMissing,
          beforeCommit: assertCreateTargetMissing,
          onCommitted: () => written.push(file)
        });
      } else {
        await atomicWrite(
          plan.pathContext,
          file.relativePath,
          file.after,
          fsOps
        );
        written.push(file);
      }
    }
    return state;
  } catch (error) {
    const rollbackErrors = await rollbackAppliedFiles(plan, written, fsOps);
    if (rollbackErrors.length === 0) {
      try {
        await safeRemove(
          plan.pathContext,
          plan.stateDirectory,
          { recursive: true, force: true },
          fsOps
        );
      } catch (cleanupError) {
        rollbackErrors.push(cleanupError);
      }
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "adapter apply failed and rollback was incomplete"
      );
    }
    throw error;
  }
}

function stateMetadataFrom(state) {
  const {
    schemaVersion: _schemaVersion,
    files: _files,
    stateHash: _stateHash,
    ...metadata
  } = state;
  return metadata;
}

function validateExpectedFiles(expectedFiles, platform) {
  if (!Array.isArray(expectedFiles) || expectedFiles.length === 0) {
    throw new Error("expected state files must be a non-empty array");
  }
  const identities = new Set();
  return expectedFiles.map((file) => {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      typeof file.created !== "boolean"
    ) {
      throw new Error("invalid expected state file");
    }
    const { identity } = assertRelativeSlashPath(
      file.relativePath,
      platform
    );
    if (identities.has(identity)) {
      throw new Error("adapter path identity collision in expected state files");
    }
    identities.add(identity);
    return {
      relativePath: file.relativePath,
      identity,
      created: file.created
    };
  });
}

function validateState(
  state,
  {
    expectedFiles,
    expectedStateMetadata,
    platform = process.platform
  } = {}
) {
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.schemaVersion !== 1 ||
    !Array.isArray(state.files) ||
    state.files.length === 0
  ) {
    throw new Error("invalid adapter state");
  }
  const identities = new Set();
  const files = state.files.map((file) => {
    if (
      !file ||
      typeof file !== "object" ||
      Array.isArray(file) ||
      typeof file.created !== "boolean" ||
      !HASH_PATTERN.test(file.afterHash) ||
      (file.created
        ? file.beforeHash !== null
        : !HASH_PATTERN.test(file.beforeHash))
    ) {
      throw new Error("invalid adapter state");
    }
    const { identity } = assertRelativeSlashPath(
      file.relativePath,
      platform
    );
    if (identities.has(identity)) {
      throw new Error("invalid adapter state");
    }
    identities.add(identity);
    return {
      relativePath: file.relativePath,
      identity,
      created: file.created,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash
    };
  });
  if (!HASH_PATTERN.test(state.stateHash)) {
    throw new Error("invalid adapter state");
  }
  const { stateHash, ...unsignedState } = state;
  if (hashState(unsignedState) !== stateHash) {
    throw new Error("adapter state changed");
  }
  if (expectedStateMetadata !== undefined) {
    const normalizedExpectedMetadata = normalizeStateMetadata(
      expectedStateMetadata
    );
    if (
      canonicalJson(stateMetadataFrom(state)) !==
      canonicalJson(normalizedExpectedMetadata)
    ) {
      throw new Error("adapter state metadata mismatch");
    }
  }
  if (expectedFiles !== undefined) {
    const normalizedExpectedFiles = validateExpectedFiles(
      expectedFiles,
      platform
    );
    const actualByIdentity = new Map(
      files.map((file) => [file.identity, file])
    );
    if (
      normalizedExpectedFiles.length !== files.length ||
      normalizedExpectedFiles.some((expected) => {
        const actual = actualByIdentity.get(expected.identity);
        return (
          !actual ||
          actual.relativePath !== expected.relativePath ||
          actual.created !== expected.created
        );
      })
    ) {
      throw new Error("adapter state file allowlist mismatch");
    }
  }
  return files;
}

async function readValidatedState(
  context,
  stateDirectory,
  fsOps,
  validationOptions,
  { allowMissing = false } = {}
) {
  const stateRootInfo = await inspectSafePath(context, stateDirectory);
  if (!stateRootInfo.exists) {
    if (allowMissing) {
      return null;
    }
    throw new Error("invalid adapter state");
  }
  await assertSafeTree(context, stateDirectory, fsOps);
  const stateRelativePath = `${stateDirectory}/state.json`;
  const statePathInfo = await inspectSafePath(context, stateRelativePath);
  if (!statePathInfo.exists) {
    throw new Error("invalid adapter state");
  }
  let state;
  try {
    state = JSON.parse(await fsOps.readFileImpl(statePathInfo.path, "utf8"));
  } catch (error) {
    throw new Error("invalid adapter state", { cause: error });
  }
  const files = validateState(state, validationOptions);
  return { state, files, stateRoot: stateRootInfo.path };
}

export async function inspectOperationsState(sourceRoot, options = {}) {
  const fsOps = resolveFsOps(options);
  const platform = options.platform ?? process.platform;
  const stateDirectory = options.stateDirectory ?? DEFAULT_STATE_DIRECTORY;
  const context = await createPathContext(sourceRoot, {
    platform,
    lstatImpl: fsOps.lstatImpl,
    realpathImpl: fsOps.realpathImpl
  });
  return readValidatedState(
    context,
    stateDirectory,
    fsOps,
    {
      expectedFiles: options.expectedFiles,
      expectedStateMetadata: options.expectedStateMetadata,
      platform
    },
    { allowMissing: true }
  );
}

async function loadRevertPlan(
  context,
  stateDirectory,
  fsOps,
  validationOptions
) {
  const validated = await readValidatedState(
    context,
    stateDirectory,
    fsOps,
    validationOptions
  );
  const { state, stateRoot } = validated;
  const files = validated.files;
  const backupsRelativePath = `${stateDirectory}/backups`;
  const prepared = [];

  for (const file of files) {
    const targetInfo = await inspectSafePath(context, file.relativePath);
    let current = null;
    let backup = null;
    let action = "none";
    if (file.created) {
      if (targetInfo.exists) {
        current = await fsOps.readFileImpl(targetInfo.path);
        if (sha256(current) !== file.afterHash) {
          throw new Error(
            `patched file changed after apply: ${file.relativePath}`
          );
        }
        action = "remove";
      }
    } else {
      if (!targetInfo.exists) {
        throw new Error(
          `patched file changed after apply: ${file.relativePath}`
        );
      }
      current = await fsOps.readFileImpl(targetInfo.path);
      const currentHash = sha256(current);
      if (currentHash === file.afterHash) {
        action = "restore";
      } else if (currentHash !== file.beforeHash) {
        throw new Error(
          `patched file changed after apply: ${file.relativePath}`
        );
      }
      const backupRelativePath = `${backupsRelativePath}/${file.relativePath}`;
      const backupInfo = await inspectSafePath(context, backupRelativePath);
      if (!backupInfo.exists) {
        throw new Error(`adapter backup changed: ${file.relativePath}`);
      }
      backup = await fsOps.readFileImpl(backupInfo.path);
      if (sha256(backup) !== file.beforeHash) {
        throw new Error(`adapter backup changed: ${file.relativePath}`);
      }
    }
    prepared.push({
      relativePath: file.relativePath,
      created: file.created,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash,
      action,
      targetPath: targetInfo.path,
      current,
      backup
    });
  }
  return { state, stateRoot, files: prepared };
}

async function rollbackRevertedFiles(context, processed, fsOps) {
  const rollbackErrors = [];
  for (const file of [...processed].reverse()) {
    try {
      if (file.created) {
        const assertTargetMissing = async () => {
          const targetInfo = await inspectSafePath(
            context,
            file.relativePath
          );
          if (targetInfo.exists) {
            throw createTargetExistsError(file.relativePath);
          }
        };
        await atomicCreate(context, file.relativePath, file.current, {
          fsOps,
          beforeWrite: assertTargetMissing,
          beforeCommit: assertTargetMissing,
          onCommitted: () => {}
        });
      } else {
        await atomicWrite(
          context,
          file.relativePath,
          file.current,
          fsOps
        );
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

export async function revertOperations(sourceRoot, options = {}) {
  const fsOps = resolveFsOps(options);
  const stateDirectory = options.stateDirectory ?? DEFAULT_STATE_DIRECTORY;
  const context = await createPathContext(sourceRoot, {
    platform: options.platform ?? process.platform,
    lstatImpl: fsOps.lstatImpl,
    realpathImpl: fsOps.realpathImpl
  });
  const revertPlan = await loadRevertPlan(
    context,
    stateDirectory,
    fsOps,
    {
      expectedFiles: options.expectedFiles,
      expectedStateMetadata: options.expectedStateMetadata,
      platform: options.platform ?? process.platform
    }
  );
  const processed = [];

  try {
    for (const file of revertPlan.files) {
      if (file.action === "none") {
        continue;
      }
      if (file.action === "remove") {
        await safeRemove(
          context,
          file.relativePath,
          { force: false },
          fsOps
        );
      } else {
        await atomicWrite(
          context,
          file.relativePath,
          file.backup,
          fsOps
        );
      }
      processed.push(file);
    }
  } catch (error) {
    const rollbackErrors = await rollbackRevertedFiles(
      context,
      processed,
      fsOps
    );
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "adapter revert failed and rollback was incomplete"
      );
    }
    throw error;
  }

  await safeRemove(
    context,
    stateDirectory,
    { recursive: true, force: true },
    fsOps
  );
  return revertPlan.state;
}
