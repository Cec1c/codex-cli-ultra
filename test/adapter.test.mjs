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
import { dirname, join, relative } from "node:path";
import test from "node:test";

import {
  applyCodexPatch,
  doctorCodexPatch,
  planCodexPatch,
  revertCodexPatch,
  TARGET_COMMIT
} from "../src/adapter/codex-0.144.1.mjs";

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

const SNAPSHOT_FILE_NAME =
  "codex_tui__bottom_pane__status_line_setup__tests__setup_view_snapshot_uses_zh_cn_catalog.snap";
const CODEX_MANIFEST = {
  schemaVersion: 1,
  upstreamVersion: "0.144.1",
  upstreamTag: "rust-v0.144.1",
  upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
  ultraRevision: 1,
  i18nApiVersion: 1,
  catalogVersion: 1
};
const EXPECTED_STATE_FILES = [
  { relativePath: "codex-rs/tui/src/lib.rs", created: false },
  {
    relativePath: "codex-rs/tui/src/bottom_pane/status_line_setup.rs",
    created: false
  },
  { relativePath: "codex-rs/tui/src/i18n.rs", created: true },
  { relativePath: "codex-rs/tui/src/i18n_tests.rs", created: true },
  {
    relativePath:
      "codex-rs/tui/src/bottom_pane/snapshots/" + SNAPSHOT_FILE_NAME,
    created: true
  }
];

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function rehashState(state) {
  const { stateHash: _oldHash, ...unsignedState } = state;
  return {
    ...unsignedState,
    stateHash: createHash("sha256")
      .update(Buffer.from(canonicalJson(unsignedState)))
      .digest("hex")
  };
}

async function createFixture() {
  const sourceRoot = await mkdtemp(join(tmpdir(), "codex-ultra-adapter-"));
  const overlayDir = join(sourceRoot, "overlay");
  const libPath = join(sourceRoot, "codex-rs", "tui", "src", "lib.rs");
  const statusPath = join(
    sourceRoot,
    "codex-rs",
    "tui",
    "src",
    "bottom_pane",
    "status_line_setup.rs"
  );
  await mkdir(dirname(statusPath), { recursive: true });
  await mkdir(overlayDir, { recursive: true });
  await writeFile(libPath, LIB_SOURCE, "utf8");
  await writeFile(statusPath, STATUS_SOURCE, "utf8");
  await writeFile(join(overlayDir, "i18n.rs"), "pub(crate) fn marker() {}\n", "utf8");
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
  return { sourceRoot, overlayDir, libPath, statusPath };
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
        snapshot[relative(root, path).replaceAll("\\", "/")] =
          await readFile(path, "utf8");
      }
    }
  }
  await visit(root);
  return snapshot;
}

test("planCodexPatch changes no files during preflight", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  const plan = await planCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  assert.equal(plan.files.length, 5);
  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("planCodexPatch disables optional Git locks", async () => {
  const fixture = await createFixture();
  const calls = [];

  await planCodexPatch(fixture.sourceRoot, {
    overlayDir: fixture.overlayDir,
    execFileImpl: async (file, args, options) => {
      calls.push({ file, args, options });
      if (args.includes("rev-parse")) {
        return { stdout: TARGET_COMMIT + "\n" };
      }
      return { stdout: "" };
    }
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.file, "git");
    assert.equal(call.options.env.GIT_OPTIONAL_LOCKS, "0");
  }
});

test("applyCodexPatch installs overlays and localized call sites", async () => {
  const fixture = await createFixture();

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  const status = await readFile(fixture.statusPath, "utf8");
  assert.match(status, /crate::i18n::global\(\)/);
  assert.match(status, /translator\.text\(/);
  assert.equal(
    await readFile(
      join(fixture.sourceRoot, "codex-rs", "tui", "src", "i18n.rs"),
      "utf8"
    ),
    "pub(crate) fn marker() {}\n"
  );
  assert.match(
    await readFile(
      join(
        fixture.sourceRoot,
        "codex-rs",
        "tui",
        "src",
        "bottom_pane",
        "snapshots",
        SNAPSHOT_FILE_NAME
      ),
      "utf8"
    ),
    /配置状态栏/
  );
});

test("Codex state binds manifest identity and exact file roles", async () => {
  const fixture = await createFixture();

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  const state = JSON.parse(
    await readFile(
      join(fixture.sourceRoot, ".codex-ultra-mvp", "state.json"),
      "utf8"
    )
  );
  assert.deepEqual(
    {
      adapterId: state.adapterId,
      targetCommit: state.targetCommit,
      ultraRevision: state.ultraRevision,
      i18nApiVersion: state.i18nApiVersion,
      catalogVersion: state.catalogVersion
    },
    {
      adapterId: "codex",
      targetCommit: CODEX_MANIFEST.upstreamCommit,
      ultraRevision: CODEX_MANIFEST.ultraRevision,
      i18nApiVersion: CODEX_MANIFEST.i18nApiVersion,
      catalogVersion: CODEX_MANIFEST.catalogVersion
    }
  );
  assert.deepEqual(
    state.files.map(({ relativePath, created }) => ({
      relativePath,
      created
    })),
    EXPECTED_STATE_FILES
  );
});

test("revertCodexPatch rejects a validly hashed wrong adapter identity", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.adapterId = "other-adapter";
  await writeFile(
    statePath,
    JSON.stringify(rehashState(state), null, 2) + "\n",
    "utf8"
  );

  await assert.rejects(
    revertCodexPatch(fixture.sourceRoot),
    /adapter state metadata mismatch/
  );
});

for (const [label, mutate] of [
  [
    "wrong path",
    (state) => {
      state.files[0].relativePath = "codex-rs/tui/src/other.rs";
    }
  ],
  [
    "wrong created role",
    (state) => {
      state.files[0].created = true;
      state.files[0].beforeHash = null;
    }
  ]
]) {
  test(`revertCodexPatch rejects a validly hashed ${label}`, async () => {
    const fixture = await createFixture();
    await applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir
    });
    const statePath = join(
      fixture.sourceRoot,
      ".codex-ultra-mvp",
      "state.json"
    );
    const state = JSON.parse(await readFile(statePath, "utf8"));
    mutate(state);
    await writeFile(
      statePath,
      JSON.stringify(rehashState(state), null, 2) + "\n",
      "utf8"
    );

    await assert.rejects(
      revertCodexPatch(fixture.sourceRoot),
      /adapter state file allowlist mismatch/
    );
    assert.match(await readFile(fixture.libPath, "utf8"), /mod i18n;/);
  });
}

test("doctorCodexPatch rejects damaged state instead of reporting applied", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.targetCommit = "0000000000000000000000000000000000000000";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    /adapter state changed/
  );
});

test("planCodexPatch reads and rejects a drifting version manifest", async () => {
  const fixture = await createFixture();
  const manifestPath = join(fixture.sourceRoot, "manifest.json");
  await writeFile(
    manifestPath,
    JSON.stringify(
      {
        ...CODEX_MANIFEST,
        upstreamCommit: "0000000000000000000000000000000000000000"
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  await assert.rejects(
    planCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir,
      manifestPath
    }),
    /invalid Codex adapter manifest/
  );
});

test("drift in one anchor leaves every file untouched", async () => {
  const fixture = await createFixture();
  await writeFile(
    fixture.statusPath,
    STATUS_SOURCE.replace("Configure Status Line", "Configure Status Bar"),
    "utf8"
  );
  const before = await snapshotTree(fixture.sourceRoot);

  await assert.rejects(
    applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir
    }),
    /anchor drift/
  );

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("backup failure removes adapter state without touching sources", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  await assert.rejects(
    applyCodexPatch(fixture.sourceRoot, {
      verifyGit: false,
      overlayDir: fixture.overlayDir,
      writeFileImpl: async (path, ...args) => {
        if (
          path
            .replaceAll("\\", "/")
            .includes("/.codex-ultra-mvp/backups/")
        ) {
          throw new Error("simulated backup failure");
        }
        return writeFile(path, ...args);
      }
    }),
    /simulated backup failure/
  );

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
  assert.equal(
    await pathExists(join(fixture.sourceRoot, ".codex-ultra-mvp")),
    false
  );
});

test("revertCodexPatch restores exact original bytes", async () => {
  const fixture = await createFixture();
  const before = await snapshotTree(fixture.sourceRoot);

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  await revertCodexPatch(fixture.sourceRoot);

  assert.deepEqual(await snapshotTree(fixture.sourceRoot), before);
});

test("revertCodexPatch rejects a state path outside the source root", async () => {
  const fixture = await createFixture();
  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });
  const statePath = join(
    fixture.sourceRoot,
    ".codex-ultra-mvp",
    "state.json"
  );
  const state = JSON.parse(await readFile(statePath, "utf8"));
  state.files[0].relativePath = "../outside-source.txt";
  await writeFile(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

  await assert.rejects(
    revertCodexPatch(fixture.sourceRoot),
    /unsafe adapter file path/
  );
  assert.equal(
    await pathExists(join(fixture.sourceRoot, "..", "outside-source.txt")),
    false
  );
});

test("doctorCodexPatch reports whether the adapter state is applied", async () => {
  const fixture = await createFixture();

  assert.deepEqual(
    await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false }),
    {
      targetCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
      sourceCommit: null,
      supported: null,
      applied: false
    }
  );

  await applyCodexPatch(fixture.sourceRoot, {
    verifyGit: false,
    overlayDir: fixture.overlayDir
  });

  assert.equal(
    (await doctorCodexPatch(fixture.sourceRoot, { verifyGit: false })).applied,
    true
  );
});
