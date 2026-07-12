# Windows Release, CI, and End-to-End MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从精确 Codex 0.144.1 源码和已审阅 i18n 适配器构建完整 Windows x64 预编译包，发布清单、哈希、许可证、对应源码和执行器，并通过 GitHub Actions 在干净 Windows 环境完成真实安装、中文自检、英文回退、官方回退和卸载。

**Architecture:** PR CI 分离快速 Node/PowerShell 检查、Rust 适配器验证和完整 Windows 包构建。Release workflow 使用上游 `scripts/build_codex_package.py` 保留规范 package 布局，项目脚本生成确定性资产、许可证集合、对应源码和 manifest；发布前 E2E 只消费这些资产，不复用构建工作树。

**Tech Stack:** GitHub Actions、Windows Server runner、PowerShell 7、Node.js 24.15.0、npm 11.12.1、Python 3.12、Rust/Cargo 1.95.0、upstream `scripts/build_codex_package.py`、GitHub CLI、SHA-256、deterministic ZIP/tar.gz。

## Global Constraints

- Stable target: Codex CLI `0.144.1`, tag `rust-v0.144.1`, commit `44918ea10c0f99151c6710411b4322c2f5c96bea`, Ultra revision `1`, platform `x86_64-pc-windows-msvc`.
- Upstream checkout, tag and commit must all agree before applying the adapter.
- Rust/Cargo must resolve through upstream `codex-rs/rust-toolchain.toml` to 1.95.0; CI must not update `Cargo.lock`.
- Windows package must be produced by upstream `scripts/build_codex_package.py --cargo-profile release --target x86_64-pc-windows-msvc` and preserve the complete canonical package directory.
- Every modified-binary asset must ship upstream Apache-2.0 LICENSE/NOTICE, project GPL-3.0, JS dependency licenses, Rust dependency notices, exact build metadata and freely downloadable corresponding source.
- Release source contains pristine upstream source at the pinned commit plus this project's exact release commit, adapters and build scripts; it must reconstruct the same patched source diff.
- Normal launcher remains offline. Network is permitted only in explicit install/update/diagnostic and CI/Release jobs.
- Release manifest sizes and SHA-256 values are computed from final immutable bytes, never predicted values.
- Publishing occurs only after Node, Rust, package, source, install, fallback and uninstall jobs all pass.
- The first public artifact is a GitHub prerelease. Code signing and attestations may be added later but are not falsely claimed in MVP metadata.
- All project commits use Chinese Conventional Commit messages.

## Planned File Map

```text
.github/workflows/ci.yml                    PR and main validation
.github/workflows/release-windows.yml       build, E2E and prerelease publication
scripts/check-public-repo.mjs               private path/template/generated drift gate
scripts/build-windows-release.ps1           pinned adapter and upstream package builder
scripts/assemble-release.mjs                asset tree, manifest and build metadata
scripts/collect-js-licenses.mjs             bundled npm dependency license collection
scripts/package-assets.py                   deterministic ZIP and tar.gz creation
scripts/build-source-archive.ps1            corresponding-source staging
scripts/verify-source-archive.ps1           patch-set and metadata reconstruction
scripts/e2e-windows-release.ps1              clean real install/fallback/uninstall proof
config/cargo-about.toml                     Rust license policy
config/cargo-about.hbs                      Rust notices output
test/release/*.test.mjs                     manifest, archive and metadata tests
docs/release/windows-mvp.md                  operator and compliance record
release/README.md                            asset naming and immutable version policy
```

---

### Task 1: 建立公共仓库检查和 PR CI 快速门禁

**Files:**
- Create: `scripts/check-public-repo.mjs`
- Create: `test/release/public-repo.test.mjs`
- Create: `.github/workflows/ci.yml`
- Modify: `package.json`

**Interfaces:**
- Consumes: tracked repository files and exact upstream checkout.
- Produces: `npm run check:public`, `npm run ci:fast`, and required GitHub Actions checks.

- [ ] **Step 1: 写公共文件泄漏 RED 测试**

`test/release/public-repo.test.mjs` creates a temporary tracked-file list and proves the checker rejects:

- references to project-private scratch directories;
- maintainer-specific drive-qualified workspace or user-profile paths;
- unfinished-task markers and unresolved template sentinel tokens in Release-facing docs and scripts;
- tracked `node_modules`, `dist`, `.worktrees`, private keys and `.env` files.

It permits fixed upstream paths inside code fixtures only when they are explicitly marked as synthetic test values.

- [ ] **Step 2: 实现仓库检查器**

`scripts/check-public-repo.mjs` obtains tracked files from `git ls-files -z`, scans UTF-8 text files smaller than 2 MiB, and exits 1 with `path:line: rule` records. Binary assets and generated license bodies are skipped by explicit extension/path allowlists. It also runs `git diff --check` and verifies each plan link in `docs/superpowers/plans/2026-07-12-i18n-mvp.md` exists.

- [ ] **Step 3: 定义快速 CI workflow**

Create `.github/workflows/ci.yml` with:

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  node-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run check:public
      - shell: pwsh
        run: pwsh -NoProfile -File scripts/test-launcher-installer.ps1

  rust-i18n-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/checkout@v4
        with:
          repository: openai/codex
          ref: 44918ea10c0f99151c6710411b4322c2f5c96bea
          fetch-depth: 0
          path: upstream
      - uses: actions/setup-node@v4
        with:
          node-version: 24.15.0
          cache: npm
      - run: npm ci
      - shell: pwsh
        run: |
          if ((git -C upstream rev-parse 'rust-v0.144.1^{commit}') -ne '44918ea10c0f99151c6710411b4322c2f5c96bea') { throw 'tag mismatch' }
          $env:CODEX_UPSTREAM_SOURCE = (Resolve-Path upstream).Path
          npm test
          node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
          git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
          node src/cli.mjs adapter apply --source $env:CODEX_UPSTREAM_SOURCE
          pwsh -NoProfile -File scripts/test-i18n-runtime.ps1 -SourceWorktree $env:CODEX_UPSTREAM_SOURCE
```

Add workflow path filters only after the first stable baseline; the initial repository runs both jobs on every PR so no change silently escapes a required gate.

- [ ] **Step 4: 运行本地等价检查并提交**

```powershell
npm run build
npm test
npm run check:public
git diff --check
git add .github/workflows/ci.yml scripts/check-public-repo.mjs test/release/public-repo.test.mjs package.json package-lock.json
git commit -m "ci: 添加 i18n 与安装器验证门禁"
```

Expected: local checks pass; the GitHub workflow YAML contains only read permission.

---

### Task 2: 构建完整 Windows canonical package

**Files:**
- Create: `scripts/build-windows-release.ps1`
- Create: `test/release/build-contract.test.mjs`
- Create: `release/README.md`

**Interfaces:**
- Consumes: project checkout, exact pristine upstream checkout and output directory.
- Produces: a patched-source worktree, canonical `package/` directory, raw package ZIP and build-command metadata.

- [ ] **Step 1: 写构建合同 RED 测试**

The test parses `scripts/build-windows-release.ps1` and asserts it contains all non-negotiable arguments:

```text
--target x86_64-pc-windows-msvc
--variant codex
--cargo-profile release
--package-dir
LIBSQLITE3_FLAGS=SQLITE_DISABLE_INTRINSIC
```

It rejects direct `cargo build` as the final packaging step, any `git reset --hard`, omitted upstream commit verification, or copying only `codex.exe` without `codex-package.json`, `codex-resources`, and `codex-path`.

- [ ] **Step 2: 实现隔离构建脚本**

`scripts/build-windows-release.ps1` parameters:

```powershell
param(
    [Parameter(Mandatory)] [string]$UpstreamSource,
    [Parameter(Mandatory)] [string]$OutputRoot,
    [string]$ReleaseId = '0.144.1-ultra.1'
)
```

The script verifies the exact upstream HEAD and tag, creates a unique detached worktree from the pinned commit, applies the adapter, runs Plan 1 tests, then executes from the patched upstream root:

```powershell
$env:LIBSQLITE3_FLAGS = 'SQLITE_DISABLE_INTRINSIC'
python scripts/build_codex_package.py `
  --target x86_64-pc-windows-msvc `
  --variant codex `
  --cargo-profile release `
  --package-dir (Join-Path $OutputRoot 'package') `
  --archive-output (Join-Path $OutputRoot 'canonical-package.zip')
```

After build it requires these exact paths:

```text
package/codex-package.json
package/bin/codex.exe
package/bin/codex-code-mode-host.exe
package/codex-resources/codex-command-runner.exe
package/codex-resources/codex-windows-sandbox-setup.exe
package/codex-path/rg.exe
```

It runs `package/bin/codex.exe --version`, valid zh-CN self-check and missing-FTL English self-check. The script writes `raw-build-metadata.json` containing command, tool versions, upstream/project commits and the size/SHA-256 of each package file.

- [ ] **Step 3: 验证 builder 帮助与合同并提交**

```powershell
python $env:CODEX_UPSTREAM_SOURCE\scripts\build_codex_package.py --help
node --test test/release/build-contract.test.mjs
git diff --check
git add scripts/build-windows-release.ps1 test/release/build-contract.test.mjs release/README.md
git commit -m "build: 添加 Windows Codex 完整包构建"
```

Expected: contract tests pass without performing the expensive release build locally.

---

### Task 3: 收集许可证并组装确定性 Release 资产

**Files:**
- Create: `config/cargo-about.toml`
- Create: `config/cargo-about.hbs`
- Create: `scripts/collect-js-licenses.mjs`
- Create: `scripts/package-assets.py`
- Create: `scripts/assemble-release.mjs`
- Create: `test/release/assemble.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: canonical package, executor bundles, zh-CN pack, upstream/project licenses, Rust and npm dependency metadata.
- Produces: primary Windows ZIP, standalone executor MJS, language ZIP, license tree, build metadata and final Release manifest.

- [ ] **Step 1: 写资产结构与 manifest RED 测试**

The assembler test uses small fixture files and requires this final primary ZIP tree:

```text
package/
  codex-package.json
  bin/codex.exe
  bin/codex-code-mode-host.exe
  codex-resources/
  codex-path/rg.exe
executor/
  launcher.mjs
  codex-ultra.mjs
  codex.cmd
  codex.ps1
  codex-ultra.cmd
  codex-ultra.ps1
  uninstall.ps1
  set-user-path.ps1
LICENSES/
  UPSTREAM-LICENSE
  UPSTREAM-NOTICE
  GPL-3.0
  THIRD-PARTY-RUST.html
  THIRD-PARTY-NPM.txt
BUILD-METADATA.json
```

Assert final manifest exact keys, basenames, sizes and hashes for `executor`, `asset`, `language`, and `sourceArchive`; changing one final byte must change the recorded hash. Assert asset names are:

```text
codex-ultra-executor-0.1.0.mjs
codex-ultra-0.144.1-u1-windows-x64.zip
codex-ultra-language-zh-CN-v1.zip
codex-ultra-0.144.1-u1-source.tar.gz
release-manifest.json
install.ps1
```

- [ ] **Step 2: 固定 Rust 许可证策略**

`config/cargo-about.toml` accepts only SPDX expressions compatible with Apache-2.0/GPL-3.0 distribution:

```toml
accepted = [
  "Apache-2.0",
  "MIT",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "ISC",
  "Unicode-3.0",
  "Zlib",
  "BSL-1.0",
  "CC0-1.0",
  "MPL-2.0",
  "OpenSSL"
]
```

Generate notices from the patched `codex-rs` with pinned Cargo:

```powershell
cargo install cargo-about --locked --version 0.7.1
cargo about generate --config $projectRoot\config\cargo-about.toml $projectRoot\config\cargo-about.hbs > $licenseRoot\THIRD-PARTY-RUST.html
```

Unknown, unlicensed or confidence-failed dependencies stop the Release. The implementation may add a clearly documented crate-specific clarification only after inspecting that crate's shipped license files; it may not add a wildcard acceptance rule.

- [ ] **Step 3: 收集 bundled npm 许可证**

`scripts/collect-js-licenses.mjs` walks the `packages` entries in `package-lock.json`, ignores the root entry and development-only packages not present in the `dist/codex-ultra.mjs` esbuild metafile, then reads each bundled package's `package.json` and first existing `LICENSE`, `LICENSE.md`, `LICENSE.txt`, or `COPYING`. It writes sorted sections containing package name/version/license and full license body. Missing license metadata or body is a hard failure.

- [ ] **Step 4: 实现确定性归档**

`scripts/package-assets.py` supports `zip DIRECTORY OUTPUT` and `tar-gz DIRECTORY OUTPUT`. It sorts POSIX relative paths, rejects symlinks, sets ZIP timestamps to `1980-01-01 00:00:00`, normalizes file mode to `0644` or executable `0755`, and for tar sets uid/gid/mtime to zero and gzip mtime to zero. Running it twice on unchanged input must produce identical SHA-256.

- [ ] **Step 5: 实现 Release assembler**

`assemble-release.mjs` copies canonical package and executor files into a new staging root, verifies the hidden self-check in `package/bin/codex.exe`, copies exact license files, embeds `BUILD-METADATA.json`, calls the deterministic archiver, packages `packages/languages/zh-CN` separately, copies `dist/codex-ultra.mjs` as the standalone executor asset, then computes all final sizes and hashes before writing `release-manifest.json`.

The manifest uses:

```javascript
{
  schemaVersion: 1,
  upstreamVersion: "0.144.1",
  upstreamTag: "rust-v0.144.1",
  upstreamCommit: "44918ea10c0f99151c6710411b4322c2f5c96bea",
  ultraRevision: 1,
  i18nApiVersion: 1,
  catalogVersion: 1,
  platform: "x86_64-pc-windows-msvc",
  executor: fileRecord("codex-ultra-executor-0.1.0.mjs"),
  asset: fileRecord("codex-ultra-0.144.1-u1-windows-x64.zip"),
  language: (() => {
    const file = fileRecord("codex-ultra-language-zh-CN-v1.zip");
    return { locale: "zh-CN", asset: file.name, size: file.size, sha256: file.sha256 };
  })(),
  sourceArchive: fileRecord("codex-ultra-0.144.1-u1-source.tar.gz"),
  signature: null
}
```

`fileRecord` returns `{ name, size, sha256 }`; the language record explicitly renames `name` to `asset` to match Plan 2 validation.

- [ ] **Step 6: 运行确定性与结构测试并提交**

```powershell
npm run build
node --test test/release/assemble.test.mjs
npm test
git diff --check
git add config scripts/collect-js-licenses.mjs scripts/package-assets.py scripts/assemble-release.mjs test/release/assemble.test.mjs package.json package-lock.json
git commit -m "build: 添加许可证与确定性 Release 组装"
```

Expected: two fixture assemblies produce byte-identical archives and valid manifests.

---

### Task 4: 生成并验证完整对应源码归档

**Files:**
- Create: `scripts/build-source-archive.ps1`
- Create: `scripts/verify-source-archive.ps1`
- Create: `test/release/source-archive.test.mjs`

**Interfaces:**
- Consumes: clean project release commit, pristine pinned upstream checkout, adapter and raw build metadata.
- Produces: deterministic corresponding-source tree/archive and patch reconstruction evidence.

- [ ] **Step 1: 写源码归档合同 RED 测试**

Require the staged source tree to contain:

```text
upstream/                 pristine openai/codex source at pinned commit
ultra/                    this repository at exact Release commit
BUILD-METADATA.json
SOURCE-CONTENTS.json
```

Reject Git metadata, project-private scratch/worktree directories, `node_modules`, `dist`, credentials and built binaries. `SOURCE-CONTENTS.json` records both Git commits, upstream tag/commit, adapter manifest hash, patched diff SHA-256 and build script paths.

- [ ] **Step 2: 实现源码 staging**

`build-source-archive.ps1` requires clean project and upstream worktrees. It uses `git archive` for each repository into separate temporary archives, extracts them under `ultra/` and `upstream/`, writes metadata, then calls deterministic `package-assets.py tar-gz`. It does not copy the maintainer's working directories recursively.

Before archiving, create a fresh upstream detached worktree, apply the adapter and compute:

```powershell
$diff = git -C $patched diff --binary --no-ext-diff
$patchedDiffSha256 = 'sha256:' + [Convert]::ToHexString(
  [Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes(($diff -join "`n") + "`n"))
).ToLowerInvariant()
```

Store the exact hash in both `SOURCE-CONTENTS.json` and Release build metadata.

- [ ] **Step 3: 实现归档重建验证**

`verify-source-archive.ps1` extracts the archive to a new temporary root, verifies both commits from metadata, runs `npm ci` in `ultra`, sets `CODEX_UPSTREAM_SOURCE` to extracted `upstream`, applies the adapter to a new detached worktree, recomputes the binary diff hash and requires equality with `patchedDiffSha256`. It also runs the catalog extractor twice and requires no generated diff.

- [ ] **Step 4: 运行 fixture 测试并提交**

```powershell
node --test test/release/source-archive.test.mjs
git diff --check
git add scripts/build-source-archive.ps1 scripts/verify-source-archive.ps1 test/release/source-archive.test.mjs
git commit -m "build: 添加对应源码归档与重建验证"
```

Expected: missing source components or a changed adapter produces a deterministic verification failure.

---

### Task 5: 用真实官方 Codex 和真实 Ultra 包完成 Windows E2E

**Files:**
- Create: `scripts/e2e-windows-release.ps1`
- Create: `test/release/e2e-contract.test.mjs`
- Modify: `scripts/install.ps1`

**Interfaces:**
- Consumes: assembled Release directory, temporary npm prefix and temporary Ultra home.
- Produces: machine-readable E2E evidence for real installation, Chinese, English fallback, official fallback, offline launch and uninstall.

- [ ] **Step 1: 写 E2E 合同 RED 测试**

The contract test requires the PowerShell script to execute these observable checks in order:

```text
npm install -g @openai/codex@0.144.1
install from final Release assets
Get-Command codex resolves Ultra wrapper first
codex --version exits 0
codex --ultra-i18n-self-check returns 加班了 7m 57s
missing language resource returns Worked for 7m 57s
official package version mismatch selects official absolute binary
Ultra metadata drift selects official absolute binary
invalid HTTP(S) proxy does not block an installed launch
doctor --json explains each selected target and reason
uninstall restores the official wrapper and preserves official package/config roots
```

The test rejects invoking the built `package/bin/codex.exe` directly for localized checks because that would bypass the installed launcher.

- [ ] **Step 2: 实现 production bootstrap installer**

Update `scripts/install.ps1` so a downloaded copy can run outside a development checkout. Defaults:

```powershell
param(
    [string]$Tag = 'v0.144.1-ultra.1',
    [string]$Repository = 'Cec1c/codex-cli-ultra',
    [string]$ManifestUrl,
    [string]$GitHubToken
)
```

If `ManifestUrl` is absent, construct the immutable GitHub Release URL for the tag. Download `release-manifest.json`, validate schema 1 and the executor basename, size and SHA-256 in PowerShell, download only the standalone executor to a unique temp directory, verify exact bytes, then run:

```text
node $verifiedExecutorPath install --manifest-url $immutableManifestUrl
```

Pass an Authorization header only when `GitHubToken` is explicitly supplied by CI; never write it to state, logs or command output. The script rejects Node major versions below 24 and never installs Rust.

- [ ] **Step 3: 实现真实 Windows E2E 脚本**

`scripts/e2e-windows-release.ps1` creates unique roots under `$env:RUNNER_TEMP`, sets an isolated `npm_config_prefix`, installs official Codex 0.144.1, and sets `CODEX_ULTRA_HOME` to the isolated Ultra root. It runs the verified standalone executor against the assembled local Release directory, prepends the installed Ultra bin and isolated npm prefix to the current process PATH, then performs the contract checks.

For fault injection:

- temporarily move `messages.ftl` aside and restore it in `finally`;
- edit only the isolated official package's `version` field to `0.145.0`, then restore original bytes;
- change only the installed Ultra executable's `LastWriteTimeUtc` to force metadata fallback, then restore it;
- set `HTTP_PROXY` and `HTTPS_PROXY` to `http://127.0.0.1:9` for the offline launch check.

Before uninstall, record hashes of the isolated official platform binary and a sentinel file under a fake Codex config root. After uninstall, require both hashes unchanged and `Get-Command codex` to resolve the official npm wrapper.

Write `e2e-evidence.json` with command, exit code, selected path/reason, and boolean assertions only; do not include tokens, environment dumps, auth data or session content.

- [ ] **Step 4: 运行合同测试并提交**

```powershell
node --test test/release/e2e-contract.test.mjs
git diff --check
git add scripts/install.ps1 scripts/e2e-windows-release.ps1 test/release/e2e-contract.test.mjs
git commit -m "test: 添加 Windows Release 真实安装验证"
```

Expected: the inexpensive contract test passes locally; the expensive real E2E runs in Actions after assets are assembled.

---

### Task 6: 建立 Windows Release workflow 和 prerelease 发布门禁

**Files:**
- Create: `.github/workflows/release-windows.yml`
- Create: `test/release/workflow.test.mjs`

**Interfaces:**
- Consumes: tag `v0.144.1-ultra.1` or manual workflow dispatch.
- Produces: validated Actions artifacts and, for the exact tag, a public immutable GitHub prerelease.

- [ ] **Step 1: 写 workflow 结构 RED 测试**

Parse workflow YAML and require jobs with this dependency chain:

```text
build-windows -> verify-source -> e2e-local -> stage-draft -> e2e-draft -> publish-prerelease
```

Require `contents: write` only on draft/publish jobs, exact tag validation, artifact hashes passed between jobs, and `publish-prerelease` conditioned on every prerequisite result being success. Reject `continue-on-error: true` on any verification step.

- [ ] **Step 2: 创建构建和本地 E2E jobs**

The workflow checks out this repository and upstream into separate directories, installs Node 24.15.0 and Python 3.12, lets upstream rust-toolchain select Rust 1.95.0, runs `npm ci`, Plan 1/2 tests, then:

```powershell
pwsh -NoProfile -File scripts/build-windows-release.ps1 -UpstreamSource upstream -OutputRoot build\raw
pwsh -NoProfile -File scripts/build-source-archive.ps1 -UpstreamSource upstream -OutputRoot build\assets
node scripts/assemble-release.mjs --raw build\raw --output build\assets
pwsh -NoProfile -File scripts/verify-source-archive.ps1 -Archive build\assets\codex-ultra-0.144.1-u1-source.tar.gz
pwsh -NoProfile -File scripts/e2e-windows-release.ps1 -ReleaseDirectory build\assets
```

Upload all final assets plus `raw-build-metadata.json`, `e2e-evidence.json`, test logs and checksums as Actions artifacts. Symbols may be retained as CI artifacts without putting them in the user installer.

- [ ] **Step 3: 创建 draft 和 GitHub-origin E2E**

On the exact tag only, `stage-draft` uses `gh release create v0.144.1-ultra.1 --draft --prerelease` and uploads final immutable assets. `e2e-draft` downloads the draft `release-manifest.json` and executor through GitHub's authenticated asset API, passes the token only in request headers, runs the production `install.ps1`, and repeats the real E2E selection/fallback/uninstall checks against GitHub-origin bytes.

If draft E2E fails, the workflow leaves an unpublished draft for inspection and does not edit it public.

- [ ] **Step 4: 发布 prerelease**

`publish-prerelease` re-downloads every draft asset, verifies manifest sizes and SHA-256 one final time, then executes:

```powershell
gh release edit v0.144.1-ultra.1 --draft=false --prerelease --latest=false
```

Release notes clearly state: early MVP, Windows x64 only, unsigned prerelease, exact official Codex 0.144.1 compatibility, external zh-CN language pack, compiled-English fallback, official-binary fallback, GPL-3.0 project code and Apache-2.0 upstream notices.

- [ ] **Step 5: 运行 workflow 静态测试并提交**

```powershell
node --test test/release/workflow.test.mjs
npm test
npm run check:public
git diff --check
git add .github/workflows/release-windows.yml test/release/workflow.test.mjs
git commit -m "ci: 添加 Windows 预发布流水线"
```

Expected: workflow dependency and permission tests pass before any tag is created.

---

### Task 7: 完成文档、全分支审查和发布前验证

**Files:**
- Create: `docs/release/windows-mvp.md`
- Modify: `README.md`
- Verify: all files from Plans 1-3.

**Interfaces:**
- Consumes: complete integrated branch and successful CI runs.
- Produces: reviewed MVP candidate ready for the explicit release tag.

- [ ] **Step 1: 写发布操作文档**

Document:

- exact supported official/Ultra/platform versions;
- quick PowerShell 7 install command pinned to `v0.144.1-ultra.1`;
- `codex-ultra doctor`, `locale set`, `update`, `rollback`, and `uninstall` commands;
- installed canonical package and external language-pack locations;
- no-network launch and fallback decision table;
- unsigned prerelease warning and asset SHA-256 verification;
- GPL-3.0 project license, Apache-2.0 upstream license/NOTICE and corresponding-source link;
- how maintainers add a future upstream adapter without claiming untested compatibility.

README remains early-stage and does not claim official OpenAI affiliation or marketplace acceptance.

- [ ] **Step 2: 运行完整本地可行验证**

```powershell
$env:CODEX_UPSTREAM_SOURCE = (Resolve-Path $env:CODEX_UPSTREAM_SOURCE).Path
npm ci
npm run build
npm test
npm run check:public
node src/cli.mjs catalog extract --source $env:CODEX_UPSTREAM_SOURCE
git diff --exit-code -- research/codex-0.144.1/tui-messages.jsonl docs/i18n/codex-0.144.1-text-inventory.md
node src/cli.mjs language validate --pack packages/languages/zh-CN --catalog research/codex-0.144.1/tui-messages.jsonl
git diff --check
```

Do not claim the expensive real package build passed unless the current GitHub Actions run supplies fresh successful evidence.

- [ ] **Step 3: 审阅许可证、资产和回退边界**

Required conclusions:

- no complete upstream working tree is committed to the project repository;
- final binary asset preserves the canonical package layout;
- all manifest records match final bytes;
- corresponding source reconstructs the exact adapter diff;
- launcher bundle has no network/update code;
- language failure yields compiled English and Ultra failure/version mismatch yields the official absolute binary;
- uninstall affects only marker-owned Ultra paths and its exact PATH entry.

- [ ] **Step 4: 请求最终 whole-branch code review**

Use `requesting-code-review` with the diff from the plans base commit to integrated HEAD. Fix every Critical and Important finding in one coordinated fix wave, rerun covering tests, and request re-review. Minor findings are either fixed or recorded in `docs/release/windows-mvp.md` with rationale.

- [ ] **Step 5: 提交发布文档**

```powershell
git add docs/release/windows-mvp.md README.md
git commit -m "docs: 完成 Windows i18n MVP 发布说明"
```

The release tag is created only after required GitHub checks are green and the integrated commit is pushed.
