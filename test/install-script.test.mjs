import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const installScript = join(projectRoot, "install.ps1");
const windowsOnly = { skip: process.platform !== "win32" };
const unixOnly = { skip: process.platform === "win32" };

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

test(
  "Unix installer rejects the source directory as its install root",
  unixOnly,
  async () => {
    await assert.rejects(
      execFileAsync(
        "bash",
        [
          installScript.replace(/install\.ps1$/, "install.sh"),
          "--install-root",
          projectRoot,
          "--skip-build",
          "--non-interactive"
        ],
        { cwd: projectRoot }
      ),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(
          `${error.stdout ?? ""}\n${error.stderr ?? ""}`,
          /Install root must not be the installer source directory\./
        );
        return true;
      }
    );
  }
);

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
