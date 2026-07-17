import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const WRAPPERS = Object.freeze({
  "codex.cmd": '@echo off\r\nnode "%~dp0launcher.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n',
  "codex.ps1": "#!/usr/bin/env pwsh\n& node (Join-Path $PSScriptRoot 'launcher.mjs') @args\nexit $LASTEXITCODE\n",
  "codex-ultra.cmd": '@echo off\r\nset "NODE_USE_ENV_PROXY=1"\r\nset "CODEX_CCU_CONTENT_ROOT=%~dp0..\\content"\r\nnode "%~dp0codex-ultra.mjs" %*\r\nexit /b %ERRORLEVEL%\r\n',
  "codex-ultra.ps1": "#!/usr/bin/env pwsh\n$env:NODE_USE_ENV_PROXY = '1'\n$env:CODEX_CCU_CONTENT_ROOT = Join-Path $PSScriptRoot '..\\content'\n& node (Join-Path $PSScriptRoot 'codex-ultra.mjs') @args\nexit $LASTEXITCODE\n"
});

async function replaceFileAtomic(path, bytes, fsOps = {}) {
  const write = fsOps.writeFile ?? writeFile;
  const move = fsOps.rename ?? rename;
  const remove = fsOps.rm ?? rm;
  const temporary = `${path}.tmp-${randomUUID()}`;
  try {
    await write(temporary, bytes, { flag: "wx" });
    await move(temporary, path);
  } catch (error) {
    await remove(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function copyBundle(source, destination, fsOps) {
  if (resolve(source).toLowerCase() === resolve(destination).toLowerCase()) {
    return;
  }
  const read = fsOps.readFile ?? readFile;
  await replaceFileAtomic(destination, await read(source), fsOps);
}

export async function installManagementBin(options) {
  if (!options?.binDirectory) throw new Error("binDirectory is required");
  if (!options.managerSource) throw new Error("managerSource is required");
  if (!options.launcherSource) throw new Error("launcherSource is required");
  const fsOps = options.fsOps ?? {};
  await (fsOps.mkdir ?? mkdir)(options.binDirectory, { recursive: true });
  await copyBundle(
    options.managerSource,
    join(options.binDirectory, "codex-ultra.mjs"),
    fsOps
  );
  await copyBundle(
    options.launcherSource,
    join(options.binDirectory, "launcher.mjs"),
    fsOps
  );
  for (const [name, source] of Object.entries(WRAPPERS)) {
    await replaceFileAtomic(join(options.binDirectory, name), source, fsOps);
  }
  return { binDirectory: options.binDirectory };
}
