import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import test from "node:test";

import { discoverOfficialCodex } from "../src/discovery/official-codex.mjs";
import { installManagementBin } from "../src/installer/bin.mjs";
import { selectLaunchTarget } from "../src/launcher/select-target.mjs";
import {
  isPathInside,
  pathsEqual,
  resolvePlatformInstallRoot,
  resolveRuntimePlatform
} from "../src/platform/runtime.mjs";

const LINUX = resolveRuntimePlatform({ platform: "linux", arch: "x64" });
const LINUX_ARM = resolveRuntimePlatform({ platform: "linux", arch: "arm64" });
const MAC_ARM = resolveRuntimePlatform({ platform: "darwin", arch: "arm64" });
const execFileAsync = promisify(execFile);

test("runtime platform descriptors cover Linux and both macOS architectures", () => {
  assert.deepEqual(
    {
      id: LINUX.id,
      target: LINUX.target,
      officialTarget: LINUX.officialTarget,
      npmPackage: LINUX.npmPackage,
      binaryName: LINUX.binaryName
    },
    {
      id: "linux-x64",
      target: "x86_64-unknown-linux-gnu",
      officialTarget: "x86_64-unknown-linux-musl",
      npmPackage: "@openai/codex-linux-x64",
      binaryName: "codex"
    }
  );
  assert.equal(MAC_ARM.id, "macos-arm64");
  assert.equal(LINUX_ARM.target, "aarch64-unknown-linux-gnu");
  assert.equal(MAC_ARM.target, "aarch64-apple-darwin");
  assert.equal(
    resolveRuntimePlatform({ platform: "darwin", arch: "x64" }).target,
    "x86_64-apple-darwin"
  );
});

test("platform install roots follow XDG and macOS user conventions", () => {
  assert.equal(
    resolvePlatformInstallRoot({ HOME: "/home/alice" }, LINUX),
    "/home/alice/.local/share/codex-cli-ultra"
  );
  assert.equal(
    resolvePlatformInstallRoot(
      { HOME: "/home/alice", XDG_DATA_HOME: "/data/alice" },
      LINUX
    ),
    "/data/alice/codex-cli-ultra"
  );
  assert.equal(
    resolvePlatformInstallRoot({ HOME: "/Users/alice" }, MAC_ARM),
    "/Users/alice/Library/Application Support/codex-cli-ultra"
  );
  assert.throws(
    () => resolvePlatformInstallRoot({ HOME: "relative" }, LINUX),
    /HOME must be an absolute local path/
  );
});

test("POSIX path identity remains case-sensitive and child-safe", () => {
  assert.equal(pathsEqual("/opt/CCU", "/opt/ccu", LINUX), false);
  assert.equal(isPathInside("/opt/ccu", "/opt/ccu/bin/codex", LINUX), true);
  assert.equal(isPathInside("/opt/ccu", "/opt/ccu-other/bin", LINUX), false);
});

test("official Codex discovery validates the Linux npm package layout", async () => {
  const installRoot = "/home/alice/.local/share/codex-cli-ultra";
  const npmRoot = "/opt/node/lib/node_modules";
  const packageJsonPath = `${npmRoot}/@openai/codex/package.json`;
  const platformPackageJsonPath = `${npmRoot}/@openai/codex/node_modules/@openai/codex-linux-x64/package.json`;
  const binaryPath = `${npmRoot}/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex`;
  const files = new Map([
    [
      packageJsonPath,
      JSON.stringify({
        name: "@openai/codex",
        version: "0.145.0",
        optionalDependencies: {
          "@openai/codex-linux-x64": "npm:@openai/codex@0.145.0-linux-x64"
        }
      })
    ],
    [
      platformPackageJsonPath,
      JSON.stringify({ name: "@openai/codex", version: "0.145.0-linux-x64" })
    ]
  ]);
  const result = await discoverOfficialCodex({
    runtime: LINUX,
    installRoot,
    npmRoot,
    realpath: async (path) => path,
    readFile: async (path) => files.get(path),
    stat: async () => ({ isFile: () => true, size: 1 })
  });
  assert.deepEqual(result, {
    version: "0.145.0",
    packageJsonPath,
    platformPackageVersion: "0.145.0-linux-x64",
    platformPackageJsonPath,
    binaryPath
  });
});

test("Linux launch selection accepts only the platform-specific installed layout", async () => {
  const installRoot = "/home/alice/.local/share/codex-cli-ultra";
  const packageJsonPath = "/opt/node/lib/node_modules/@openai/codex/package.json";
  const platformPackageJsonPath = "/opt/node/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/package.json";
  const officialBinary = "/opt/node/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex";
  const ultraBinary = `${installRoot}/releases/0.145.0-ccu.i18n.2/${LINUX.target}/package/bin/codex`;
  const state = {
    schemaVersion: 1,
    official: {
      version: "0.145.0",
      packageJsonPath,
      platformPackageVersion: "0.145.0-linux-x64",
      platformPackageJsonPath,
      binaryPath: officialBinary
    },
    active: {
      releaseId: "0.145.0-ccu.i18n.2",
      upstreamVersion: "0.145.0",
      ultraRevision: 2,
      platform: LINUX.target,
      binaryPath: ultraBinary,
      size: 10,
      mtimeMs: 20,
      sha256: `sha256:${"a".repeat(64)}`
    },
    locale: null,
    lastKnownGood: null
  };
  const selection = await selectLaunchTarget({
    runtime: LINUX,
    installRoot,
    state,
    realpathFile: async (path) => path,
    readPackageVersion: async (path) =>
      path === packageJsonPath ? "0.145.0" : "0.145.0-linux-x64",
    statFile: async (path) => ({
      isFile: () => true,
      size: path === ultraBinary ? 10 : 1,
      mtimeMs: path === ultraBinary ? 20 : 1
    })
  });
  assert.equal(selection.kind, "ultra");
  assert.equal(selection.path, ultraBinary);
  assert.equal(
    selection.env.CODEX_CCU_LANGUAGE_PACK_ROOT,
    `${installRoot}/languages`
  );
});

test("POSIX management wrappers are executable and forward arguments", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-posix-bin-"));
  try {
    const managerSource = join(root, "manager-source.mjs");
    const launcherSource = join(root, "launcher-source.mjs");
    const binDirectory = join(root, "bin");
    await mkdir(join(root, "content"));
    await writeFile(
      managerSource,
      "process.stdout.write(JSON.stringify({kind: 'manager', args: process.argv.slice(2), content: process.env.CODEX_CCU_CONTENT_ROOT}));\n"
    );
    await writeFile(
      launcherSource,
      "process.stdout.write(JSON.stringify({kind: 'launcher', args: process.argv.slice(2)}));\n"
    );
    await installManagementBin({
      runtime: LINUX,
      binDirectory,
      managerSource,
      launcherSource
    });
    const wrapper = await readFile(join(binDirectory, "codex"), "utf8");
    assert.match(wrapper, /^#!\/bin\/sh/);
    assert.match(wrapper, /"\$@"/);
    if (process.platform !== "win32") {
      assert.equal((await stat(join(binDirectory, "codex"))).mode & 0o111, 0o111);
    }
    const managerWrapper = await readFile(
      join(binDirectory, "codex-ultra"),
      "utf8"
    );
    assert.match(managerWrapper, /CODEX_CCU_CONTENT_ROOT/);
    if (process.platform !== "win32") {
      const launcherRun = await execFileAsync(join(binDirectory, "codex"), [
        "--model",
        "值 with spaces"
      ]);
      assert.deepEqual(JSON.parse(launcherRun.stdout), {
        kind: "launcher",
        args: ["--model", "值 with spaces"]
      });
      const managerRun = await execFileAsync(join(binDirectory, "codex-ultra"), [
        "status",
        "--json"
      ]);
      assert.deepEqual(JSON.parse(managerRun.stdout), {
        kind: "manager",
        args: ["status", "--json"],
        content: join(binDirectory, "../content")
      });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
