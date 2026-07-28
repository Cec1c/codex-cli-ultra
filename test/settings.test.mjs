import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  DEFAULT_PROXY_URL,
  readSettings,
  updateProxySettings
} from "../src/settings/store.mjs";

test("proxy defaults off and persists an explicit local proxy", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-settings-"));
  try {
    const initial = await readSettings(root);
    assert.deepEqual(initial.network, {
      proxyEnabled: false,
      proxyUrl: DEFAULT_PROXY_URL
    });
    await updateProxySettings(root, { proxyEnabled: true });
    assert.deepEqual((await readSettings(root)).network, {
      proxyEnabled: true,
      proxyUrl: DEFAULT_PROXY_URL
    });
    await updateProxySettings(root, { proxyUrl: "http://127.0.0.1:17890" });
    assert.deepEqual((await readSettings(root)).network, {
      proxyEnabled: true,
      proxyUrl: "http://127.0.0.1:17890"
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("proxy settings reject URLs that can carry request paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "ccu-settings-invalid-"));
  try {
    await assert.rejects(
      updateProxySettings(root, { proxyUrl: "http://127.0.0.1:7890/path" }),
      /scheme, host, and port/
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
