import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import { validateState } from "./schema.mjs";

export async function readState(path) {
  return validateState(JSON.parse(await readFile(path, "utf8")));
}

async function syncDirectoryBestEffort(path, openDirectory) {
  let handle;
  try {
    handle = await openDirectory(dirname(path), "r");
    await handle.sync();
  } catch {
    // Windows may refuse directory handles. File sync and rename remain the
    // mandatory durability boundary.
  } finally {
    await handle?.close().catch(() => {});
  }
}

export async function writeStateAtomic(path, state, fsOps = {}) {
  const value = validateState(state);
  const temp = `${path}.tmp-${randomUUID()}`;
  const openFile = fsOps.open ?? open;
  const openDirectory = fsOps.openDirectory ?? open;
  const renameFile = fsOps.rename ?? rename;
  const removeFile = fsOps.rm ?? rm;
  let handle;
  let tempCreated = false;

  try {
    handle = await openFile(temp, "wx");
    tempCreated = true;
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await renameFile(temp, path);
  } catch (error) {
    const cleanupErrors = [];
    if (handle) {
      try {
        await handle.close();
      } catch (closeError) {
        cleanupErrors.push(closeError);
      }
    }
    if (tempCreated) {
      try {
        await removeFile(temp, { force: true });
      } catch (removeError) {
        cleanupErrors.push(removeError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "state write failed and temporary file cleanup failed",
        { cause: error }
      );
    }
    throw error;
  }

  await syncDirectoryBestEffort(path, openDirectory);
}
