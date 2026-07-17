import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { resolveInstallRoot } from "../config/constants.mjs";
import { discoverOfficialCodex } from "../discovery/official-codex.mjs";
import { writeNoticeOnce } from "../notices/once.mjs";
import { readState } from "../state/store.mjs";
import { runSelectedTarget } from "./process.mjs";
import { selectLaunchTarget } from "./select-target.mjs";

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
