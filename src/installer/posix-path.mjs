import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { posix } from "node:path";

const START_MARKER = "# >>> codex-cli-ultra >>>";
const END_MARKER = "# <<< codex-cli-ultra <<<";
const BLOCK_PATTERN = new RegExp(
  `(?:^|\\n)${START_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n[\\s\\S]*?\\n${END_MARKER.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\n|$)`,
  "g"
);

function shellQuote(value) {
  if (typeof value !== "string" || !posix.isAbsolute(value) || /[\0\r\n]/.test(value)) {
    throw new Error("POSIX PATH entry must be an absolute single-line path");
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function selectedProfile(env, explicit) {
  if (explicit) return explicit;
  if (!env.HOME || !posix.isAbsolute(env.HOME)) {
    throw new Error("HOME must be an absolute path for POSIX PATH setup");
  }
  const shell = posix.basename(env.SHELL ?? "");
  const profile = shell === "zsh"
    ? ".zshrc"
    : shell === "bash"
      ? ".bashrc"
      : ".profile";
  return posix.join(env.HOME, profile);
}

async function readProfile(path, fsOps) {
  const inspect = fsOps.lstat ?? lstat;
  try {
    const metadata = await inspect(path);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`shell profile must be a regular file: ${path}`);
    }
    return await (fsOps.readFile ?? readFile)(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function withoutManagedBlock(source) {
  return source.replace(BLOCK_PATTERN, "").replace(/^\n+|\n+$/g, "");
}

async function writeProfileAtomic(path, source, fsOps) {
  const temporary = `${path}.tmp-${randomUUID()}`;
  await (fsOps.mkdir ?? mkdir)(posix.dirname(path), { recursive: true });
  try {
    await (fsOps.writeFile ?? writeFile)(temporary, source, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
    await (fsOps.rename ?? rename)(temporary, path);
  } catch (error) {
    await (fsOps.rm ?? rm)(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

export async function addPosixUserPathEntry(entry, options = {}) {
  const env = options.env ?? process.env;
  const normalized = posix.resolve(entry);
  const profilePath = selectedProfile(env, options.profilePath);
  const source = await readProfile(profilePath, options.fsOps ?? {});
  const base = withoutManagedBlock(source);
  const block = [
    START_MARKER,
    `export PATH=${shellQuote(normalized)}:"$PATH"`,
    END_MARKER
  ].join("\n");
  const next = `${base ? `${base}\n\n` : ""}${block}\n`;
  if (source === next) {
    return { changed: false, entry: normalized, profilePath };
  }
  await writeProfileAtomic(profilePath, next, options.fsOps ?? {});
  return { changed: true, entry: normalized, profilePath };
}

export async function removePosixUserPathEntry(entry, options = {}) {
  const env = options.env ?? process.env;
  const normalized = posix.resolve(entry);
  const profiles = options.profilePath
    ? [options.profilePath]
    : [".profile", ".bash_profile", ".bashrc", ".zprofile", ".zshrc"].map((name) => {
        if (!env.HOME || !posix.isAbsolute(env.HOME)) {
          throw new Error("HOME must be an absolute path for POSIX PATH cleanup");
        }
        return posix.join(env.HOME, name);
      });
  let changed = false;
  const changedProfiles = [];
  for (const profilePath of new Set(profiles)) {
    const source = await readProfile(profilePath, options.fsOps ?? {});
    const base = withoutManagedBlock(source);
    const next = base ? `${base}\n` : "";
    if (source === next) continue;
    await writeProfileAtomic(profilePath, next, options.fsOps ?? {});
    changed = true;
    changedProfiles.push(profilePath);
  }
  return { changed, entry: normalized, profilePaths: changedProfiles };
}
