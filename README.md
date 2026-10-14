# Keeproot

**A local workspace for materials, repeatable work and AI collaboration.**

Keeproot keeps files in their existing project folders. People and AI hosts use the same resource identities, work revisions, saved results and recovery state. The host understands content and proposes changes; Keeproot checks local facts and executes supported operations.

Current version: **2.0.0-preview.1**. This is preview source, not a stable release. Atlas remains the technical name used by the CLI, protocol and installation directories.

The October 13 candidate adds CLI registration for an explicitly authorized existing directory, without a native picker or manual IDs. An isolated installed workflow completed registration, reading, Save, UI readback of the same Resource and reopening; Markdown editing, confirmation and Undo were also exercised. All 41 previously retained checks passed a focused independent run. The milestone evidence is segmented: the initial full run reached its time budget, five diagnosed failures passed targeted repairs, and the previously unstarted tail passed. This is not a claim of one green full-suite run or a stable release.

The October 14 checkpoint changes ordinary browsing to current-folder loading and recorded metadata, defers relationship/source details, and pages large UTF-8 Markdown/text at about 64 KiB. Manual editing retains its 256 KiB limit. Gemini public-share text capture uses a bounded public RPC and Python parser. An installed isolated Toolbox workflow completed preview, Save verification and same-Resource reading. Native sustained performance and real-user acceptance remain open.

The full source baseline for this checkpoint finished with **1,081 passed, 39 failed and 1 skipped**. Failures include outdated assertions, a missing PDF dependency, temporary-directory cleanup and unresolved UI/state checks. In particular, the relationship canvas can label an unchecked source chain as Fresh; that label does not prove current file verification. This checkpoint is not a green release candidate.

## Windows: first installation and updates

The Windows installation entries are implemented in this source tree. A public Windows Release asset still needs to be published; GitHub's automatically generated **Source code** ZIP is not the installation package.

第一次安装：

1. 准备 [Node.js 24+](https://nodejs.org/en/download) 和 [Python 3.11+](https://www.python.org/downloads/windows/)；Python 安装时勾选“Add Python to PATH”。已有符合要求的版本可以直接使用。
2. 在 [Keeproot Releases](https://github.com/Pachin1919/keeproot/releases) 下载 `keeproot-windows-…zip`，完整解压。
3. 双击 `Install-Keeproot.cmd`。它检测解释器、检查包内文件、安装 Runtime 和主 Skill，并安装 Desktop 处理组件。首次组件安装需要联网下载 Python 依赖。
4. 安装成功后打开 Keeproot；以后从 Windows 开始菜单打开。Codex 的 Skill 入口是 `$keeproot`。

更新：先关闭 Keeproot，下载并解压新的 Windows Release 包，双击其中的 `Update-Keeproot.cmd`。它更新原安装，沿用原来的 Skill 位置，保留项目登记、设置、保存记录及恢复状态。不要删除旧安装目录或复制覆盖 state。更新失败会显示失败步骤和原因；不要把失败当作已经更新。

默认安装目录为 `%LOCALAPPDATA%\Atlas`，这是兼容旧安装的技术路径；程序显示名为 Keeproot。缺少解释器时安装会停止并给出官方下载地址；当前包不包含 Node/Python，不是零前置安装。跨机器首次使用和原生窗口仍需要实际验收。

For a source checkout, use the existing installer below. Development builds can stage a filtered Windows bundle with `node scripts/release-bundle.js --output <local-output-directory>`; the bundle excludes development diaries, state, caches and test evidence. A staged bundle is not a published Release.

## Codex entry

The installed Skill is `$keeproot`: it locates and calls the local `atlas` CLI, rather than searching for an MCP tool named `keeproot`. Existing `atlas-file-governance` references remain compatible. Project `AGENTS.md` instructions do not install Hooks; optional events require a reviewed binding and configuration. Skill discovery and an isolated PostToolUse configuration were read back from Codex. Actual model-triggered Hook operation remains unverified.

## What you can try

- Preview and register an explicitly authorized existing Project directory through `project register prepare/show/execute/recover`; preserve files in place and reuse returned identities.
- Browse and read Markdown, text, images, PDF, DOCX and CSV/XLSX in the workspace.
- Open Toolbox in the left navigation, select CSV/XLSX materials, and enter a Python table recipe: align, combine, filter, convert types, deduplicate and sort; preview and save the full result.
- In Toolbox → Content conversion, turn a static public page or supported ChatGPT/Gemini share into a real `.md` file: choose an existing folder, preview, explicitly Save, then read. Source JSON and conversation export capture remain separate options.
- Edit Markdown or text alongside reading: preview changes, explicitly save to the same Resource, or Undo the edit. Editing does not launch an AI session.
- Use the fixed document-and-monitors layout, or switch to four panels while retaining the same editor and relationship canvas. Optional motion follows both system and app reduced-motion preferences.
- In Stages and recovery, inspect a local project's supported Git history, changed files and side-by-side diff. This view is read-only and does not provide Git rollback.
- Calculate grouped sums, two-axis pivot totals/shares/ranks, and monthly totals with period growth. [Processing implementation and limits](<docs/Atlas 技术作品与企业评审说明.md#python-processing>).
- Reuse a work configuration with explicitly selected new sources; review source changes.
- Read confirmed rules as condition → destination diagrams; expand the full explanation and evidence when needed. Pending summaries open their complete proposal before showing rule conditions.
- Follow recorded source/result relationships, compose a Board and export supported content.
- Capture supported public pages or selected conversation exports; review local updates.
- Prepare bounded handoff context and restore supported, explicitly protected work scopes.

## First trial: no personal documents or AI account needed

Use Windows, **Node.js 24+** and a trusted **Python 3.11+** installation. Download this repository or clone it, open PowerShell in that folder, and run:

```powershell
.\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install') -Install -PythonPath 'C:\Path\To\python.exe'
```

Replace the Python example with your own interpreter path. Use an unused installation directory outside your real projects. First installation downloads the required Python packages and creates an isolated environment. It does not install a user AI Hook or connect an AI account.

The script prints a local page address. Open it and follow the [five-step trial guide](<docs/Atlas V1 验收指南.md>). The prepared sample contains two fictional CSV inputs. Saving a new result preserves those inputs and earlier results. Reopen the same sample with:

```powershell
.\start-preview.ps1 -InstallRoot (Join-Path $PWD 'preview-install')
```

Ctrl+C stops this page server and preserves the sample. This entry opens an HTML work surface; it does not automatically launch the native window.

## Limits and privacy

Windows installation and representative HTML workflows have been exercised. Native display scaling, different-product AI continuation, first use on other computers and real-project acceptance still need validation. Two optional Host experiments are included but disabled by default; their real account/Hook flows are unverified. There is no cloud synchronization or general AI engine.

State and snapshots stay local. Explicit URL capture contacts the selected site; package installation uses the configured package source. External AI hosts have their own data handling. Trusted local Modules run with the process account's permissions and are not a sandbox. See [usage, networking and component notices](<docs/Atlas V1 使用说明书.md>).

## Development and history

Node.js uses ESM, built-in SQLite and `node:test`; Python handles local document and table processing. No npm runtime installation is needed for the Node code. For tests, select the Python environment containing the pinned content dependencies:

```powershell
$env:ATLAS_CONTENT_PYTHON = 'C:\Path\To\python.exe'
$env:ATLAS_TEST_PYTHON = $env:ATLAS_CONTENT_PYTHON
npm test
```

The retained Git history starts on **2026-07-20**. Internal development documents and machine-specific records were removed from every published revision. Original commit dates and branch relationships are retained; hashes changed during this cleanup. Obsolete preview tags were removed. Older branches represent earlier implementations, not the current supported preview.

This repository is public source. A project-wide open-source license has not been selected; bundled third-party code retains its own licenses. Public source visibility does not grant a new license for original code or artwork. Keeproot name rights have not been cleared.

### Publishing changes

Known limitations: native windows, second-product Host continuation, nondeveloper first use and real-project validation remain pending. Single-Resource rename/move has no complete supported service chain. The source candidate passed named isolated workflows and repaired retained checks; these do not replace those remaining acceptance gates.

Use a sanitized checkout for public updates. Do not merge private development history into this repository. Before committing, run `python scripts/check-public-source.py --worktree`; before pushing, run it without that flag. Enable the included local check with `git config --local core.hooksPath .githooks`. The hook uses Python from PATH or `ATLAS_PUBLIC_CHECK_PYTHON`. CI also checks all reachable history. The checks help detect excluded paths and common sensitive patterns; review public content before upload.

## UI implementation references

The visual refinement branch borrows layout mechanisms from [Superset's fixed dashboard grid](https://github.com/apache/superset/blob/42bbfa49079eff910ead01b7880b94d09c5ca520/superset-frontend/src/dashboard/components/DashboardBuilder/DashboardBuilder.tsx), [Evidence's surface and density tokens](https://github.com/evidence-dev/evidence/blob/14e6caed59ffbb01ea4aa1a0f66a7e29d0e964d1/core/src/theme/theme-css-helper.ts), and [Rill's compact controls](https://github.com/rilldata/rill/blob/aa3660068b8a10e59495e35790b6de0bdcdba4e7/web-common/src/components/button/Button.svelte). These are design references; their frameworks, dependencies and code were not copied into this refinement.

## Feedback

Use [GitHub Issues](https://github.com/Pachin1919/keeproot/issues). Include version/build, Windows display scale, steps, expected behavior and a redacted screenshot. Do not upload private files, credentials, chat archives or whole state databases.

[Product overview](<docs/Atlas V1 产品说明书.md>) · [Usage](<docs/Atlas V1 使用说明书.md>) · [Architecture and evidence limits](<docs/Atlas 技术作品与企业评审说明.md>)
