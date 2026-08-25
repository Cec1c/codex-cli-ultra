import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  addPosixUserPathEntry,
  removePosixUserPathEntry
} from "../../src/installer/posix-path.mjs";

test("POSIX PATH profile block is reversible and idempotent", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-posix-profile-"));
  const profilePath = join(root, ".profile");
  try {
    await writeFile(profilePath, "export EDITOR=vim\n", "utf8");
    const first = await addPosixUserPathEntry("/opt/ccu/bin", {
      profilePath,
      env: { HOME: "/home/alice", SHELL: "/bin/bash" }
    });
    assert.equal(first.changed, true);
    const installed = await readFile(profilePath, "utf8");
    assert.match(installed, /# >>> codex-cli-ultra >>>/);
    assert.match(installed, /export PATH='\/opt\/ccu\/bin':"\$PATH"/);

    const second = await addPosixUserPathEntry("/opt/ccu/bin", {
      profilePath,
      env: { HOME: "/home/alice", SHELL: "/bin/bash" }
    });
    assert.equal(second.changed, false);

    const removed = await removePosixUserPathEntry("/opt/ccu/bin", {
      profilePath,
      env: { HOME: "/home/alice", SHELL: "/bin/bash" }
    });
    assert.equal(removed.changed, true);
    assert.equal(await readFile(profilePath, "utf8"), "export EDITOR=vim\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POSIX PATH setup targets the active interactive shell profile", async () => {
  const missing = Object.assign(new Error("missing"), { code: "ENOENT" });
  const fsOps = {
    lstat: async () => { throw missing; },
    mkdir: async () => {},
    writeFile: async () => {},
    rename: async () => {},
    rm: async () => {}
  };
  const bash = await addPosixUserPathEntry("/opt/ccu/bin", {
    env: { HOME: "/home/alice", SHELL: "/bin/bash" },
    fsOps
  });
  const zsh = await addPosixUserPathEntry("/opt/ccu/bin", {
    env: { HOME: "/home/alice", SHELL: "/bin/zsh" },
    fsOps
  });
  assert.equal(bash.profilePath, "/home/alice/.bashrc");
  assert.equal(zsh.profilePath, "/home/alice/.zshrc");
});
