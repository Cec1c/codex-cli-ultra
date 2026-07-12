import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  readdir,
  rename,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  applyOperations,
  planOperations,
  revertOperations
} from "../src/adapter/transaction.mjs";
import { runCli } from "../src/cli.mjs";

const STATE_DIRECTORY = ".codex-ultra-mvp";
const SNAPSHOT_FILE_NAME =
  "codex_tui__bottom_pane__status_line_setup__tests__setup_view_snapshot_uses_zh_cn_catalog.snap";

const LIB_SOURCE = [
  "mod history_cell;",
  "mod hooks_rpc;",
  "mod ide_context;",
  "mod keymap;",
  ""
].join("\n");

const STATUS_SOURCE = [
  "impl StatusLineSetupView {",
  "    pub(crate) fn new(",
  "        status_line_items: Option<&[String]>,",
  "        use_theme_colors: bool,",
  "        preview_data: StatusSurfacePreviewData,",
  "        app_event_tx: AppEventSender,",
  "        list_keymap: ListKeymap,",
  "    ) -> Self {",
  "        let mut used_ids = HashSet::new();",
  "        let mut items = vec![MultiSelectItem {",
  "            id: STATUS_LINE_USE_THEME_COLORS_ITEM_ID.to_string(),",
  '            name: "Use theme colors".to_string(),',
  '            description: Some("Apply colors from the active /theme".to_string()),',
  "            enabled: use_theme_colors,",
  "        }];",
  "",
  "        Self {",
  "            picker: MultiSelectPicker::builder(",
  '                "Configure Status Line".to_string(),',
  '                Some("Select which items to display in the status line.".to_string()),',
  "                app_event_tx,",
  "            )",
  "            .build(),",
  "        }",
  "    }",
  "}",
  "",
  "#[cfg(test)]",
  "mod tests {",
  "    fn render_lines(view: &StatusLineSetupView, width: u16) -> String {",
  "        String::new()",
  "    }",
  "}",
  ""
].join("\n");

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function writeFixtureFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return path;
}

async function createTransactionFixture(files) {
  const sourceRoot = await mkdtemp(join(tmpdir(), "codex-ultra-transaction-"));
  for (const [relativePath, content] of Object.entries(files)) {
    await writeFixtureFile(sourceRoot, relativePath, content);
  }
  return sourceRoot;
}

async function createDirectoryLink(target, path) {
  await symlink(
    target,
    path,
    process.platform === "win32" ? "junction" : "dir"
  );
}

async function createCodexFixture() {
  const sourceRoot = await createTransactionFixture({
    "codex-rs/tui/src/lib.rs": LIB_SOURCE,
    "codex-rs/tui/src/bottom_pane/status_line_setup.rs": STATUS_SOURCE
  });
  const overlayDir = join(sourceRoot, "overlay");
  await mkdir(overlayDir, { recursive: true });
  await writeFile(
    join(overlayDir, "i18n.rs"),
    "pub(crate) fn marker() {}\n",
    "utf8"
  );
  await writeFile(
    join(overlayDir, "i18n_tests.rs"),
    "#[test]\nfn marker_test() {}\n",
    "utf8"
  );
  await writeFile(
    join(overlayDir, SNAPSHOT_FILE_NAME),
    "配置状态栏\n",
    "utf8"
  );
  return { sourceRoot, overlayDir };
}

async function snapshotTree(root) {
  const snapshot = {};
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else {
        snapshot[relative(root, path).replaceAll("\\", "/")] = (
          await readFile(path)
        ).toString("base64");
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("adapter plan is read-only and prints relative paths with hashes", async () => {
  const fixture = await createCodexFixture();
  const before = await snapshotTree(fixture.sourceRoot);
  let output = "";

  const result = await runCli(
    ["adapter", "plan", "--source", fixture.sourceRoot],
    {
      stdout: { write(chunk) { output += chunk; } },
      adapterOptions: {
        verifyGit: false,
        overlayDir: fixture.overlayDir
      }
    }
  );

  assert.equal(result.command, "adapter plan");
  assert.equal(result.files.length, 5);
  assert.deepEqual(JSON.parse(output), result);
  for (const file of result.files) {
    assert.match(file.relativePath, /^[^\\/]+(?:\/[^\\/]+)*$/);
    assert.match(file.afterHash, /^[a-f0-9]{64}$/);
    if (file.created) {
      assert.equal(file.beforeHash, null);
    } else {
      assert.match(file.beforeHash, /^[a-f0-9]{64}$/);
    }
  }
  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
  assert.equal(
    await pathExists(join(fixture.sourceRoot, STATE_DIRECTORY)),
    false
  );
});

test("whole-plan anchor drift rejects before any source write", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(sourceRoot, [
      {
        type: "replace",
        relativePath: "src/first.txt",
        anchor: "alpha",
        replacement: "changed"
      },
      {
        type: "replace",
        relativePath: "src/second.txt",
        anchor: "missing",
        replacement: "changed"
      }
    ]),
    /anchor drift/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations restores exact original bytes", async () => {
  const original = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("alpha\r\n中文\r\n", "utf8"),
    Buffer.from([0x00, 0xff])
  ]);
  const sourceRoot = await createTransactionFixture({
    "src/exact.bin": original
  });
  const targetPath = join(sourceRoot, "src", "exact.bin");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/exact.bin",
      anchor: Buffer.from("alpha"),
      replacement: Buffer.from("omega")
    }
  ]);
  assert.notDeepEqual(await readFile(targetPath), original);

  await revertOperations(sourceRoot);

  assert.deepEqual(await readFile(targetPath), original);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations accepts mixed before, after, and missing-created state", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  const createdPath = join(sourceRoot, "src", "created.txt");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    },
    {
      type: "create",
      relativePath: "src/created.txt",
      content: "created\n"
    }
  ]);
  await writeFile(firstPath, "alpha\n", "utf8");
  await rm(createdPath);

  await revertOperations(sourceRoot);

  assert.equal(await readFile(firstPath, "utf8"), "alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "bravo\n");
  assert.equal(await pathExists(createdPath), false);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("revertOperations retries cleanup after sources are already restored", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  let cleanupAttempts = 0;

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);

  const rmImpl = async (path, options) => {
    if (path === stateRoot && options?.recursive) {
      cleanupAttempts += 1;
      if (cleanupAttempts === 1) {
        throw Object.assign(new Error("simulated state lock"), {
          code: "EBUSY"
        });
      }
    }
    return rm(path, options);
  };

  await assert.rejects(
    revertOperations(sourceRoot, { rmImpl }),
    /simulated state lock/
  );
  assert.equal(await readFile(targetPath, "utf8"), "alpha\n");
  assert.equal(await pathExists(stateRoot), true);

  await revertOperations(sourceRoot, { rmImpl });

  assert.equal(cleanupAttempts, 2);
  assert.equal(await readFile(targetPath, "utf8"), "alpha\n");
  assert.equal(await pathExists(stateRoot), false);
});

test("revert rollback uses injected fs operations and restores call-time bytes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  let secondRestoreFailed = false;
  let injectedRollbackSeen = false;

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    }
  ]);

  await assert.rejects(
    revertOperations(sourceRoot, {
      writeFileImpl: async (path, data, ...args) => {
        const normalized = path.replaceAll("\\", "/");
        if (
          normalized.includes("/src/second.txt.tmp-") &&
          Buffer.from(data).equals(Buffer.from("bravo\n"))
        ) {
          secondRestoreFailed = true;
          throw new Error("simulated revert failure");
        }
        if (
          secondRestoreFailed &&
          normalized.includes("/src/first.txt.tmp-") &&
          Buffer.from(data).equals(Buffer.from("changed-alpha\n"))
        ) {
          injectedRollbackSeen = true;
        }
        return writeFile(path, data, ...args);
      }
    }),
    /simulated revert failure/
  );

  assert.equal(injectedRollbackSeen, true);
  assert.equal(await readFile(firstPath, "utf8"), "changed-alpha\n");
  assert.equal(await readFile(secondPath, "utf8"), "changed-bravo\n");
  assert.equal(
    await pathExists(join(sourceRoot, STATE_DIRECTORY, "state.json")),
    true
  );
});

test("create rejects an existing target and cannot share a path", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/existing.txt": "original\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "create",
        relativePath: "src/existing.txt",
        content: "replacement\n"
      }
    ]),
    /create target already exists/
  );
  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "create",
        relativePath: "src/new.txt",
        content: "new\n"
      },
      {
        type: "replace",
        relativePath: "src/new.txt",
        anchor: "new",
        replacement: "changed"
      }
    ]),
    /create operation cannot share a path/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("create never overwrites a target that appears after preflight", async () => {
  const sourceRoot = await createTransactionFixture({});
  const targetPath = join(sourceRoot, "src", "race.txt");
  let raced = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "src/race.txt",
          content: "adapter\n"
        }
      ],
      {
        linkImpl: async (existingPath, newPath) => {
          if (!raced && newPath === targetPath) {
            raced = true;
            await writeFile(targetPath, "competitor\n", "utf8");
          }
          return link(existingPath, newPath);
        }
      }
    ),
    (error) => error?.code === "EEXIST"
  );

  assert.equal(raced, true);
  assert.equal(await readFile(targetPath, "utf8"), "competitor\n");
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("backup failure cleans state and leaves source bytes untouched", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, ...args) => {
          if (
            path
              .replaceAll("\\", "/")
              .includes(`/${STATE_DIRECTORY}/backups/`)
          ) {
            throw new Error("simulated backup failure");
          }
          return writeFile(path, ...args);
        }
      }
    ),
    /simulated backup failure/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("state write failure cleans state and leaves source bytes untouched", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const before = await snapshotTree(sourceRoot);

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, ...args) => {
          if (
            path
              .replaceAll("\\", "/")
              .includes(`/${STATE_DIRECTORY}/state.json`)
          ) {
            throw new Error("simulated state failure");
          }
          return writeFile(path, ...args);
        }
      }
    ),
    /simulated state failure/
  );

  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});

test("apply forward, rollback, and cleanup all use injected fs operations", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  let forwardFailed = false;
  let rollbackWriteSeen = false;
  let stateCleanupSeen = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/first.txt",
          anchor: "alpha",
          replacement: "changed-alpha"
        },
        {
          type: "replace",
          relativePath: "src/second.txt",
          anchor: "bravo",
          replacement: "changed-bravo"
        }
      ],
      {
        lstatImpl: (...args) => lstat(...args),
        realpathImpl: (...args) => realpath(...args),
        readFileImpl: (...args) => readFile(...args),
        mkdirImpl: (...args) => mkdir(...args),
        writeFileImpl: async (path, data, ...args) => {
          const normalized = path.replaceAll("\\", "/");
          if (
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/second.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("changed-bravo\n"))
          ) {
            forwardFailed = true;
            throw new Error("simulated forward failure");
          }
          if (
            forwardFailed &&
            normalized.includes("/src/first.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("alpha\n"))
          ) {
            rollbackWriteSeen = true;
          }
          return writeFile(path, data, ...args);
        },
        renameImpl: (...args) => rename(...args),
        linkImpl: (...args) => link(...args),
        rmImpl: async (path, options) => {
          if (path === stateRoot && options?.recursive) {
            stateCleanupSeen = true;
          }
          return rm(path, options);
        }
      }
    ),
    /simulated forward failure/
  );

  assert.equal(rollbackWriteSeen, true);
  assert.equal(stateCleanupSeen, true);
  assert.equal(
    await readFile(join(sourceRoot, "src", "first.txt"), "utf8"),
    "alpha\n"
  );
  assert.equal(
    await readFile(join(sourceRoot, "src", "second.txt"), "utf8"),
    "bravo\n"
  );
  assert.equal(await pathExists(stateRoot), false);
});

test("incomplete apply rollback keeps state and backups for recovery", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);
  let forwardFailed = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/first.txt",
          anchor: "alpha",
          replacement: "changed-alpha"
        },
        {
          type: "replace",
          relativePath: "src/second.txt",
          anchor: "bravo",
          replacement: "changed-bravo"
        }
      ],
      {
        writeFileImpl: async (path, data, ...args) => {
          const normalized = path.replaceAll("\\", "/");
          if (
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/second.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("changed-bravo\n"))
          ) {
            forwardFailed = true;
            throw new Error("simulated forward failure");
          }
          if (
            forwardFailed &&
            normalized.includes("/src/first.txt.tmp-") &&
            Buffer.from(data).equals(Buffer.from("alpha\n"))
          ) {
            throw new Error("simulated rollback failure");
          }
          return writeFile(path, data, ...args);
        }
      }
    ),
    (error) =>
      error instanceof AggregateError &&
      error.errors.some((item) => /simulated rollback failure/.test(item.message))
  );

  assert.equal(
    await readFile(join(sourceRoot, "src", "first.txt"), "utf8"),
    "changed-alpha\n"
  );
  assert.equal(
    await readFile(join(sourceRoot, "src", "second.txt"), "utf8"),
    "bravo\n"
  );
  assert.equal(await pathExists(join(stateRoot, "state.json")), true);
  assert.equal(
    await pathExists(join(stateRoot, "backups", "src", "first.txt")),
    true
  );
});

test("operation and tampered state path escapes are rejected before writes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/first.txt": "alpha\n",
    "src/second.txt": "bravo\n"
  });
  const outsidePath = resolve(sourceRoot, "..", "outside.txt");
  const absoluteSlashPath = outsidePath.replaceAll("\\", "/");

  for (const relativePath of [
    "../outside.txt",
    absoluteSlashPath,
    "nested\\outside.txt"
  ]) {
    await assert.rejects(
      planOperations(sourceRoot, [
        {
          type: "create",
          relativePath,
          content: "unsafe\n"
        }
      ]),
      /unsafe adapter file path/
    );
  }
  assert.equal(await pathExists(outsidePath), false);

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/first.txt",
      anchor: "alpha",
      replacement: "changed-alpha"
    },
    {
      type: "replace",
      relativePath: "src/second.txt",
      anchor: "bravo",
      replacement: "changed-bravo"
    }
  ]);
  const firstPath = join(sourceRoot, "src", "first.txt");
  const secondPath = join(sourceRoot, "src", "second.txt");
  const firstApplied = await readFile(firstPath);
  const secondApplied = await readFile(secondPath);
  const statePath = join(sourceRoot, STATE_DIRECTORY, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[1].relativePath = "../outside.txt";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertOperations(sourceRoot),
    /unsafe adapter file path/
  );

  assert.deepEqual(await readFile(firstPath), firstApplied);
  assert.deepEqual(await readFile(secondPath), secondApplied);
  assert.equal(await pathExists(outsidePath), false);
});

test("operation paths reject an existing symlink or junction", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/safe.txt": "safe\n"
  });
  const outsideRoot = await createTransactionFixture({
    "outside.txt": "outside\n"
  });
  const linkPath = join(sourceRoot, "linked");
  await createDirectoryLink(outsideRoot, linkPath);

  await assert.rejects(
    planOperations(sourceRoot, [
      {
        type: "replace",
        relativePath: "linked/outside.txt",
        anchor: "outside",
        replacement: "changed"
      }
    ]),
    /unsafe adapter reparse point/
  );

  assert.equal(
    await readFile(join(outsideRoot, "outside.txt"), "utf8"),
    "outside\n"
  );
});

test("stateDirectory rejects an existing symlink or junction", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "sentinel.txt": "outside\n"
  });
  await createDirectoryLink(outsideRoot, join(sourceRoot, ".state-link"));

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      { stateDirectory: ".state-link" }
    ),
    /unsafe adapter reparse point/
  );

  assert.equal(
    await readFile(join(outsideRoot, "sentinel.txt"), "utf8"),
    "outside\n"
  );
});

test("source rename revalidates a parent replaced after temp write", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "file.txt": "outside\n"
  });
  let swapped = false;

  await assert.rejects(
    applyOperations(
      sourceRoot,
      [
        {
          type: "replace",
          relativePath: "src/file.txt",
          anchor: "alpha",
          replacement: "omega"
        }
      ],
      {
        writeFileImpl: async (path, data, ...args) => {
          await writeFile(path, data, ...args);
          const normalized = path.replaceAll("\\", "/");
          if (
            !swapped &&
            !normalized.includes(`/${STATE_DIRECTORY}/`) &&
            normalized.includes("/src/file.txt.tmp-")
          ) {
            swapped = true;
            await rename(
              join(sourceRoot, "src"),
              join(sourceRoot, "src-real")
            );
            await createDirectoryLink(outsideRoot, join(sourceRoot, "src"));
            await writeFile(
              join(outsideRoot, basename(path)),
              "attacker-temp\n",
              "utf8"
            );
          }
        }
      }
    )
  );

  assert.equal(swapped, true);
  assert.equal(
    await readFile(join(outsideRoot, "file.txt"), "utf8"),
    "outside\n"
  );
});

test("revert rejects an extra state junction before recursive cleanup", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const outsideRoot = await createTransactionFixture({
    "sentinel.txt": "outside\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");
  const stateRoot = join(sourceRoot, STATE_DIRECTORY);

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);
  await createDirectoryLink(outsideRoot, join(stateRoot, "extra-link"));

  await assert.rejects(
    revertOperations(sourceRoot),
    /unsafe adapter reparse point/
  );

  assert.equal(await readFile(targetPath, "utf8"), "omega\n");
  assert.equal(await pathExists(stateRoot), true);
  assert.equal(
    await readFile(join(outsideRoot, "sentinel.txt"), "utf8"),
    "outside\n"
  );
});

test("win32 path identity rejects case aliases", async () => {
  const sourceRoot = await createTransactionFixture({});

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        { type: "create", relativePath: "Foo.txt", content: "one\n" },
        { type: "create", relativePath: "foo.txt", content: "two\n" }
      ],
      { platform: "win32" }
    ),
    /adapter path identity collision/
  );
});

test("win32 stateDirectory identity cannot overlap an operation path", async () => {
  const sourceRoot = await createTransactionFixture({});

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "state/file.txt",
          content: "unsafe\n"
        }
      ],
      { platform: "win32", stateDirectory: "State" }
    ),
    /adapter state path overlaps an operation path/
  );
});

test("win32 paths reject ADS, DOS devices, and trailing dots or spaces", async () => {
  const sourceRoot = await createTransactionFixture({});

  for (const relativePath of [
    "src/file.txt:stream",
    "src/CON",
    "src/nul.txt",
    "src/trailing.",
    "src/trailing "
  ]) {
    await assert.rejects(
      planOperations(
        sourceRoot,
        [{ type: "create", relativePath, content: "unsafe\n" }],
        { platform: "win32" }
      ),
      /unsafe Windows adapter path/
    );
  }

  await assert.rejects(
    planOperations(
      sourceRoot,
      [{ type: "create", relativePath: "safe.txt", content: "safe\n" }],
      { platform: "win32", stateDirectory: "state." }
    ),
    /unsafe Windows adapter path/
  );
});

test("non-ENOENT lstat errors are never treated as missing paths", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/existing.txt": "safe\n"
  });
  const denied = Object.assign(new Error("simulated access denied"), {
    code: "EACCES"
  });

  await assert.rejects(
    planOperations(
      sourceRoot,
      [
        {
          type: "create",
          relativePath: "src/blocked.txt",
          content: "unsafe\n"
        }
      ],
      {
        lstatImpl: async (path) => {
          if (path.endsWith("blocked.txt")) {
            throw denied;
          }
          return lstat(path);
        }
      }
    ),
    (error) => error === denied
  );
});

test("revert rejects state role tampering before source writes", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const targetPath = join(sourceRoot, "src", "file.txt");

  await applyOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "omega"
    }
  ]);
  const applied = await readFile(targetPath);
  const statePath = join(sourceRoot, STATE_DIRECTORY, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[0].created = true;
  state.files[0].beforeHash = null;
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertOperations(sourceRoot),
    /adapter state changed/
  );

  assert.deepEqual(await readFile(targetPath), applied);
});

for (const [label, stateMetadata] of [
  ["top-level Date", new Date("2026-07-12T00:00:00.000Z")],
  ["nested Date", { value: new Date("2026-07-12T00:00:00.000Z") }],
  ["undefined", { value: undefined }],
  ["function", { value() {} }],
  ["BigInt", { value: 1n }],
  ["NaN", { value: Number.NaN }],
  ["Infinity", { value: Number.POSITIVE_INFINITY }]
]) {
  test(`state metadata rejects non-JSON ${label}`, async () => {
    const sourceRoot = await createTransactionFixture({
      "src/file.txt": "alpha\n"
    });
    const before = await snapshotTree(sourceRoot);

    await assert.rejects(
      applyOperations(
        sourceRoot,
        [
          {
            type: "replace",
            relativePath: "src/file.txt",
            anchor: "alpha",
            replacement: "omega"
          }
        ],
        { stateMetadata }
      ),
      /state metadata must contain only plain JSON values/
    );

    assert.deepEqual(await snapshotTree(sourceRoot), before);
    assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
  });
}

test("inspectOperationsState enforces expected metadata and file roles", async () => {
  const { inspectOperationsState } = await import(
    "../src/adapter/transaction.mjs"
  );
  assert.equal(typeof inspectOperationsState, "function");
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha\n"
  });
  const expectedFiles = [
    { relativePath: "src/file.txt", created: false }
  ];

  await applyOperations(
    sourceRoot,
    [
      {
        type: "replace",
        relativePath: "src/file.txt",
        anchor: "alpha",
        replacement: "omega"
      }
    ],
    { stateMetadata: { adapterId: "fixture", revision: 1 } }
  );

  const inspected = await inspectOperationsState(sourceRoot, {
    expectedStateMetadata: { adapterId: "fixture", revision: 1 },
    expectedFiles
  });
  assert.equal(inspected.state.adapterId, "fixture");
  await assert.rejects(
    inspectOperationsState(sourceRoot, {
      expectedStateMetadata: { adapterId: "other", revision: 1 },
      expectedFiles
    }),
    /adapter state metadata mismatch/
  );
  await assert.rejects(
    inspectOperationsState(sourceRoot, {
      expectedStateMetadata: { adapterId: "fixture", revision: 1 },
      expectedFiles: [{ relativePath: "src/file.txt", created: true }]
    }),
    /adapter state file allowlist mismatch/
  );
});

test("sequential replacements of one path produce one file plan", async () => {
  const sourceRoot = await createTransactionFixture({
    "src/file.txt": "alpha value\n"
  });
  const before = await snapshotTree(sourceRoot);
  const original = Buffer.from("alpha value\n");
  const expected = Buffer.from("charlie value\n");

  const plan = await planOperations(sourceRoot, [
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "alpha",
      replacement: "bravo"
    },
    {
      type: "replace",
      relativePath: "src/file.txt",
      anchor: "bravo",
      replacement: "charlie"
    }
  ]);

  assert.equal(plan.files.length, 1);
  assert.equal(plan.files[0].relativePath, "src/file.txt");
  assert.deepEqual(plan.files[0].before, original);
  assert.deepEqual(plan.files[0].after, expected);
  assert.equal(plan.files[0].beforeHash, sha256(original));
  assert.equal(plan.files[0].afterHash, sha256(expected));
  assert.deepEqual(await snapshotTree(sourceRoot), before);
  assert.equal(await pathExists(join(sourceRoot, STATE_DIRECTORY)), false);
});
