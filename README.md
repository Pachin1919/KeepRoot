# Keeproot

**A local file-work layer for people and AI hosts.**

Keep files in their existing project folders. Keeproot gives a host and a user the same material identities, work revisions, saved results and recovery state. The host interprets content and proposes actions; Keeproot measures local facts and executes supported operations.

**2.0.0-preview.1 · Windows preview · [MIT](LICENSE)**

## Install on Windows

1. Install [Node.js 24+](https://nodejs.org/en/download) and [Python 3.11+](https://www.python.org/downloads/windows/). Enable Python on PATH, then reopen PowerShell.
2. [Download the main-branch source ZIP](https://github.com/Pachin1919/KeepRoot/archive/refs/heads/main.zip) and extract it completely. Open PowerShell in the extracted folder containing `install-atlas.ps1`.
3. Install the Runtime, Keeproot Skill and Python Desktop/content components:

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command install -DesktopPythonPath $python
```

Use an actual Python interpreter; if `python.exe` points to a Windows Store placeholder, set `$python` to the full path of your installed interpreter. The first Python dependency installation needs internet access. No `npm install` is required.

Open **Keeproot** from the Start menu, or run the installed launcher. Check the installation with `doctor`; its JSON response should report `ok: true` and `data.status: "ok"`:

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas-ui.cmd"
& "$env:LOCALAPPDATA\Atlas\atlas.cmd" doctor --json
```

To update, close Keeproot, download and extract the latest source ZIP, then run this from the new source folder:

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command upgrade -DesktopPythonPath $python
```

Updates retain existing state. Custom installations must also pass their original `-InstallRoot` and `-SkillRoot`.

**Source ZIP and Windows package are different:** `Install-Keeproot.cmd` and `Update-Keeproot.cmd` require a Windows package with `keeproot-release.json`. Use the commands above for GitHub source ZIPs. No standalone Windows installer asset is currently published in GitHub Releases. [完整中文安装与更新说明](<docs/Atlas V1 使用说明书.md#windows安装与更新>)

## The core works without the UI

```text
User authorizes a task and directory
  → Host discovers capabilities and resolves the Project
  → Keeproot returns bounded file facts and current versions
  → Host proposes content or a supported processing recipe
  → Keeproot prepares a version-bound operation
  → Authorized execution → byte verification → shared result identity
  → Reopen the same result; use recorded recovery when supported
```

| Mechanism | What the code does |
|---|---|
| Identity and boundaries | Register an explicitly authorized directory; resolve Project/Resource identities and refuse linked, ambiguous or out-of-root paths. |
| Read before reasoning | Return file type, size, current version and supported parser output. Read large UTF-8 text in bounded pages instead of loading the whole body. |
| Deterministic processing | Python applies an explicit table recipe: alignment, combination, filtering, type conversion, deduplication, grouping or pivoting. The host chooses the recipe; Keeproot does not infer its meaning. |
| Version-bound writes | Prepare records the intended target and input facts. Execution rechecks them, refuses conflicts and verifies the saved bytes. Stable request keys support replay without silently duplicating results. |
| Recovery and lineage | Record supported Source → Work → Result links. Protect a declared scope, preview restoration and refuse incompatible later changes. Unrecorded external edits and host conversations are not automatically captured. |

The Desktop UI is another consumer of these services, not the source of the workflow. Node.js owns local state, boundaries and I/O; Python handles content processing. This is an engineering method for repeatable local work, not a new language model or a claim of measured token savings.

[Implementation and algorithm walkthrough](<docs/Atlas 技术作品与企业评审说明.md#机器侧工作原理不依赖ui>) · [Host entry Skill](.agents/skills/keeproot/SKILL.md)

## Start from the machine interface

Requires Node.js **24+**. The CLI keeps the technical name `atlas`; an MCP tool named `keeproot` is not required.

```powershell
node bin/atlas.js capabilities --json
node bin/atlas.js --help
```

For an installed Runtime, use its `atlas.cmd` launcher. Inspect `capabilities.current_product.command_guide` for the current command/request contract. The [Project reference](.agents/skills/keeproot/references/current-project.md) covers first registration; the [Save reference](.agents/skills/keeproot/references/current-save.md) covers Prepare → Execute → Verify and Undo/Redo. Consume returned IDs and revisions rather than copying example IDs. Check both `ok` and the returned business status; stop on stale, conflict, deny or unsupported results.

These commands do not connect an AI account, automatically authorize a directory, or enable a Hook. Native Desktop and installed Skills are optional entry surfaces; see the [usage guide](<docs/Atlas V1 使用说明书.md>) for installation prerequisites and limits.

## What is available

- Project registration, in-place resource browsing, file facts and stored relationships.
- Bounded Markdown, JSON, source/config text, image, PDF, DOCX and table reading; supported Markdown/text editing with preview and confirmation.
- Repeatable CSV/XLSX Work, verified saves, recorded source changes, Boards and declared-scope recovery.
- Toolbox text capture for supported public pages and conversation exports. Media downloading is outside this capture workflow.
- English and Simplified Chinese UI, fixed reader monitors and read-only local Git history.

**Preview limits:** core regression is a selected contract suite, not complete product acceptance. Native sustained performance, real automatic Hook triggering, different-product Host continuation and first use on other computers remain unverified. Historical suite results and the bounded maintenance priorities are in [CONTRIBUTING.md](CONTRIBUTING.md#validation-status-and-maintenance-priorities). The full suite is not currently claimed to be all green.

## Develop and contribute

No npm runtime dependency installation is needed for the Node code.

```powershell
npm run test:core
npm run test:install
```

Python content processing additionally requires a trusted Python **3.11+** interpreter and the pinned dependencies in `python/pyproject.toml`. [Contribution instructions](CONTRIBUTING.md) cover setup, content tests, failure handling and publication privacy checks.

[Report a bug or workflow gap](https://github.com/Pachin1919/KeepRoot/issues/new/choose) · [Core regression](https://github.com/Pachin1919/KeepRoot/actions/workflows/regression.yml) · [Manual installation/content checks](https://github.com/Pachin1919/KeepRoot/actions/workflows/extended-regression.yml)

## License and privacy

Keeproot's original source code and accompanying documentation are licensed under the [MIT License](LICENSE), copyright (c) 2026 Pachin1919. Bundled third-party code and dependencies retain their own licenses and notices. Original artwork, logos and other non-code creative assets are not included in the MIT grant unless expressly stated. Keeproot name rights have not been cleared.

Project files, state and recovery snapshots stay local. Explicit URL capture contacts the selected website; Python installation uses its configured package source. Hosts have their own data handling. Trusted local Modules run with the process account's permissions and are not a sandbox. Keep private documents, credentials, chat archives and state databases out of issues and pull requests.

The public Git history starts on **2026-07-20**. Private development records were removed from published history; original commit dates and branch relationships were retained. See [architecture and evidence limits](<docs/Atlas 技术作品与企业评审说明.md>) and the [product overview](<docs/Atlas V1 产品说明书.md>).
