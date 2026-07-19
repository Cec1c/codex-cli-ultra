import { randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

export const HERMES_STATUS_LINE_ITEMS = Object.freeze([
  "model-with-reasoning",
  "context-tokens",
  "context-progress",
  "session-timing"
]);

export const STATUS_LINE_CONFIG_BACKUP = "ccu-statusline-config-backup.json";

const BACKUP_SCHEMA_VERSION = 1;
const STATUS_LINE_KEY = "status_line";
const COLORS_KEY = "status_line_use_colors";

async function exists(path, statPath = lstat) {
  try {
    return await statPath(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function newlineFor(source) {
  return source.includes("\r\n") ? "\r\n" : "\n";
}

function findTuiSection(source) {
  const headerPattern = /^[ \t]*\[tui\][ \t]*(?:#.*)?(?:\r?\n|$)/gm;
  const match = headerPattern.exec(source);
  if (!match) return null;
  const nextHeaderPattern = /^[ \t]*\[\[?[^\r\n]+\]?\][ \t]*(?:#.*)?(?:\r?\n|$)/gm;
  nextHeaderPattern.lastIndex = match.index + match[0].length;
  const next = nextHeaderPattern.exec(source);
  return {
    start: match.index,
    headerEnd: match.index + match[0].length,
    end: next?.index ?? source.length
  };
}

function assignmentEnd(source, valueStart, limit) {
  let squareDepth = 0;
  let braceDepth = 0;
  let quote = null;
  let escaped = false;
  let comment = false;
  let sawValue = false;
  for (let index = valueStart; index < limit; index += 1) {
    const char = source[index];
    if (comment) {
      if (char === "\n") {
        if (squareDepth === 0 && braceDepth === 0 && sawValue) return index + 1;
        comment = false;
      }
      continue;
    }
    if (quote !== null) {
      if (quote === '"' && escaped) {
        escaped = false;
        continue;
      }
      if (quote === '"' && char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      sawValue = true;
      continue;
    }
    if (char === "#") {
      comment = true;
      continue;
    }
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (!/\s/.test(char)) sawValue = true;
    if (
      (char === "\n" || char === "\r") &&
      squareDepth === 0 &&
      braceDepth === 0 &&
      sawValue
    ) {
      return char === "\r" && source[index + 1] === "\n" ? index + 2 : index + 1;
    }
  }
  return limit;
}

function findAssignment(source, section, key) {
  if (!section) return null;
  const body = source.slice(section.headerEnd, section.end);
  const pattern = new RegExp(`^[ \\t]*${key}[ \\t]*=`, "gm");
  const match = pattern.exec(body);
  if (!match) return null;
  const start = section.headerEnd + match.index;
  const equals = source.indexOf("=", start);
  const end = assignmentEnd(source, equals + 1, section.end);
  return {
    start,
    end,
    raw: source.slice(start, end),
    value: source.slice(equals + 1, end)
  };
}

function stripTomlComments(source) {
  let output = "";
  let quote = null;
  let escaped = false;
  let comment = false;
  for (const char of source) {
    if (comment) {
      if (char === "\n" || char === "\r") {
        comment = false;
        output += char;
      }
      continue;
    }
    if (quote !== null) {
      output += char;
      if (quote === '"' && escaped) {
        escaped = false;
      } else if (quote === '"' && char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
    } else if (char === "#") {
      comment = true;
    } else {
      output += char;
    }
  }
  return output;
}

function parseTomlStringArray(source) {
  const value = stripTomlComments(source).trim();
  if (!value.startsWith("[") || !value.endsWith("]")) return null;
  const items = [];
  let index = 1;
  while (index < value.length - 1) {
    while (/[\s,]/.test(value[index] ?? "")) index += 1;
    if (index >= value.length - 1) break;
    const quote = value[index];
    if (quote !== '"' && quote !== "'") return null;
    index += 1;
    let item = "";
    let closed = false;
    while (index < value.length - 1) {
      const char = value[index];
      index += 1;
      if (char === quote) {
        closed = true;
        break;
      }
      if (quote === '"' && char === "\\") {
        const escaped = value[index];
        index += 1;
        const replacements = { n: "\n", r: "\r", t: "\t", '"': '"', "\\": "\\" };
        if (!Object.hasOwn(replacements, escaped)) return null;
        item += replacements[escaped];
      } else {
        item += char;
      }
    }
    if (!closed) return null;
    items.push(item);
    while (/\s/.test(value[index] ?? "")) index += 1;
    if (index < value.length - 1 && value[index] !== ",") return null;
  }
  return items;
}

function parseTomlBoolean(source) {
  const value = stripTomlComments(source).trim();
  if (value === "true") return true;
  if (value === "false") return false;
  return null;
}

function isManagedStatusLine(assignment) {
  const items = assignment ? parseTomlStringArray(assignment.value) : null;
  return items !== null &&
    items.length === HERMES_STATUS_LINE_ITEMS.length &&
    items.every((item, index) => item === HERMES_STATUS_LINE_ITEMS[index]);
}

function isManagedColors(assignment) {
  return assignment !== null && parseTomlBoolean(assignment.value) === true;
}

function managedAssignments(newline) {
  const statusLine = [
    `${STATUS_LINE_KEY} = [`,
    ...HERMES_STATUS_LINE_ITEMS.map((item) => `  "${item}",`),
    "]"
  ].join(newline) + newline;
  return {
    [STATUS_LINE_KEY]: statusLine,
    [COLORS_KEY]: `${COLORS_KEY} = true${newline}`
  };
}

function replaceAssignments(source, replacements) {
  const newline = newlineFor(source);
  let output = source;
  let section = findTuiSection(output);
  if (!section) {
    const values = Object.values(replacements).filter((value) => value !== null);
    if (values.length === 0) return output;
    const separator = output.length === 0
      ? ""
      : output.endsWith("\n") || output.endsWith("\r")
        ? ""
        : `${newline}${newline}`;
    return `${output}${separator}[tui]${newline}${values.join("")}`;
  }

  const edits = [];
  const missing = [];
  for (const [key, replacement] of Object.entries(replacements)) {
    const assignment = findAssignment(output, section, key);
    if (assignment) {
      edits.push({ start: assignment.start, end: assignment.end, replacement: replacement ?? "" });
    } else if (replacement !== null) {
      missing.push(replacement);
    }
  }
  edits.sort((left, right) => right.start - left.start);
  for (const edit of edits) {
    output = output.slice(0, edit.start) + edit.replacement + output.slice(edit.end);
  }
  if (missing.length > 0) {
    section = findTuiSection(output);
    const prefix = section.end > section.headerEnd &&
      !output.slice(section.headerEnd, section.end).endsWith("\n") &&
      !output.slice(section.headerEnd, section.end).endsWith("\r")
      ? newline
      : "";
    output = output.slice(0, section.end) + prefix + missing.join("") + output.slice(section.end);
  }
  return output;
}

function removeEmptyCreatedTuiSection(source) {
  const section = findTuiSection(source);
  if (!section) return source;
  if (source.slice(section.headerEnd, section.end).trim() !== "") return source;
  return source.slice(0, section.start) + source.slice(section.end);
}

function exactJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

async function writeTextAtomic(path, content, fsOps = {}) {
  const makeDirectory = fsOps.mkdir ?? mkdir;
  const write = fsOps.writeFile ?? writeFile;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  const statPath = fsOps.lstat ?? lstat;
  const token = randomUUID();
  const staged = `${path}.staged-${token}`;
  const backup = `${path}.backup-${token}`;
  let movedExisting = false;
  await makeDirectory(dirname(path), { recursive: true });
  await write(staged, content, { encoding: "utf8", flag: "wx" });
  try {
    if (await exists(path, statPath)) {
      await move(path, backup);
      movedExisting = true;
    }
    await move(staged, path);
    if (movedExisting) await remove(backup, { force: true });
  } catch (error) {
    await remove(staged, { force: true }).catch(() => {});
    if (movedExisting && !(await exists(path, statPath))) {
      await move(backup, path).catch(() => {});
    }
    throw error;
  }
}

async function readOptionalText(path, read = readFile) {
  try {
    return await read(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function captureBackup(configPath, source) {
  const text = source ?? "";
  const section = findTuiSection(text);
  const statusLine = findAssignment(text, section, STATUS_LINE_KEY);
  const colors = findAssignment(text, section, COLORS_KEY);
  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    configPath,
    configExisted: source !== null,
    tuiTablePresent: section !== null,
    original: {
      statusLine: statusLine === null ? null : statusLine.raw,
      statusLineUseColors: colors === null ? null : colors.raw
    }
  };
}

function validateBackup(value, configPath) {
  if (
    value?.schemaVersion !== BACKUP_SCHEMA_VERSION ||
    typeof value.configPath !== "string" ||
    resolve(value.configPath).toLowerCase() !== resolve(configPath).toLowerCase() ||
    typeof value.configExisted !== "boolean" ||
    typeof value.tuiTablePresent !== "boolean" ||
    value.original === null ||
    typeof value.original !== "object" ||
    !(value.original.statusLine === null || typeof value.original.statusLine === "string") ||
    !(
      value.original.statusLineUseColors === null ||
      typeof value.original.statusLineUseColors === "string"
    ) ||
    Reflect.ownKeys(value).length !== 5 ||
    Reflect.ownKeys(value.original).length !== 2
  ) {
    throw new Error("CCU status-line config backup is invalid");
  }
  return value;
}

export async function enableHermesStatusLineConfig(options) {
  const codexHome = resolve(options.codexHome);
  const configPath = join(codexHome, "config.toml");
  const backupPath = join(codexHome, STATUS_LINE_CONFIG_BACKUP);
  const read = options.fsOps?.readFile ?? readFile;
  const remove = options.fsOps?.rm ?? rm;
  const existingSource = await readOptionalText(configPath, read);
  const source = existingSource ?? "";
  const existingBackup = await readOptionalText(backupPath, read);
  let backupCreated = false;
  if (existingBackup === null) {
    await writeTextAtomic(
      backupPath,
      exactJson(captureBackup(configPath, existingSource)),
      options.fsOps
    );
    backupCreated = true;
  } else {
    validateBackup(JSON.parse(existingBackup), configPath);
  }

  const next = replaceAssignments(source, managedAssignments(newlineFor(source)));
  try {
    if (next !== source) await writeTextAtomic(configPath, next, options.fsOps);
  } catch (error) {
    if (backupCreated) await remove(backupPath, { force: true }).catch(() => {});
    throw error;
  }
  return { changed: next !== source, configPath, backupPath };
}

export async function disableHermesStatusLineConfig(options) {
  const codexHome = resolve(options.codexHome);
  const configPath = join(codexHome, "config.toml");
  const backupPath = join(codexHome, STATUS_LINE_CONFIG_BACKUP);
  const read = options.fsOps?.readFile ?? readFile;
  const remove = options.fsOps?.rm ?? rm;
  const rawBackup = await readOptionalText(backupPath, read);
  if (rawBackup === null) {
    return { changed: false, configPath, backupPath, preservedUserChanges: [] };
  }
  const backup = validateBackup(JSON.parse(rawBackup), configPath);
  const existingSource = await readOptionalText(configPath, read);
  if (existingSource === null) {
    await remove(backupPath, { force: true });
    return { changed: false, configPath, backupPath, preservedUserChanges: [] };
  }

  const section = findTuiSection(existingSource);
  const currentStatusLine = findAssignment(existingSource, section, STATUS_LINE_KEY);
  const currentColors = findAssignment(existingSource, section, COLORS_KEY);
  const replacements = {};
  const preservedUserChanges = [];
  if (isManagedStatusLine(currentStatusLine)) {
    replacements[STATUS_LINE_KEY] = backup.original.statusLine;
  } else {
    preservedUserChanges.push(STATUS_LINE_KEY);
  }
  if (isManagedColors(currentColors)) {
    replacements[COLORS_KEY] = backup.original.statusLineUseColors;
  } else {
    preservedUserChanges.push(COLORS_KEY);
  }

  let next = replaceAssignments(existingSource, replacements);
  if (!backup.tuiTablePresent) next = removeEmptyCreatedTuiSection(next);
  if (next !== existingSource) {
    if (!backup.configExisted && next.trim() === "") {
      await remove(configPath, { force: true });
    } else {
      await writeTextAtomic(configPath, next, options.fsOps);
    }
  }
  await remove(backupPath, { force: true });
  return {
    changed: next !== existingSource,
    configPath,
    backupPath,
    preservedUserChanges
  };
}
