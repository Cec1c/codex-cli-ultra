import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import { discoverOfficialCodex } from "../../src/discovery/official-codex.mjs";

const PLATFORM_PACKAGE = "@openai/codex-win32-x64";
const TARGET = "x86_64-pc-windows-msvc";

async function assertSamePath(actual, expected) {
  assert.equal(
    (await realpath(actual)).toLowerCase(),
    (await realpath(expected)).toLowerCase()
  );
}

async function createOfficialFixture({
  root,
  npmRoot = join(root, "node_modules"),
  version = "0.144.4",
  platformVersion = `${version}-win32-x64`,
  optionalDependency = `npm:@openai/codex@${version}-win32-x64`,
  binary = true
}) {
  const packageJsonPath = join(
    npmRoot,
    "@openai",
    "codex",
    "package.json"
  );
  const platformPackageJsonPath = join(
    npmRoot,
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "package.json"
  );
  const binaryPath = join(
    dirname(platformPackageJsonPath),
    "vendor",
    TARGET,
    "bin",
    "codex.exe"
  );
  await mkdir(dirname(binaryPath), { recursive: true });
  await writeFile(
    packageJsonPath,
    `${JSON.stringify({
      name: "@openai/codex",
      version,
      optionalDependencies: {
        [PLATFORM_PACKAGE]: optionalDependency
      }
    })}\n`,
    "utf8"
  );
  await writeFile(
    platformPackageJsonPath,
    `${JSON.stringify({ name: "@openai/codex", version: platformVersion })}\n`,
    "utf8"
  );
  if (binary) {
    await writeFile(binaryPath, Buffer.from("fake-codex-binary"));
  }
  return {
    npmRoot,
    packageJsonPath,
    platformPackageJsonPath,
    binaryPath,
    version,
    platformVersion
  };
}

test("discovers the exact official Windows platform package from an injected npm root", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-discovery-"));
  const fixture = await createOfficialFixture({ root });
  const installRoot = join(root, "codex-cli-ultra");

  const result = await discoverOfficialCodex({
    npmRoot: fixture.npmRoot,
    installRoot
  });

  assert.deepEqual(
    {
      version: result.version,
      platformPackageVersion: result.platformPackageVersion
    },
    {
      version: fixture.version,
      platformPackageVersion: fixture.platformVersion
    }
  );
  await assertSamePath(result.packageJsonPath, fixture.packageJsonPath);
  await assertSamePath(result.platformPackageJsonPath, fixture.platformPackageJsonPath);
  await assertSamePath(result.binaryPath, fixture.binaryPath);
});

test("uses npm.cmd root -g locally when no npm root is injected", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-npm-root-"));
  const fixture = await createOfficialFixture({ root });
  const installRoot = join(root, "codex-cli-ultra");
  const npmBin = join(root, "npm-bin");
  const npmCommand = join(npmBin, "npm.cmd");
  const nodePath = join(npmBin, "node.exe");
  const npmCliPath = join(npmBin, "node_modules", "npm", "bin", "npm-cli.js");
  await mkdir(npmBin, { recursive: true });
  await writeFile(npmCommand, "@echo off\r\n", "utf8");
  await writeFile(nodePath, Buffer.from("fake-node"));
  await mkdir(dirname(npmCliPath), { recursive: true });
  await writeFile(npmCliPath, "// fake npm cli\n", "utf8");
  const calls = [];

  const result = await discoverOfficialCodex({
    installRoot,
    env: {
      Path: `${installRoot}\\bin;.;\\\\server\\share;${npmBin};C:\\Windows\\System32`
    },
    execFile: async (file, arguments_, options) => {
      calls.push({ file, arguments_, options });
      return { stdout: `${fixture.npmRoot}\r\n`, stderr: "" };
    }
  });

  await assertSamePath(result.binaryPath, fixture.binaryPath);
  assert.equal(calls.length, 1);
  await assertSamePath(calls[0].file, nodePath);
  await assertSamePath(calls[0].arguments_[0], npmCliPath);
  assert.deepEqual(calls[0].arguments_.slice(1), ["root", "-g"]);
  await assertSamePath(calls[0].options.env.PATH, npmBin);
  assert.deepEqual(
    {
      encoding: calls[0].options.encoding,
      windowsHide: calls[0].options.windowsHide
    },
    { encoding: "utf8", windowsHide: true }
  );
});

test("refuses to execute npm from relative or network PATH entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-unsafe-path-"));
  let execCalled = false;
  await assert.rejects(
    discoverOfficialCodex({
      installRoot: join(root, "ultra"),
      env: { PATH: `.;\\\\server\\share;${join(root, "ultra", "bin")}` },
      execFile: async () => {
        execCalled = true;
        throw new Error("must not execute");
      }
    }),
    /no trusted npm.cmd found on the local PATH/
  );
  assert.equal(execCalled, false);
});

test("rejects canonical package or install paths that resolve to a network share", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-network-realpath-"));
  const fixture = await createOfficialFixture({ root });
  const installRoot = join(root, "ultra");
  let packageRead = false;

  await assert.rejects(
    discoverOfficialCodex({
      npmRoot: fixture.npmRoot,
      installRoot,
      realpath: async (path) =>
        path === fixture.packageJsonPath
          ? "\\\\server\\share\\package.json"
          : path,
      readFile: async (...arguments_) => {
        packageRead = true;
        return readFile(...arguments_);
      }
    }),
    /resolved outside a local Windows drive/
  );
  assert.equal(packageRead, false);

  await assert.rejects(
    discoverOfficialCodex({
      npmRoot: fixture.npmRoot,
      installRoot,
      realpath: async (path) =>
        path === installRoot ? "\\\\server\\share\\ultra" : path
    }),
    /install root resolved outside a local Windows drive/
  );
});

test("rejects a missing or non-file official executable", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-missing-bin-"));
  const fixture = await createOfficialFixture({ root, binary: false });
  const installRoot = join(root, "codex-cli-ultra");

  await assert.rejects(
    discoverOfficialCodex({ npmRoot: fixture.npmRoot, installRoot }),
    /official Codex binary is missing/
  );

  await mkdir(fixture.binaryPath, { recursive: true });
  await assert.rejects(
    discoverOfficialCodex({ npmRoot: fixture.npmRoot, installRoot }),
    /official Codex binary is missing/
  );
});

test("rejects a missing or mismatched Windows optional dependency", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-optional-dep-"));
  const missing = await createOfficialFixture({
    root,
    optionalDependency: undefined
  });
  const missingManifest = {
    name: "@openai/codex",
    version: missing.version,
    optionalDependencies: {}
  };
  await writeFile(
    missing.packageJsonPath,
    JSON.stringify(missingManifest),
    "utf8"
  );
  await assert.rejects(
    discoverOfficialCodex({
      npmRoot: missing.npmRoot,
      installRoot: join(root, "ultra")
    }),
    /official package does not declare the exact Windows platform dependency/
  );

  const mismatchedRoot = await mkdtemp(
    join(tmpdir(), "codex-ultra-optional-mismatch-")
  );
  const mismatched = await createOfficialFixture({
    root: mismatchedRoot,
    optionalDependency: "npm:@openai/codex@0.143.0-win32-x64"
  });
  await assert.rejects(
    discoverOfficialCodex({
      npmRoot: mismatched.npmRoot,
      installRoot: join(mismatchedRoot, "ultra")
    }),
    /official package does not declare the exact Windows platform dependency/
  );
});

test("rejects package manifests that do not identify official Codex", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-package-name-"));
  const fixture = await createOfficialFixture({ root });
  await writeFile(
    fixture.packageJsonPath,
    JSON.stringify({
      name: "not-codex",
      version: fixture.version,
      optionalDependencies: {
        [PLATFORM_PACKAGE]: `npm:@openai/codex@${fixture.platformVersion}`
      }
    }),
    "utf8"
  );
  await assert.rejects(
    discoverOfficialCodex({
      npmRoot: fixture.npmRoot,
      installRoot: join(root, "ultra")
    }),
    /official Codex package has an unexpected name/
  );
});

test("rejects any discovered official path inside the Ultra install root", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-self-discovery-"));
  const installRoot = join(root, "codex-cli-ultra");
  const fixture = await createOfficialFixture({
    root,
    npmRoot: join(installRoot, "shadow", "node_modules")
  });

  await assert.rejects(
    discoverOfficialCodex({ npmRoot: fixture.npmRoot, installRoot }),
    /official Codex path is inside the Codex Ultra install root/
  );
});

test("discovery never mutates or removes the official npm package", async () => {
  const root = await mkdtemp(join(tmpdir(), "codex-ultra-read-only-"));
  const fixture = await createOfficialFixture({ root });
  const installRoot = join(root, "codex-cli-ultra");

  await discoverOfficialCodex({ npmRoot: fixture.npmRoot, installRoot });
  await rm(installRoot, { recursive: true, force: true });

  const second = await discoverOfficialCodex({
    npmRoot: fixture.npmRoot,
    installRoot
  });
  await assertSamePath(second.binaryPath, fixture.binaryPath);
});
