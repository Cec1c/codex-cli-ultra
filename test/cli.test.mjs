import assert from "node:assert/strict";
import test from "node:test";

import { runCli } from "../src/cli.mjs";

test("catalog extract requires a source path", async () => {
  await assert.rejects(
    runCli(["catalog", "extract"]),
    /catalog extract requires --source PATH/
  );
});

test("unknown commands return concise usage", async () => {
  await assert.rejects(runCli(["unknown"]), /Usage:/);
});
