import { execFile as execFileCallback } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

import { RUNTIME_PLATFORM } from "../config/constants.mjs";
import {
  readSettings,
  updateProxySettings,
  validateProxyUrl
} from "../settings/store.mjs";
import { CCU_VERSION } from "../version.mjs";
import { upgradeCcu } from "./upgrade.mjs";

export const COMMON_PROXY_PORTS = Object.freeze([
  7890,
  10809,
  10808,
  7891,
  1080,
  2080,
  2081
]);

const SKY_RGB = Object.freeze([137, 220, 235]);
const SKY = `\u001b[38;2;${SKY_RGB.join(";")}m`;
const RESET = "\u001b[0m";
const CLEAR_LINE = "\u001b[2K";
const execFile = promisify(execFileCallback);

const VPN_SIGNATURES = Object.freeze([
  [/clash[ ._-]*verge/, "Clash Verge"],
  [/clash[ ._-]*nyanpasu/, "Clash Nyanpasu"],
  [/mihomo[ ._-]*party/, "Mihomo Party"],
  [/flclash/, "FlClash"],
  [/clashx/, "ClashX"],
  [/clash/, "Clash"],
  [/mihomo/, "Mihomo / Clash"],
  [/v2rayn/, "v2rayN"],
  [/v2rayu/, "V2RayU"],
  [/v2ray/, "V2Ray"],
  [/xray/, "Xray"],
  [/sing[ ._-]*box/, "sing-box"],
  [/nekoray|nekobox/, "NekoRay"],
  [/hiddify/, "Hiddify"],
  [/shadowsocks|ss[ ._-]*local/, "Shadowsocks"],
  [/trojan/, "Trojan"],
  [/surge/, "Surge"]
]);

const PORT_SCHEMES = new Map([
  [7890, "http"],
  [10809, "http"],
  [10808, "socks5"],
  [7891, "socks5"],
  [1080, "socks5"],
  [2080, "http"],
  [2081, "socks5"]
]);

const STAGE_LABELS = Object.freeze({
  download: "下载",
  verify: "校验 SHA-256",
  extract: "安全解压",
  ready: "准备安装"
});

function normalizeListener(value) {
  const port = Number(value?.port);
  const pid = Number(value?.pid);
  if (!COMMON_PROXY_PORTS.includes(port)) return null;
  return {
    port,
    pid: Number.isSafeInteger(pid) && pid >= 0 ? pid : 0,
    processName: String(value?.processName ?? "").trim(),
    processPath: String(value?.processPath ?? "").trim()
  };
}

export function parseWindowsListeners(source) {
  if (!source.trim()) return [];
  const parsed = JSON.parse(source);
  const records = Array.isArray(parsed) ? parsed : [parsed];
  return records
    .map((record) => normalizeListener({
      port: record.Port,
      pid: record.Pid,
      processName: record.ProcessName,
      processPath: record.ProcessPath
    }))
    .filter(Boolean);
}

export function parseSsListeners(source) {
  const listeners = [];
  for (const line of source.split(/\r?\n/)) {
    const port = COMMON_PROXY_PORTS.find((candidate) =>
      new RegExp(`:${candidate}(?:\\s|$)`).test(line)
    );
    if (port === undefined) continue;
    const process = line.match(/users:\(\(\"([^\"]+)\",pid=(\d+)/);
    if (!process) continue;
    listeners.push(normalizeListener({
      port,
      pid: process[2],
      processName: process[1]
    }));
  }
  return listeners.filter(Boolean);
}

export function parseLsofListeners(source) {
  const listeners = [];
  for (const line of source.split(/\r?\n/).slice(1)) {
    const fields = line.trim().split(/\s+/);
    const port = Number(line.match(/:(\d+)\s+\(LISTEN\)\s*$/)?.[1]);
    if (fields.length < 2 || !COMMON_PROXY_PORTS.includes(port)) continue;
    listeners.push(normalizeListener({
      port,
      pid: fields[1],
      processName: fields[0]
    }));
  }
  return listeners.filter(Boolean);
}

async function runCommand(executable, args) {
  const result = await execFile(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8_000,
    maxBuffer: 1024 * 1024
  });
  return result.stdout;
}

async function windowsListeners(run) {
  const ports = COMMON_PROXY_PORTS.join(",");
  const script = [
    `$ports = @(${ports})`,
    "$items = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |",
    "  Where-Object { $ports -contains [int]$_.LocalPort } |",
    "  ForEach-Object {",
    "    $owner = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue",
    "    if ($null -ne $owner) {",
    "      [pscustomobject]@{",
    "        Port = [int]$_.LocalPort",
    "        Pid = [int]$_.OwningProcess",
    "        ProcessName = [string]$owner.ProcessName",
    "        ProcessPath = [string]$owner.Path",
    "      }",
    "    }",
    "  })",
    "$items | ConvertTo-Json -Compress"
  ].join("\n");
  return parseWindowsListeners(await run("powershell.exe", [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    script
  ]));
}

async function ssListeners(run) {
  return parseSsListeners(await run("ss", ["-H", "-ltnp"]));
}

async function lsofListeners(run) {
  return parseLsofListeners(await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]));
}

export async function listProxyListeners(options = {}) {
  const runtime = options.runtime ?? RUNTIME_PLATFORM;
  const run = options.runCommand ?? runCommand;
  if (runtime.isWindows) {
    return await windowsListeners(run).catch(() => []);
  }
  if (runtime.nodePlatform === "linux") {
    const listeners = await ssListeners(run).catch(() => []);
    if (listeners.length > 0) return listeners;
  }
  return await lsofListeners(run).catch(() => []);
}

export function identifyProxySoftware(listener) {
  const identity = `${listener?.processName ?? ""} ${listener?.processPath ?? ""}`
    .toLowerCase();
  return VPN_SIGNATURES.find(([pattern]) => pattern.test(identity))?.[1] ?? null;
}

export function selectDetectedProxy(listeners) {
  const candidates = listeners
    .map(normalizeListener)
    .filter(Boolean)
    .sort((left, right) => {
      const portOrder = COMMON_PROXY_PORTS.indexOf(left.port) -
        COMMON_PROXY_PORTS.indexOf(right.port);
      return portOrder === 0 ? left.pid - right.pid : portOrder;
    });
  for (const listener of candidates) {
    const software = identifyProxySoftware(listener);
    if (!software) continue;
    const scheme = PORT_SCHEMES.get(listener.port) ?? "http";
    return {
      ...listener,
      software,
      proxyUrl: `${scheme}://127.0.0.1:${listener.port}`
    };
  }
  return null;
}

export async function detectLocalProxy(options = {}) {
  const listeners = options.listeners ?? await listProxyListeners(options);
  return selectDetectedProxy(listeners);
}

function useColor(options, stdout) {
  const environment = options.env ?? process.env;
  return options.color ?? (stdout.isTTY === true && environment.NO_COLOR === undefined);
}

function colorize(value, enabled) {
  return enabled ? `${SKY}${value}${RESET}` : value;
}

function writeLine(stdout, value = "", color = false) {
  stdout.write(`${colorize(value, color)}\n`);
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  const units = ["B", "KiB", "MiB", "GiB"];
  let amount = value;
  let unit = units[0];
  for (const candidate of units.slice(1)) {
    if (amount < 1024) break;
    amount /= 1024;
    unit = candidate;
  }
  return `${amount >= 100 || unit === "B" ? amount.toFixed(0) : amount.toFixed(1)} ${unit}`;
}

function formatEta(value) {
  if (!Number.isFinite(value) || value < 0) return "--";
  const seconds = Math.ceil(value);
  if (seconds < 60) return `${seconds}秒`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}分${String(seconds % 60).padStart(2, "0")}秒`;
  return `${Math.floor(seconds / 3600)}时${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}分`;
}

function progressText(progress) {
  const computed = progress.totalBytes > 0
    ? progress.transferredBytes / progress.totalBytes * 100
    : 0;
  const percent = Math.max(0, Math.min(100, Number.isFinite(progress.percent)
    ? progress.percent
    : computed));
  const width = 24;
  const filled = Math.round(width * percent / 100);
  const total = progress.totalBytes > 0
    ? `${formatBytes(progress.transferredBytes)} / ${formatBytes(progress.totalBytes)}`
    : formatBytes(progress.transferredBytes);
  const speed = progress.instantBytesPerSecond ?? progress.averageBytesPerSecond;
  const metrics = [
    `${percent.toFixed(1)}%`,
    total,
    `${formatBytes(speed)}/s`,
    `ETA ${formatEta(progress.etaSeconds)}`
  ];
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}] ${metrics.join("  ")}`;
}

export function createQuickProgressRenderer(options = {}) {
  const stdout = options.stdout ?? process.stdout;
  const color = useColor(options, stdout);
  const interactive = options.interactive ?? stdout.isTTY === true;
  let activeLine = false;
  const endActiveLine = () => {
    if (!activeLine) return;
    stdout.write("\n");
    activeLine = false;
  };
  return {
    onStage({ stage, detail }) {
      endActiveLine();
      const label = STAGE_LABELS[stage] ?? stage;
      writeLine(stdout, `[${label}]${detail ? ` ${detail}` : ""}`, color);
    },
    onProgress(progress) {
      const text = colorize(progressText(progress), color);
      if (interactive) {
        stdout.write(`\r${CLEAR_LINE}${text}`);
        activeLine = true;
        if ((progress.percent ?? 0) >= 100) endActiveLine();
      } else {
        stdout.write(`${text}\n`);
      }
    },
    finish: endActiveLine
  };
}

function cloneWithNetwork(settings, network) {
  return {
    ...settings,
    network: { ...network }
  };
}

async function persistProxy(options, proxyUrl) {
  const update = options.updateProxySettings ?? updateProxySettings;
  return await update(
    options.installRoot,
    { proxyEnabled: true, proxyUrl },
    options
  );
}

async function promptManualProxy(options) {
  const stdout = options.stdout;
  writeLine(stdout, "请输入代理地址。示例：", options.color);
  writeLine(stdout, "  https://127.0.0.1:7890", options.color);
  writeLine(stdout, "  socks5://127.0.0.1:7890", options.color);
  for (;;) {
    const source = String(await options.ask("代理地址：") ?? "").trim();
    try {
      const proxyUrl = (options.validateProxyUrl ?? validateProxyUrl)(source);
      const settings = await persistProxy(options, proxyUrl);
      writeLine(stdout, `已使用代理：${proxyUrl}`, options.color);
      return settings;
    } catch (error) {
      writeLine(stdout, `代理地址无效：${error.message}`, false);
    }
  }
}

async function performUpgrade(options, settings) {
  const renderer = createQuickProgressRenderer({
    ...options,
    stdout: options.stdout,
    color: options.color
  });
  try {
    const upgrade = options.upgradeCcu ?? upgradeCcu;
    const report = await upgrade({
      ...options,
      settings,
      currentVersion: options.currentVersion ?? CCU_VERSION,
      targetVersion: options.targetVersion,
      managerPid: options.managerPid ?? 0,
      reopenManager: false,
      onStage: renderer.onStage,
      onProgress: renderer.onProgress
    });
    renderer.finish();
    if (!report.changed) {
      writeLine(options.stdout, "当前 CCU 已是最新版本。", options.color);
      return report;
    }
    writeLine(
      options.stdout,
      `CCU ${report.manifest.ccuVersion} 下载与校验完成；快捷更新器退出后开始安装。`,
      options.color
    );
    return report;
  } catch (error) {
    renderer.finish();
    throw error;
  }
}

export async function runQuickUpdate(options = {}) {
  if (!options.installRoot) throw new Error("installRoot is required");
  const stdout = options.stdout ?? process.stdout;
  const input = options.stdin ?? process.stdin;
  const color = useColor(options, stdout);
  let readline;
  const ask = options.ask ?? ((question) => {
    readline ??= createInterface({ input, output: stdout, terminal: stdout.isTTY === true });
    return readline.question(question);
  });
  const context = { ...options, stdout, color, ask };
  try {
    writeLine(stdout, "CCU 快捷更新", color);
    if (options.targetVersion) {
      writeLine(stdout, `目标版本：${String(options.targetVersion).replace(/^v/, "")}`, color);
    }
    writeLine(stdout);
    writeLine(stdout, "1. 自动配置代理并更新（推荐）");
    writeLine(stdout, "2. 直接更新");
    writeLine(stdout, "3. 手动配置代理并更新");
    writeLine(stdout, "4. 退出更新");

    let choice;
    for (;;) {
      choice = String(await ask("请选择 [1-4]：") ?? "").trim();
      if (["1", "2", "3", "4"].includes(choice)) break;
      writeLine(stdout, "请输入 1、2、3 或 4。", false);
    }
    if (choice === "4") {
      writeLine(stdout, "已退出更新。", color);
      return { changed: false, exited: true };
    }

    const read = options.readSettings ?? readSettings;
    const savedSettings = await read(options.installRoot, options.fsOps);
    if (choice === "2") {
      writeLine(stdout, "将使用直连网络更新，不修改已保存的代理设置。", color);
      return await performUpgrade(
        context,
        cloneWithNetwork(savedSettings, {
          proxyEnabled: false,
          proxyUrl: savedSettings.network.proxyUrl
        })
      );
    }
    if (choice === "3") {
      return await performUpgrade(context, await promptManualProxy(context));
    }

    const detected = await (options.detectLocalProxy ?? detectLocalProxy)(context);
    if (!detected) {
      writeLine(stdout, "未识别到常见本地代理服务，转入手动配置。", false);
      return await performUpgrade(context, await promptManualProxy(context));
    }
    writeLine(
      stdout,
      `已找到本地代理服务：${detected.software}：${detected.proxyUrl}`,
      color
    );
    try {
      return await performUpgrade(
        context,
        await persistProxy(context, detected.proxyUrl)
      );
    } catch (error) {
      writeLine(stdout, `自动代理更新失败：${error.message}`, false);
      writeLine(stdout, "已转入手动配置代理。", false);
      return await performUpgrade(context, await promptManualProxy(context));
    }
  } finally {
    readline?.close();
  }
}
