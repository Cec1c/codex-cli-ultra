import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

export async function sha256File(path) {
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += chunk.length;
    hash.update(chunk);
  }
  return {
    size,
    sha256: `sha256:${hash.digest("hex")}`
  };
}
