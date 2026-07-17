import { spawn } from "node:child_process";

const ADD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$entry = [System.IO.Path]::GetFullPath($env:CCU_PATH_ENTRY).TrimEnd('\')
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
function Normalize-PathEntry([string]$value) {
  try { return [System.IO.Path]::GetFullPath($value).TrimEnd('\') }
  catch { return $value.Trim().TrimEnd('\') }
}
$exists = $parts | Where-Object {
  [string]::Equals((Normalize-PathEntry $_), $entry, [StringComparison]::OrdinalIgnoreCase)
}
$changed = -not [bool]$exists
if ($changed) {
  $next = (@($parts) + $entry) -join ';'
  [Environment]::SetEnvironmentVariable('Path', $next, 'User')
}
[pscustomobject]@{ changed = $changed; entry = $entry } | ConvertTo-Json -Compress
`;

const REMOVE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$entry = [System.IO.Path]::GetFullPath($env:CCU_PATH_ENTRY).TrimEnd('\')
$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$parts = @($current -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
function Normalize-PathEntry([string]$value) {
  try { return [System.IO.Path]::GetFullPath($value).TrimEnd('\') }
  catch { return $value.Trim().TrimEnd('\') }
}
$kept = @($parts | Where-Object {
  -not [string]::Equals((Normalize-PathEntry $_), $entry, [StringComparison]::OrdinalIgnoreCase)
})
$changed = $kept.Count -ne $parts.Count
if ($changed) {
  [Environment]::SetEnvironmentVariable('Path', ($kept -join ';'), 'User')
}
[pscustomobject]@{ changed = $changed; entry = $entry } | ConvertTo-Json -Compress
`;

function runPowerShell(script, entry, options = {}) {
  const spawnChild = options.spawn ?? spawn;
  return new Promise((resolve, reject) => {
    const child = spawnChild(options.executable ?? "pwsh.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script
    ], {
      shell: false,
      windowsHide: true,
      env: { ...(options.env ?? process.env), CCU_PATH_ENTRY: entry },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`PowerShell PATH update failed: ${stderr.trim()}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error("PowerShell PATH update returned invalid JSON", {
          cause: error
        }));
      }
    });
  });
}

export async function addUserPathEntry(entry, options = {}) {
  return await runPowerShell(ADD_SCRIPT, entry, options);
}

export async function removeUserPathEntry(entry, options = {}) {
  return await runPowerShell(REMOVE_SCRIPT, entry, options);
}
