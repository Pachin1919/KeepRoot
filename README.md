# Keeproot

Keeproot helps you and your AI assistant work with local files. Browse documents, process spreadsheets and keep results linked to their sources. Your files stay in their existing project folders.

**Windows preview · 2.0.0-preview.1 · [MIT](LICENSE)**

## What you can do

- Browse and read Markdown, text, images, PDF, Word documents and spreadsheets.
- Edit Markdown and text, or combine, clean and summarise CSV/XLSX data.
- Keep notes, materials and saved results together on a Board.
- Create restore points for the files you plan to change.
- Let an AI assistant use the same projects through the command line.

## Install on Windows

1. Install [Node.js 24+](https://nodejs.org/en/download) and [Python 3.11+](https://www.python.org/downloads/windows/). Add Python to PATH and reopen PowerShell.
2. [Download the source ZIP](https://github.com/Pachin1919/KeepRoot/archive/refs/heads/main.zip), extract it, and open PowerShell in the folder containing `install-atlas.ps1`.
3. Run:

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command install -DesktopPythonPath $python
```

If `python.exe` opens the Windows Store, set `$python` to your installed Python executable's full path. The first installation downloads Python packages; no `npm install` is needed.

Open **Keeproot** from the Start menu, or run:

```powershell
& "$env:LOCALAPPDATA\Atlas\atlas-ui.cmd"
```

The installation folder and CLI still use the old name `Atlas`. GitHub source ZIPs use the PowerShell command above; the two `.cmd` installers require a separate Windows release package, which is not yet published.

## Update

Close Keeproot, download and extract the new source, then run from that folder:

```powershell
$python = (Get-Command python.exe -ErrorAction Stop).Source
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\install-atlas.ps1 -Command upgrade -DesktopPythonPath $python
```

Updates keep your saved state. If you chose custom installation or Skill folders, pass the same `-InstallRoot` and `-SkillRoot` when updating.

## Help

- [中文使用说明](<docs/Atlas V1 使用说明书.md>) — installation, everyday use and recovery.
- [AI assistant setup](.agents/skills/keeproot/SKILL.md) — Codex uses the installed `keeproot` Skill; other clients can use the `atlas` CLI.
- [Report a problem](https://github.com/Pachin1919/KeepRoot/issues/new/choose) · [Development and known limits](CONTRIBUTING.md). This is a preview, and the full test suite still has unresolved failures.

Project files and history stay local. Web capture connects to the website you choose; AI apps have their own data policies.

The [MIT license](LICENSE) covers original code and documentation. Artwork and third-party components are outside that grant and retain their own terms.
