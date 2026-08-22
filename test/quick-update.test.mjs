import assert from "node:assert/strict";
import test from "node:test";

import {
  createQuickProgressRenderer,
  parseLsofListeners,
  parseSsListeners,
  parseWindowsListeners,
  runQuickUpdate,
  selectDetectedProxy
} from "../src/update/quick.mjs";

function outputBuffer(isTTY = false) {
  let output = "";
  return {
    stream: {
      isTTY,
      write(chunk) {
        output += chunk;
        return true;
      }
    },
    text() {
      return output;
    }
  };
}

function answerQueue(...answers) {
  return async () => answers.shift();
}

function savedSettings() {
  return {
    schemaVersion: 1,
    updates: { checkOnStartup: true, checkIntervalHours: 6 },
    network: { proxyEnabled: true, proxyUrl: "http://127.0.0.1:7890" }
  };
}

test("listener parsers preserve port, PID, and process identity", () => {
  assert.deepEqual(parseWindowsListeners(JSON.stringify({
    Port: 7890,
    Pid: 42,
    ProcessName: "mihomo",
    ProcessPath: String.raw`C:\Program Files\Clash Verge\mihomo.exe`
  })), [{
    port: 7890,
    pid: 42,
    processName: "mihomo",
    processPath: String.raw`C:\Program Files\Clash Verge\mihomo.exe`
  }]);
  assert.deepEqual(parseSsListeners(
    'LISTEN 0 4096 127.0.0.1:10809 0.0.0.0:* users:(("v2rayN",pid=88,fd=7))'
  )[0], {
    port: 10809,
    pid: 88,
    processName: "v2rayN",
    processPath: ""
  });
  assert.deepEqual(parseLsofListeners([
    "COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME",
    "sing-box 91 alice 8u IPv4 0t0 TCP 127.0.0.1:1080 (LISTEN)"
  ].join("\n"))[0], {
    port: 1080,
    pid: 91,
    processName: "sing-box",
    processPath: ""
  });
});

test("automatic proxy detection requires a known VPN process and respects port priority", () => {
  assert.deepEqual(selectDetectedProxy([
    { port: 7890, pid: 1, processName: "unknown-server" },
    { port: 10809, pid: 2, processName: "v2rayN.exe" },
    { port: 10808, pid: 2, processName: "v2rayN.exe" }
  ]), {
    port: 10809,
    pid: 2,
    processName: "v2rayN.exe",
    processPath: "",
    software: "v2rayN",
    proxyUrl: "http://127.0.0.1:10809"
  });
  assert.equal(selectDetectedProxy([
    { port: 7890, pid: 1, processName: "node" }
  ]), null);
});

test("quick progress uses the CCU sky color and friendly metrics", () => {
  const output = outputBuffer(true);
  const progress = createQuickProgressRenderer({ stdout: output.stream, color: true });
  progress.onStage({ stage: "download", detail: "ccu.zip" });
  progress.onProgress({
    transferredBytes: 5 * 1024 * 1024,
    totalBytes: 10 * 1024 * 1024,
    percent: 50,
    instantBytesPerSecond: 2 * 1024 * 1024,
    averageBytesPerSecond: 1.5 * 1024 * 1024,
    etaSeconds: 3
  });
  progress.finish();
  assert.match(output.text(), /\u001b\[38;2;137;220;235m/);
  assert.match(output.text(), /50\.0%/);
  assert.match(output.text(), /5\.0 MiB \/ 10\.0 MiB/);
  assert.match(output.text(), /2\.0 MiB\/s/);
  assert.match(output.text(), /ETA 3秒/);
});

test("quick progress respects NO_COLOR from the process environment", () => {
  const output = outputBuffer(true);
  const progress = createQuickProgressRenderer({
    stdout: output.stream,
    env: { NO_COLOR: "1" }
  });
  progress.onStage({ stage: "download", detail: "ccu.zip" });
  progress.finish();
  assert.doesNotMatch(output.text(), /\u001b\[/);
});

test("recommended quick update detects, persists, and uses the local proxy", async () => {
  const output = outputBuffer();
  let persisted;
  let upgradeOptions;
  const report = await runQuickUpdate({
    installRoot: "C:\\ccu",
    targetVersion: "0.2.1",
    managerPid: 42,
    stdout: output.stream,
    ask: answerQueue("1"),
    readSettings: async () => savedSettings(),
    detectLocalProxy: async () => ({
      software: "Clash Verge",
      proxyUrl: "http://127.0.0.1:7890"
    }),
    updateProxySettings: async (_root, update) => {
      persisted = update;
      return { ...savedSettings(), network: { ...update } };
    },
    upgradeCcu: async (options) => {
      upgradeOptions = options;
      options.onStage({ stage: "download", detail: "ccu.zip" });
      options.onProgress({
        transferredBytes: 10,
        totalBytes: 10,
        percent: 100,
        instantBytesPerSecond: 10,
        averageBytesPerSecond: 10,
        etaSeconds: 0
      });
      return {
        changed: true,
        manifest: { ccuVersion: "0.2.1" },
        handoff: { scheduled: true }
      };
    }
  });

  assert.equal(report.changed, true);
  assert.deepEqual(persisted, {
    proxyEnabled: true,
    proxyUrl: "http://127.0.0.1:7890"
  });
  assert.equal(upgradeOptions.settings.network.proxyEnabled, true);
  assert.equal(upgradeOptions.reopenManager, false);
  assert.match(
    output.text(),
    /已找到本地代理服务：Clash Verge：http:\/\/127\.0\.0\.1:7890/
  );
  assert.match(output.text(), /快捷更新器退出后开始安装/);
});

test("failed automatic detection falls back to manual SOCKS5 configuration", async () => {
  const output = outputBuffer();
  let persisted;
  let updateSettings;
  await runQuickUpdate({
    installRoot: "C:\\ccu",
    stdout: output.stream,
    ask: answerQueue("1", "socks5://127.0.0.1:10808"),
    readSettings: async () => savedSettings(),
    detectLocalProxy: async () => null,
    updateProxySettings: async (_root, update) => {
      persisted = update;
      return { ...savedSettings(), network: { ...update } };
    },
    upgradeCcu: async (options) => {
      updateSettings = options.settings;
      return { changed: false, message: "current" };
    }
  });

  assert.deepEqual(persisted, {
    proxyEnabled: true,
    proxyUrl: "socks5://127.0.0.1:10808"
  });
  assert.equal(updateSettings.network.proxyUrl, "socks5://127.0.0.1:10808");
  assert.match(output.text(), /未识别到常见本地代理服务，转入手动配置/);
  assert.match(output.text(), /https:\/\/127\.0\.0\.1:7890/);
  assert.match(output.text(), /socks5:\/\/127\.0\.0\.1:7890/);
});

test("automatic proxy update failure retries through manual configuration", async () => {
  const output = outputBuffer();
  let upgradeCalls = 0;
  await runQuickUpdate({
    installRoot: "C:\\ccu",
    stdout: output.stream,
    ask: answerQueue("1", "https://127.0.0.1:7890"),
    readSettings: async () => savedSettings(),
    detectLocalProxy: async () => ({
      software: "Mihomo / Clash",
      proxyUrl: "http://127.0.0.1:7890"
    }),
    updateProxySettings: async (_root, update) => ({
      ...savedSettings(),
      network: { ...update }
    }),
    upgradeCcu: async () => {
      upgradeCalls += 1;
      if (upgradeCalls === 1) throw new Error("proxy connection failed");
      return { changed: false, message: "current" };
    }
  });

  assert.equal(upgradeCalls, 2);
  assert.match(output.text(), /自动代理更新失败：proxy connection failed/);
  assert.match(output.text(), /已转入手动配置代理/);
});

test("direct quick update bypasses the saved proxy without mutating it", async () => {
  const output = outputBuffer();
  let upgradeSettings;
  await runQuickUpdate({
    installRoot: "C:\\ccu",
    stdout: output.stream,
    ask: answerQueue("2"),
    readSettings: async () => savedSettings(),
    updateProxySettings: async () => assert.fail("direct mode must not persist settings"),
    upgradeCcu: async (options) => {
      upgradeSettings = options.settings;
      return { changed: false, message: "current" };
    }
  });

  assert.equal(upgradeSettings.network.proxyEnabled, false);
  assert.equal(upgradeSettings.network.proxyUrl, "http://127.0.0.1:7890");
  assert.match(output.text(), /不修改已保存的代理设置/);
});

test("exit choice performs no status read or update", async () => {
  const output = outputBuffer();
  const report = await runQuickUpdate({
    installRoot: "C:\\ccu",
    stdout: output.stream,
    ask: answerQueue("4"),
    readSettings: async () => assert.fail("exit must not read settings"),
    upgradeCcu: async () => assert.fail("exit must not update")
  });
  assert.deepEqual(report, { changed: false, exited: true });
});
