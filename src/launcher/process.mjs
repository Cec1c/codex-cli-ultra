import { spawn } from "node:child_process";

import { buildLaunchEnvironment } from "./select-target.mjs";

const NO_TRUSTED_BINARY =
  "Codex Ultra: no trusted Codex binary is available; run codex-ultra doctor.";

export async function runSelectedTarget(selection, args, options = {}) {
  const stderr = options.stderr ?? process.stderr;
  if (selection.kind === "error" || !selection.path) {
    stderr?.write?.(`${selection.notice ?? NO_TRUSTED_BINARY}\n`);
    return 127;
  }

  const spawnChild = options.spawn ?? spawn;
  const child = spawnChild(selection.path, args, {
    shell: false,
    windowsHide: false,
    stdio: options.stdio ?? "inherit",
    env: buildLaunchEnvironment(
      options.env ?? process.env,
      selection.env ?? {}
    ),
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });

  return await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        resolve(128);
        return;
      }
      resolve(code ?? 1);
    });
    try {
      options.onSpawn?.(child);
    } catch (error) {
      child.kill();
      reject(error);
    }
  });
}
