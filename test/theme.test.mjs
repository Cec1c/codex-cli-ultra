import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("theme validator accepts rainbow_color surfaces without background fills", () => {
  const source = themePack({
    randomizePalette: false,
    softenColors: false
  });
  source.id = "rainbow_color";
  source.welcome = {
    ...source.welcome,
    border: "#89DCEB",
    command: "#89DCEB",
    badge: "#F5C2E7"
  };
  source.statusCard = {
    border: "#89DCEB",
    title: "#89DCEB",
    version: "#F5E0DC",
    label: "#89DCEB",
    model: "#F2CDCD",
    path: "#A6E3A1",
    permissions: "#FAB387",
    usage: "#89DCEB",
    progress: "#A6E3A1",
    percent: "#74C7EC",
    limits: "#F9E2AF",
    link: "#89DCEB",
    value: "#CDD6F4"
  };
  source.dialog = { selection: "#89DCEB", background: null };
  source.composer = { background: null };

  const validated = validateThemePack(source);
  assert.equal(validated.id, "rainbow_color");
  assert.equal(validated.statusLine.randomizePalette, false);
  assert.equal(validated.statusLine.softenColors, false);
  assert.equal(validated.welcome.border, "#89dceb");
  assert.deepEqual(validated.dialog, { selection: "#89dceb", background: null });
  assert.deepEqual(validated.composer, { background: null });
});

test("theme validator rejects unknown model reasoning formats", () => {
  assert.throws(
    () => validateThemePack(themePack({ modelReasoningStyle: "template" })),
    /modelReasoningStyle must be spaced or bracketed/
  );
});

test("bundled Hermes theme uses the Macchiato-inspired color roles", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../packages/themes/ccu-hermes/theme.json", import.meta.url),
      "utf8"
    )
  );
  const validated = validateThemePack(source);

  assert.equal(validated.version, "0.2.0");
  assert.deepEqual(validated.statusLine.colors, {
    model: "#ed8796",
    usage: "#c6a0f6",
    progress: "#8bd5ca",
    time: "#f5a97f",
    quota: "#eed49f",
    separator: "#b7bdf8"
  });
  assert.deepEqual(validated.welcome, {
    title: "#f5bde6",
    version: "#cad3f5",
    label: "#ed8796",
    model: "#b7bdf8",
    path: "#8bd5ca",
    permissions: "#ed8796"
  });
  assert.deepEqual(validated.statusLine.palette.slice(0, 4), [
    "#f4dbd6",
    "#f0c6c6",
    "#f5bde6",
    "#c6a0f6"
  ]);
});

test("bundled rainbow_color theme matches the approved V3 palette", async () => {
  const source = JSON.parse(
    await readFile(
      new URL("../packages/themes/rainbow_color/theme.json", import.meta.url),
      "utf8"
    )
  );
  const validated = validateThemePack(source);

  assert.equal(validated.id, "rainbow_color");
  assert.deepEqual(validated.statusLine.colors, {
    model: "#f5e0dc",
    usage: "#f5c2e7",
    progress: "#a6e3a1",
    time: "#f9e2af",
    quota: "#fab387",
    separator: "#cba6f7"
  });
  assert.equal(validated.welcome.border, "#89dceb");
  assert.equal(validated.statusCard.label, "#89dceb");
  assert.equal(validated.dialog.background, null);
  assert.equal(validated.composer.background, null);
});
