import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const UPSTREAM_COMMIT = "44918ea10c0f99151c6710411b4322c2f5c96bea";

function findAllIndexes(source, anchor) {
  const indexes = [];
  let offset = 0;
  while (offset <= source.length) {
    const index = source.indexOf(anchor, offset);
    if (index === -1) {
      break;
    }
    indexes.push(index);
    offset = index + anchor.length;
  }
  return indexes;
}

function compareIds(left, right) {
  if (left.id < right.id) {
    return -1;
  }
  if (left.id > right.id) {
    return 1;
  }
  return 0;
}

export async function extractCatalog(sourceRoot, specs) {
  const records = [];
  for (const spec of specs) {
    const source = await readFile(join(sourceRoot, spec.path), "utf8");
    const indexes = findAllIndexes(source, spec.anchor);
    const expectedOccurrences = spec.expectedOccurrences ?? 1;
    if (indexes.length !== expectedOccurrences) {
      const expectedLabel =
        expectedOccurrences === 1 ? "one" : expectedOccurrences;
      throw new Error(
        `${spec.id}: expected exactly ${expectedLabel} source anchor, found ${indexes.length}`
      );
    }

    const lines = indexes.map(
      (index) => source.slice(0, index).split(/\r?\n/).length
    );
    const fingerprintPayload = `${spec.path}|${spec.symbol}|${spec.english}`;
    const fingerprint = createHash("sha256")
      .update(fingerprintPayload)
      .digest("hex");

    records.push({
      schemaVersion: 1,
      catalogVersion: 1,
      id: spec.id,
      ftlKey: spec.ftlKey,
      surface: spec.surface,
      english: spec.english,
      kind: spec.kind,
      args: spec.args ?? [],
      expectedOccurrences,
      placeholders: spec.placeholders ?? [],
      richSlots: spec.richSlots ?? [],
      translation: spec.translation,
      mvpStatus: spec.mvpStatus,
      source: {
        repository: "openai/codex",
        release: "rust-v0.144.1",
        commit: UPSTREAM_COMMIT,
        path: spec.path,
        symbol: spec.symbol,
        line: lines[0],
        lines,
        fingerprint: `sha256:${fingerprint}`
      },
      firstSeen: "0.144.1",
      lastVerified: "0.144.1"
    });
  }
  return records.sort(compareIds);
}

function escapeTableCell(value) {
  return String(value).replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

const STATUS_SECTIONS = [
  ["wired", "已接入 MVP / Wired in MVP"],
  ["catalogued", "已整理待接入 / Catalogued for Later Wiring"],
  ["idea", "创意候选 / Feature Idea"]
];

export async function writeCatalogArtifacts(
  records,
  { jsonlPath, markdownPath }
) {
  await mkdir(dirname(jsonlPath), { recursive: true });
  await mkdir(dirname(markdownPath), { recursive: true });

  const jsonl = records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await writeFile(jsonlPath, jsonl, "utf8");

  const lines = [
    "# Codex CLI 0.144.1 TUI 文本目录 / TUI Text Inventory",
    "",
    "> 本文件由机器目录生成，请勿手工维护重复字段。",
    "> This file is generated from the machine catalog; do not maintain duplicate fields manually.",
    "",
    `共整理 ${records.length} 条真实源码消息。`,
    `Catalogued ${records.length} messages from real source locations.`,
    ""
  ];

  for (const [status, title] of STATUS_SECTIONS) {
    const sectionRecords = records.filter((record) => record.mvpStatus === status);
    if (sectionRecords.length === 0) {
      continue;
    }
    lines.push(`## ${title}`, "");
    lines.push(
      "| 消息 ID / Message ID | 英文原文 / English | 分类 / Kind | 源码 / Source |",
      "| --- | --- | --- | --- |"
    );
    for (const record of sectionRecords) {
      lines.push(
        `| ${escapeTableCell(record.id)} | ${escapeTableCell(record.english)} | ${escapeTableCell(record.kind)} | ${escapeTableCell(record.source.path)}:${record.source.line} |`
      );
    }
    lines.push("");
  }

  await writeFile(markdownPath, lines.join("\n").trimEnd() + "\n", "utf8");
}
