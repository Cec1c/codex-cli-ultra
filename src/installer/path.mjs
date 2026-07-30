import { RUNTIME_PLATFORM } from "../config/constants.mjs";
import {
  addPosixUserPathEntry,
  removePosixUserPathEntry
} from "./posix-path.mjs";
import {
  addUserPathEntry as addWindowsUserPathEntry,
  removeUserPathEntry as removeWindowsUserPathEntry
} from "./windows-path.mjs";

export async function addUserPathEntry(entry, options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  return runtime.isWindows
    ? await addWindowsUserPathEntry(entry, options)
    : await addPosixUserPathEntry(entry, options);
}

export async function removeUserPathEntry(entry, options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  return runtime.isWindows
    ? await removeWindowsUserPathEntry(entry, options)
    : await removePosixUserPathEntry(entry, options);
}
