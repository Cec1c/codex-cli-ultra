import assert from "node:assert/strict";
import test from "node:test";

import { validateThemePack } from "../src/theme/validate.mjs";

function themePack(statusLine = {}) {
  return {
    schemaVersion: 1,
    type: "theme",
    id: "ccu.test",
    displayName: "CCU Test",
    version: "0.1.0",
    statusLine: {
      separator: " │ ",
      progressWidth: 10,
      filled: "█",
      empty: "░",
      colors: {
        model: "#5eead4",
        usage: "#93c5fd",
        progress: "#a3e635",
        time: "#fbbf24",
        quota: "#f472b6",
        separator: "#64748b"
      },
      ...statusLine
    },
    welcome: {
      title: "#5eead4",
      version: "#94a3b8",
      label: "#64748b",
      model: "#f8fafc",
      path: "#86efac",
      permissions: "#f472b6"
    }
  };
}

test("theme validator keeps schema v1 packs compatible and defaults to spaced labels", () => {
  const validated = validateThemePack(themePack());
  assert.equal(validated.statusLine.modelReasoningStyle, "spaced");
});

test("theme validator accepts bracketed model reasoning labels", () => {
  const validated = validateThemePack(themePack({ modelReasoningStyle: "bracketed" }));
  assert.equal(validated.statusLine.modelReasoningStyle, "bracketed");
});

test("theme validator accepts Hermes emoji and palette metadata", () => {
  const validated = validateThemePack(themePack({
    modelEmojis: ["🦊", "🚀"],
    palette: ["#F5E0DC", "#94E2D5"]
  }));
  assert.deepEqual(validated.statusLine.modelEmojis, ["🦊", "🚀"]);
  assert.deepEqual(validated.statusLine.palette, ["#f5e0dc", "#94e2d5"]);
});

test("theme validator rejects unknown model reasoning formats", () => {
  assert.throws(
    () => validateThemePack(themePack({ modelReasoningStyle: "template" })),
    /modelReasoningStyle must be spaced or bracketed/
  );
});
