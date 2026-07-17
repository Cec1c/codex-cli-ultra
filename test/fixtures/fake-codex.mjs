import { FluentBundle, FluentResource } from "@fluent/bundle";
import { readFile } from "node:fs/promises";

import { MESSAGE_SPECS } from "../../src/catalog/message-specs.mjs";

const WIRED_MESSAGES = MESSAGE_SPECS.filter(
  (record) => record.mvpStatus === "wired"
);

function sampleArguments(record) {
  return Object.fromEntries(record.args.map((argument) => [
    argument.name,
    argument.sample
  ]));
}

function englishMessages() {
  return Object.fromEntries(WIRED_MESSAGES.map((record) => {
    let value = record.english;
    for (const argument of record.args) {
      value = value.replace(`{${argument.name}}`, String(argument.sample));
    }
    return [record.id, value];
  }));
}

async function translatedMessages(path) {
  const source = await readFile(path, "utf8");
  const bundle = new FluentBundle("zh-CN", { useIsolating: false });
  const errors = bundle.addResource(new FluentResource(source));
  if (errors.length > 0) {
    throw errors[0];
  }
  return Object.fromEntries(WIRED_MESSAGES.map((record) => {
    const message = bundle.getMessage(record.ftlKey);
    const formatErrors = [];
    const value = bundle.formatPattern(
      message.value,
      sampleArguments(record),
      formatErrors
    );
    if (formatErrors.length > 0) {
      throw formatErrors[0];
    }
    return [record.id, value.trim()];
  }));
}

const ENGLISH = englishMessages();

if (!process.env.NODE_TEST_CONTEXT) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write("codex-cli 0.144.4\n");
  } else if (args.length === 1 && args[0] === "--ultra-i18n-self-check") {
    const active =
      process.env.CODEX_ULTRA_LOCALE === "zh-CN" &&
      !String(process.env.CODEX_ULTRA_FTL_PATH).includes(".missing-");
    const messages = active
      ? await translatedMessages(process.env.CODEX_ULTRA_FTL_PATH)
      : ENGLISH;
    process.stdout.write(JSON.stringify({
      schemaVersion: 1,
      active,
      locale: active ? "zh-CN" : null,
      messages
    }));
  } else {
    process.stderr.write("unsupported fake Codex arguments\n");
    process.exitCode = 2;
  }
}
