import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const installScript = join(projectRoot, "install.ps1");
const windowsOnly = { skip: process.platform !== "win32" };

async function runInstallerPreflight(statusLineArguments) {
  try {
    await execFileAsync(
      "pwsh.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        installScript,
        "-InstallRoot",
        projectRoot,
        "-SkipBuild",
        "-NonInteractive",
        ...statusLineArguments
      ],
      {
        cwd: projectRoot,
        windowsHide: true
      }
    );
  } catch (error) {
    return {
      code: error.code,
      output: `${error.stdout ?? ""}\n${error.stderr ?? ""}`
    };
  }
  assert.fail("installer preflight unexpectedly continued past the safe path guard");
}

test(
  "PowerShell installer reaches the safe path guard with zero or one status-line mode",
  windowsOnly,
  async () => {
    for (const arguments_ of [
      [],
      ["-EnableStatusLine"],
      ["-DisableStatusLine"],
      ["-PreserveStatusLine"]
    ]) {
      const failure = await runInstallerPreflight(arguments_);
      assert.equal(failure.code, 1);
      assert.match(
        failure.output,
        /InstallRoot must not be the installer source directory\./
      );
    }
  }
);

test("interactive installer presents Hermes colors as the default", async () => {
  const source = await readFile(installScript, "utf8");

  assert.match(source, /Hermes 彩色状态栏（全新安装默认启用）/);
  assert.match(source, /四段式状态栏？\[Y\/n\]/);
  assert.match(source, /IsNullOrWhiteSpace\(\$answer\)/);
  assert.match(source, /Join-Path \$installRoot 'state\.json'/);
  assert.match(source, /-and -not \$existingCcuState/);
  assert.match(
    source,
    /else \{\r?\n\s+\$null\r?\n\}\r?\n\$statusLineMessage/
  );
});

test(
  "PowerShell installer rejects conflicting status-line modes",
  windowsOnly,
  async () => {
    for (const arguments_ of [
      ["-EnableStatusLine", "-DisableStatusLine"],
      ["-EnableStatusLine", "-PreserveStatusLine"],
      ["-DisableStatusLine", "-PreserveStatusLine"]
    ]) {
      const failure = await runInstallerPreflight(arguments_);
      assert.equal(failure.code, 1);
      assert.match(
        failure.output,
        /EnableStatusLine, DisableStatusLine, and PreserveStatusLine cannot be used together\./
      );
    }
  }
);
