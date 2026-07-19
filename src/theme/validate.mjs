const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

function assertRecord(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function assertExactKeys(value, keys, label) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i])) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}`);
  }
}

function assertAllowedKeys(value, requiredKeys, optionalKeys, label) {
  const actual = Object.keys(value);
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const unknown = actual.filter((key) => !allowed.has(key));
  const missing = requiredKeys.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0 || missing.length > 0) {
    const suffix = [
      missing.length > 0 ? `missing: ${missing.join(", ")}` : null,
      unknown.length > 0 ? `unknown: ${unknown.join(", ")}` : null
    ].filter(Boolean).join("; ");
    throw new Error(`${label} has invalid keys (${suffix})`);
  }
}

function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function color(value, label) {
  if (typeof value !== "string" || !HEX_COLOR.test(value)) {
    throw new Error(`${label} must be a #RRGGBB color`);
  }
  return value.toLowerCase();
}

export function validateThemePack(value) {
  assertRecord(value, "theme");
  assertExactKeys(
    value,
    ["schemaVersion", "type", "id", "displayName", "version", "statusLine", "welcome"],
    "theme"
  );
  if (value.schemaVersion !== 1 || value.type !== "theme") {
    throw new Error("unsupported theme schema or type");
  }
  const id = nonempty(value.id, "theme.id");
  if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(id)) {
    throw new Error("theme.id must use lowercase dotted or dashed segments");
  }

  assertRecord(value.statusLine, "theme.statusLine");
  assertAllowedKeys(
    value.statusLine,
    ["separator", "progressWidth", "filled", "empty", "colors"],
    ["modelReasoningStyle", "modelEmojis", "palette"],
    "theme.statusLine"
  );
  if (!Number.isSafeInteger(value.statusLine.progressWidth) || value.statusLine.progressWidth < 4 || value.statusLine.progressWidth > 30) {
    throw new Error("theme.statusLine.progressWidth must be an integer from 4 to 30");
  }
  const modelReasoningStyle = value.statusLine.modelReasoningStyle ?? "spaced";
  if (!["spaced", "bracketed"].includes(modelReasoningStyle)) {
    throw new Error("theme.statusLine.modelReasoningStyle must be spaced or bracketed");
  }
  const modelEmojis = value.statusLine.modelEmojis ?? [];
  if (
    !Array.isArray(modelEmojis) ||
    modelEmojis.length > 64 ||
    modelEmojis.some((emoji) =>
      typeof emoji !== "string" ||
      emoji.length === 0 ||
      [...emoji].length > 8 ||
      /[\u0000-\u001f\u007f]/.test(emoji)
    )
  ) {
    throw new Error("theme.statusLine.modelEmojis must contain up to 64 short strings");
  }
  const palette = value.statusLine.palette ?? [];
  if (!Array.isArray(palette) || palette.length > 32) {
    throw new Error("theme.statusLine.palette must contain up to 32 colors");
  }
  assertRecord(value.statusLine.colors, "theme.statusLine.colors");
  assertExactKeys(
    value.statusLine.colors,
    ["model", "usage", "progress", "time", "quota", "separator"],
    "theme.statusLine.colors"
  );

  assertRecord(value.welcome, "theme.welcome");
  assertExactKeys(
    value.welcome,
    ["title", "version", "label", "model", "path", "permissions"],
    "theme.welcome"
  );

  return {
    schemaVersion: 1,
    type: "theme",
    id,
    displayName: nonempty(value.displayName, "theme.displayName"),
    version: nonempty(value.version, "theme.version"),
    statusLine: {
      separator: nonempty(value.statusLine.separator, "theme.statusLine.separator"),
      progressWidth: value.statusLine.progressWidth,
      filled: nonempty(value.statusLine.filled, "theme.statusLine.filled"),
      empty: nonempty(value.statusLine.empty, "theme.statusLine.empty"),
      modelEmojis: modelEmojis.map((emoji) => emoji),
      palette: palette.map((value, index) =>
        color(value, `theme.statusLine.palette[${index}]`)
      ),
      modelReasoningStyle,
      colors: Object.fromEntries(
        Object.entries(value.statusLine.colors).map(([key, value]) => [
          key,
          color(value, `theme.statusLine.colors.${key}`)
        ])
      )
    },
    welcome: Object.fromEntries(
      Object.entries(value.welcome).map(([key, value]) => [
        key,
        color(value, `theme.welcome.${key}`)
      ])
    )
  };
}
