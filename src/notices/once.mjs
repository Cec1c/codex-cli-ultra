import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import { join } from "node:path";

import { isAbsoluteLocalWindowsPath } from "../config/constants.mjs";

export async function writeNoticeOnce(options = {}) {
  try {
    const reason = String(options.reason ?? "");
    const detail = String(options.detail ?? "");
    const noticesDirectory =
      options.noticesDirectory ?? join(options.installRoot, "notices");
    if (!isAbsoluteLocalWindowsPath(noticesDirectory)) {
      return false;
    }
    const hash = createHash("sha256")
      .update(`${reason}\0${detail}`)
      .digest("hex");
    const openFile = options.openFile ?? open;
    const handle = await openFile(join(noticesDirectory, `${hash}.notice`), "wx");
    await handle.close().catch(() => {});
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return false;
    }
    return false;
  }
}
