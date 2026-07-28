import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { extractZipSecure } from "../release/archive.mjs";
import {
  managerCanApplyUpdate,
  validateCcuUpdateManifest
} from "../release/ccu-update-manifest.mjs";
import { sha256File } from "../release/hash.mjs";
import { compareStableVersions } from "../release/github-version.mjs";
import { CCU_VERSION } from "../version.mjs";
import { resolveCcuUpdatePackage } from "./check.mjs";

const APPLY_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$result = [ordered]@{
  schemaVersion = 1
  status = 'running'
  targetVersion = $env:CCU_TARGET_VERSION
  message = $null
}
try {
  $managerPid = 0
  if ([int]::TryParse($env:CCU_MANAGER_PID, [ref]$managerPid) -and $managerPid -gt 0) {
    Wait-Process -Id $managerPid -ErrorAction SilentlyContinue
  }
  & $env:CCU_INSTALL_SCRIPT -NonInteractive -PreserveStatusLine
  if ($LASTEXITCODE -ne 0) {
    throw "CCU installer exited with code $LASTEXITCODE"
  }
  $result.status = 'succeeded'
  $result.message = 'CCU upgrade completed'
  $result | ConvertTo-Json | Set-Content -LiteralPath $env:CCU_JOB_RESULT -Encoding utf8
  if (Test-Path -LiteralPath $env:CCU_INSTALLED_MANAGER -PathType Leaf) {
    Start-Process -FilePath $env:CCU_INSTALLED_MANAGER -WorkingDirectory $env:CCU_INSTALL_ROOT
  }
  Remove-Item -LiteralPath $env:CCU_DOWNLOAD_PATH -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $env:CCU_STAGE_ROOT -Recurse -Force -ErrorAction SilentlyContinue
  exit 0
}
catch {
  $result.status = 'failed'
  $result.message = $_.Exception.Message
  $result | ConvertTo-Json | Set-Content -LiteralPath $env:CCU_JOB_RESULT -Encoding utf8
  exit 1
}
`;

async function findPackageRoot(stagingRoot, fsOps = {}) {
  const readDirectory = fsOps.readdir ?? readdir;
  const entries = await readDirectory(stagingRoot, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length !== 1) {
    throw new Error("CCU update archive must contain exactly one package directory");
  }
  return join(stagingRoot, directories[0].name);
}

function emitStage(options, stage, detail = null) {
  options.onStage?.({ stage, detail });
}

export async function stageCcuUpgrade(options = {}) {
  if (!options.installRoot) throw new Error("installRoot is required");
  const targetVersion = options.targetVersion
    ? options.targetVersion.replace(/^v/, "")
    : undefined;
  const resolved = await (options.resolveCcuUpdatePackage ?? resolveCcuUpdatePackage)({
    ...options,
    targetVersion
  });
  try {
    const manifest = validateCcuUpdateManifest(resolved.manifest, {
      releaseTag: resolved.latest.tag
    });
    if (!managerCanApplyUpdate(options.currentVersion ?? CCU_VERSION, manifest)) {
      throw new Error(
        `CCU ${options.currentVersion ?? CCU_VERSION} cannot apply updates that require manager ${manifest.minimumManagerVersion}`
      );
    }
    if (
      compareStableVersions(options.currentVersion ?? CCU_VERSION, manifest.ccuVersion) >= 0
    ) {
      return {
        changed: false,
        manifest,
        latest: resolved.latest,
        message: "CCU is already current or newer"
      };
    }

    const cacheRoot = join(options.installRoot, "cache", "updates");
    await (options.mkdir ?? mkdir)(cacheRoot, { recursive: true });
    const downloadPath = join(cacheRoot, `${manifest.asset.name}.part`);
    const stagingRoot = join(cacheRoot, `stage-${randomUUID()}`);
    await (options.mkdir ?? mkdir)(stagingRoot, { recursive: true });

    try {
      emitStage(options, "download", manifest.asset.name);
      await resolved.provider.materializeAsset(
        manifest.asset.name,
        downloadPath,
        {
          expectedSize: manifest.asset.size,
          onProgress: options.onProgress,
          resume: true
        }
      );
      emitStage(options, "verify", manifest.asset.name);
      const hash = await (options.sha256File ?? sha256File)(downloadPath);
      if (
        hash.size !== manifest.asset.size ||
        hash.sha256.toLowerCase() !== manifest.asset.sha256.toLowerCase()
      ) {
        await (options.rm ?? rm)(downloadPath, { force: true }).catch(() => {});
        throw new Error("downloaded CCU package failed size or SHA-256 verification");
      }
      emitStage(options, "extract", manifest.asset.name);
      await (options.extractZipSecure ?? extractZipSecure)(downloadPath, stagingRoot);
      const packageRoot = await (options.findPackageRoot ?? findPackageRoot)(
        stagingRoot,
        options.fsOps
      );
      const installScript = join(packageRoot, "install.ps1");
      emitStage(options, "ready", packageRoot);
      return {
        changed: true,
        manifest,
        latest: resolved.latest,
        downloadPath,
        stagingRoot,
        packageRoot,
        installScript
      };
    } catch (error) {
      await (options.rm ?? rm)(stagingRoot, {
        recursive: true,
        force: true
      }).catch(() => {});
      throw error;
    }
  } finally {
    if (resolved.ownsNetworkClient) await resolved.networkClient.close();
  }
}

export async function scheduleCcuUpgradeApply(staged, options = {}) {
  if (!staged.changed) return { scheduled: false, reason: staged.message };
  const jobsRoot = join(options.installRoot, "cache", "update-jobs");
  await (options.mkdir ?? mkdir)(jobsRoot, { recursive: true });
  const jobId = randomUUID();
  const scriptPath = join(jobsRoot, `${jobId}.ps1`);
  const resultPath = join(jobsRoot, `${jobId}.json`);
  await (options.writeFile ?? writeFile)(scriptPath, APPLY_SCRIPT, "utf8");
  const spawnProcess = options.spawn ?? spawn;
  const child = spawnProcess(options.pwshExecutable ?? "pwsh.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-File",
    scriptPath
  ], {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
    env: {
      ...(options.env ?? process.env),
      CCU_TARGET_VERSION: staged.manifest.ccuVersion,
      CCU_MANAGER_PID: String(options.managerPid ?? 0),
      CCU_INSTALL_SCRIPT: staged.installScript,
      CCU_INSTALL_ROOT: options.installRoot,
      CCU_INSTALLED_MANAGER: join(options.installRoot, "bin", "ccu-manager.exe"),
      CCU_JOB_RESULT: resultPath,
      CCU_DOWNLOAD_PATH: staged.downloadPath,
      CCU_STAGE_ROOT: staged.stagingRoot
    }
  });
  child.once?.("error", () => {});
  child.unref?.();
  return {
    scheduled: true,
    jobId,
    resultPath,
    targetVersion: staged.manifest.ccuVersion,
    assetName: basename(staged.downloadPath).replace(/\.part$/, "")
  };
}

export async function upgradeCcu(options = {}) {
  const staged = await stageCcuUpgrade(options);
  if (!staged.changed) return staged;
  const handoff = await scheduleCcuUpgradeApply(staged, options);
  return { changed: true, manifest: staged.manifest, handoff };
}
