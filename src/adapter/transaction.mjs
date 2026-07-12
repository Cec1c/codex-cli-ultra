import { createHash, randomUUID } from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

const DEFAULT_STATE_DIRECTORY = ".codex-ultra-mvp";
const HASH_PATTERN = /^[a-f0-9]{64}$/;

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

function hashState(state) {
  return sha256(Buffer.from(canonicalJson(state)));
}

async function pathExists(path, accessImpl = access) {
  try {
    await accessImpl(path);
    return true;
  } catch {
    return false;
  }
}

function assertRelativeSlashPath(relativePath) {
  if (
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\\") ||
    relativePath.includes("\0") ||
    isAbsolute(relativePath) ||
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
  return segments;
}

function resolveAdapterFilePath(root, relativePath) {
  const segments = assertRelativeSlashPath(relativePath);
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(resolvedRoot, ...segments);
  const pathRelative = relative(resolvedRoot, resolvedPath);
  const firstSegment = pathRelative.split(/[\\/]/, 1)[0];
  if (!pathRelative || isAbsolute(pathRelative) || firstSegment === "..") {
    throw new Error("unsafe adapter file path");
  }
  return resolvedPath;
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

function normalizeOperations(operations) {
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
    assertRelativeSlashPath(operation.relativePath);
    const normalized = { ...operation };
    if (operation.type === "create") {
      normalized.content = toBuffer(operation.content, "create content");
    } else {
      toBuffer(operation.anchor, "replace anchor");
      toBuffer(operation.replacement, "replace replacement");
    }
    const group = groups.get(operation.relativePath) ?? [];
    group.push(normalized);
    groups.set(operation.relativePath, group);
  }
  for (const [relativePath, group] of groups) {
    if (group.some((operation) => operation.type === "create") && group.length !== 1) {
      throw new Error(
        `create operation cannot share a path: ${relativePath}`
      );
    }
  }
  return groups;
}

function resolveStateRoot(sourceRoot, stateDirectory) {
  return resolveAdapterFilePath(sourceRoot, stateDirectory);
}

export async function planOperations(
  sourceRoot,
  operations,
  {
    stateDirectory = DEFAULT_STATE_DIRECTORY,
    accessImpl = access,
    readFileImpl = readFile
  } = {}
) {
  const resolvedRoot = resolve(sourceRoot);
  const stateRoot = resolveStateRoot(resolvedRoot, stateDirectory);
  const groups = normalizeOperations(operations);
  if (await pathExists(stateRoot, accessImpl)) {
    throw new Error("adapter state already exists");
  }

  const files = [];
  for (const [relativePath, group] of groups) {
    const targetPath = resolveAdapterFilePath(resolvedRoot, relativePath);
    if (group[0].type === "create") {
      if (await pathExists(targetPath, accessImpl)) {
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

    const before = await readFileImpl(targetPath);
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
    sourceRoot: resolvedRoot,
    stateRoot,
    files
  };
}

async function atomicWrite(
  targetPath,
  content,
  {
    mkdirImpl = mkdir,
    writeFileImpl = writeFile,
    renameImpl = rename,
    rmImpl = rm
  } = {}
) {
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  await mkdirImpl(dirname(targetPath), { recursive: true });
  try {
    await writeFileImpl(temporaryPath, content);
    await renameImpl(temporaryPath, targetPath);
  } catch (error) {
    try {
      await rmImpl(temporaryPath, { force: true });
    } catch {
      // Preserve the write failure that triggered cleanup.
    }
    throw error;
  }
}

function stateForPlan(plan, stateMetadata) {
  if (
    !stateMetadata ||
    typeof stateMetadata !== "object" ||
    Array.isArray(stateMetadata)
  ) {
    throw new Error("state metadata must be an object");
  }
  if (
    "schemaVersion" in stateMetadata ||
    "files" in stateMetadata ||
    "stateHash" in stateMetadata
  ) {
    throw new Error("state metadata uses a reserved field");
  }
  const state = {
    schemaVersion: 1,
    ...stateMetadata,
    files: plan.files.map((file) => ({
      relativePath: file.relativePath,
      created: file.created,
      beforeHash: file.beforeHash,
      afterHash: file.afterHash
    }))
  };
  return { ...state, stateHash: hashState(state) };
}

async function verifyPlanStillCurrent(
  plan,
  { accessImpl = access, readFileImpl = readFile } = {}
) {
  for (const file of plan.files) {
    const targetPath = resolveAdapterFilePath(
      plan.sourceRoot,
      file.relativePath
    );
    if (file.created) {
      if (await pathExists(targetPath, accessImpl)) {
        throw new Error(`source changed after planning: ${file.relativePath}`);
      }
      continue;
    }
    const current = await readFileImpl(targetPath);
    if (sha256(current) !== file.beforeHash) {
      throw new Error(`source changed after planning: ${file.relativePath}`);
    }
  }
}

async function rollbackAppliedFiles(plan, written) {
  const rollbackErrors = [];
  for (const file of [...written].reverse()) {
    const targetPath = resolveAdapterFilePath(
      plan.sourceRoot,
      file.relativePath
    );
    try {
      if (file.created) {
        await rm(targetPath, { force: true });
      } else {
        await atomicWrite(targetPath, file.before);
      }
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

export async function applyOperations(sourceRoot, operations, options = {}) {
  const plan = await planOperations(sourceRoot, operations, options);
  const {
    accessImpl = access,
    mkdirImpl = mkdir,
    readFileImpl = readFile,
    renameImpl = rename,
    rmImpl = rm,
    stateMetadata = {},
    writeFileImpl = writeFile
  } = options;
  const writeDependencies = {
    mkdirImpl,
    writeFileImpl,
    renameImpl,
    rmImpl
  };
  const backupsRoot = resolveAdapterFilePath(plan.stateRoot, "backups");
  const statePath = resolveAdapterFilePath(plan.stateRoot, "state.json");
  const state = stateForPlan(plan, stateMetadata);
  const written = [];

  try {
    await mkdirImpl(backupsRoot, { recursive: true });
    for (const file of plan.files) {
      if (file.created) {
        continue;
      }
      const backupPath = resolveAdapterFilePath(
        backupsRoot,
        file.relativePath
      );
      await atomicWrite(backupPath, file.before, writeDependencies);
    }
    await atomicWrite(
      statePath,
      Buffer.from(JSON.stringify(state, null, 2) + "\n"),
      writeDependencies
    );
    await verifyPlanStillCurrent(plan, { accessImpl, readFileImpl });

    for (const file of plan.files) {
      const targetPath = resolveAdapterFilePath(
        plan.sourceRoot,
        file.relativePath
      );
      await atomicWrite(targetPath, file.after, writeDependencies);
      written.push(file);
    }
    return state;
  } catch (error) {
    const rollbackErrors = await rollbackAppliedFiles(plan, written);
    try {
      await rm(plan.stateRoot, { recursive: true, force: true });
    } catch (cleanupError) {
      rollbackErrors.push(cleanupError);
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

function validateState(state) {
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
  const relativePaths = new Set();
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
    assertRelativeSlashPath(file.relativePath);
    if (relativePaths.has(file.relativePath)) {
      throw new Error("invalid adapter state");
    }
    relativePaths.add(file.relativePath);
    return {
      relativePath: file.relativePath,
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
  return files;
}

async function loadRevertPlan(
  sourceRoot,
  stateRoot,
  { readFileImpl = readFile } = {}
) {
  const statePath = resolveAdapterFilePath(stateRoot, "state.json");
  let state;
  try {
    state = JSON.parse(await readFileImpl(statePath, "utf8"));
  } catch (error) {
    throw new Error("invalid adapter state", { cause: error });
  }
  const files = validateState(state);
  const backupsRoot = resolveAdapterFilePath(stateRoot, "backups");
  const prepared = [];

  for (const file of files) {
    const targetPath = resolveAdapterFilePath(sourceRoot, file.relativePath);
    const current = await readFileImpl(targetPath);
    if (sha256(current) !== file.afterHash) {
      throw new Error(
        `patched file changed after apply: ${file.relativePath}`
      );
    }
    let backup = null;
    if (!file.created) {
      const backupPath = resolveAdapterFilePath(
        backupsRoot,
        file.relativePath
      );
      backup = await readFileImpl(backupPath);
      if (sha256(backup) !== file.beforeHash) {
        throw new Error(`adapter backup changed: ${file.relativePath}`);
      }
    }
    prepared.push({ ...file, targetPath, current, backup });
  }
  return { state, files: prepared };
}

async function rollbackRevertedFiles(processed) {
  const rollbackErrors = [];
  for (const file of [...processed].reverse()) {
    try {
      await atomicWrite(file.targetPath, file.current);
    } catch (error) {
      rollbackErrors.push(error);
    }
  }
  return rollbackErrors;
}

export async function revertOperations(sourceRoot, options = {}) {
  const resolvedRoot = resolve(sourceRoot);
  const stateRoot = resolveStateRoot(
    resolvedRoot,
    options.stateDirectory ?? DEFAULT_STATE_DIRECTORY
  );
  const {
    mkdirImpl = mkdir,
    readFileImpl = readFile,
    renameImpl = rename,
    rmImpl = rm,
    writeFileImpl = writeFile
  } = options;
  const writeDependencies = {
    mkdirImpl,
    writeFileImpl,
    renameImpl,
    rmImpl
  };
  const revertPlan = await loadRevertPlan(resolvedRoot, stateRoot, {
    readFileImpl
  });
  const processed = [];

  try {
    for (const file of revertPlan.files) {
      if (file.created) {
        await rmImpl(file.targetPath, { force: false });
      } else {
        await atomicWrite(file.targetPath, file.backup, writeDependencies);
      }
      processed.push(file);
    }
  } catch (error) {
    const rollbackErrors = await rollbackRevertedFiles(processed);
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        "adapter revert failed and rollback was incomplete"
      );
    }
    throw error;
  }

  await rmImpl(stateRoot, { recursive: true, force: true });
  return revertPlan.state;
}
