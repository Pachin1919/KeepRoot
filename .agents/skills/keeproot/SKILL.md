---
name: keeproot
description: Use Keeproot via its local CLI for files, project registration, saving and recovery. Do not use for Keeproot source development, architecture, Git, docs or test diagnosis.
---

# Keeproot

Use the installed Runtime through the `atlas` CLI; it is not a tool named `keeproot` in the MCP tool list. Run its locator and returned launcher from the shell. Hosts interpret meaning; stay within the task's authorized scope.

## Start once

Run `scripts/locate-atlas.ps1` with a 15-second timeout. On `runtime_required`, stop and recommend `install-atlas.ps1 install`. Reuse the returned `launcher_path`.

Read `capabilities --json` once for unfamiliar work. Its `current_product.command_guide` supplies actual inputs, outputs, failures and examples; `atlas --json` supplies matching syntax. Use this installation's capabilities.

## Read only the matching reference

| Task | Reference |
|---|---|
| Authorized directory not registered | `references/current-project.md` |
| Inspect a Resource or compare files | `references/current-resource.md` |
| CSV/XLSX Work | `references/current-table-work.md` |
| Save, verify, undo or redo | `references/current-save.md` |
| Views, property suggestions, conversations or URL capture | `references/workflows.md` |
| JSON protocol or unresolved error | `references/cli-protocol.md` |

For Handoff, Modules, Project moves and document updates, use the command guide's discovery and exact mutation syntax. UI entry: `atlas ui [--path <EXPLICIT_PROJECT_PATH>]`.

For structured content, inspect local spreadsheet structure, PDF page kind or Office objects first; do not ask the model to count rows or rediscover measured facts.

## Execute and stop

- Use explicit `--json`, check `ok` and business status, preserve returned identities and caller fields.
- On `setup_required`, follow supported remediation. Use reviewed `project register` only when this Runtime exposes it and the user authorized that exact directory; otherwise report the missing capability or authority.
- Never fall back to internal foundation commands or simulate a native picker. Old database rows grant no authority.
- Use one review path and its bound action. Stop on deny, stale, conflict or unsupported work; never overwrite a conflict. Use recorded recovery when available.
- For recurring cross-Project work, reuse one reviewed Context Link rather than rereading unchanged bodies.
- URL capture uses Keeproot first. Failure reporting, authorized Host fallback and test-stop rules are in `references/workflows.md`.

## Report

Report the action, useful result, verification, recovery and one limit. Omit bodies, IDs, hashes and Ledger history unless diagnosing. Do not claim Token savings without comparable data.
