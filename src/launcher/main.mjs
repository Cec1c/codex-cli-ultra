import { spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveInstallRoot } from "../config/constants.mjs";
import { discoverOfficialCodex } from "../discovery/official-codex.mjs";
import { writeNoticeOnce } from "../notices/once.mjs";
import { readState } from "../state/store.mjs";
import { CCU_VERSION } from "../version.mjs";
import { runSelectedTarget } from "./process.mjs";
import { selectLaunchTarget } from "./select-target.mjs";

function prepareManagedUpdateEnvironment(options) {
  const managerPath = join(options.installRoot, "bin", "codex-ultra.mjs");
  const spawnDetached = options.spawnDetached ?? spawn;
  try {
    const child = spawnDetached(
      options.execPath ?? process.execPath,
      [managerPath, "upgrade", "check", "--background", "--json"],
      {
        detached: true,
        windowsHide: true,
        stdio: "ignore",
        env: {
          ...options.env,
          CODEX_ULTRA_HOME: options.installRoot
        }
      }
    );
    child.once?.("error", () => {});
    child.unref?.();
  } catch {}
  return {
    CODEX_CCU_MANAGED: "1",
    CODEX_CCU_MANAGER_PATH: join(options.installRoot, "bin", "ccu-manager.exe"),
    CODEX_CCU_MANAGER_VERSION: CCU_VERSION,
    CODEX_CCU_UPDATE_CACHE_PATH: join(options.installRoot, "update-cache.json"),
    CODEX_CCU_UPDATE_DISMISSALS_DIR: join(options.installRoot, "update-dismissals")
  };
}

export async function launcherMain(options = {}) {
  const env = options.env ?? process.env;
  const args = options.args ?? process.argv.slice(2);
  const stderr = options.stderr ?? process.stderr;
  const installRoot = options.installRoot ?? resolveInstallRoot(env);
  const statePath = options.statePath ?? join(installRoot, "state.json");

  const readStateImpl = options.readState ?? readState;
  const discoverOfficialImpl =
    options.discoverOfficialCodex ?? discoverOfficialCodex;
  const selectTargetImpl = options.selectLaunchTarget ?? selectLaunchTarget;
  const writeNoticeImpl = options.writeNoticeOnce ?? writeNoticeOnce;
  const runTargetImpl = options.runSelectedTarget ?? runSelectedTarget;

  let state = null;
  try {
    state = await readStateImpl(statePath);
  } catch {
    state = null;
  }

  let recoveredOfficial = null;
  if (state === null) {
    try {
      recoveredOfficial = await discoverOfficialImpl({
        ...options.discoveryOptions,
        env,
        installRoot
      });
    } catch {
      recoveredOfficial = null;
    }
  }

  const selection = await selectTargetImpl({
    ...options.selectOptions,
    state,
    recoveredOfficial,
    installRoot,
    env
  });

  if (selection.kind === "ultra") {
    try {
      selection.env = {
        ...selection.env,
        ...prepareManagedUpdateEnvironment({
          ...options,
          env,
          installRoot
        })
      };
    } catch {}
  }

  if (selection.notice && selection.kind !== "error") {
    let firstNotice = false;
    try {
      firstNotice = await writeNoticeImpl({
        ...options.noticeOptions,
        installRoot,
        reason: selection.reason,
        detail: selection.notice
      });
    } catch {
      firstNotice = false;
    }
    if (firstNotice) {
      stderr.write(`${selection.notice}\n`);
    }
  }

  return await runTargetImpl(selection, args, {
    ...options.processOptions,
    env,
    stderr,
    ...(options.stdio === undefined ? {} : { stdio: options.stdio })
  });
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  launcherMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`Codex Ultra launcher failed: ${error.message}\n`);
      process.exitCode = 1;
    });
}
