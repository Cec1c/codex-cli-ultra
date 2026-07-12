import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";

import {
  applyOperations,
  planOperations,
  revertOperations
} from "../src/adapter/transaction.mjs";
import { runCli } from "../src/cli.mjs";

const STATE_DIRECTORY = ".codex-ultra-mvp";

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

async function createCodexFixture() {
  const sourceRoot = await createTransactionFixture({
    "codex-rs/tui/src/lib.rs": LIB_SOURCE,
    "codex-rs/tui/src/bottom_pane/status_line_setup.rs": STATUS_SOURCE
  });
  return { sourceRoot };
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
        verifyGit: false
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
