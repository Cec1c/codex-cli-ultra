import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const NOT_IMPLEMENTED =
  "Codex Ultra management commands are not available in this build yet.";

export async function manageMain(options = {}) {
  (options.stderr ?? process.stderr).write(`${NOT_IMPLEMENTED}\n`);
  return 2;
}

const isEntryPoint =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntryPoint) {
  manageMain()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    });
}
