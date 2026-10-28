# Contributing to Keeproot

Reproducible bug fixes, performance improvements and clearer documentation are welcome. Discuss larger changes in an issue before implementing them.

## Development

Use Node.js 24+. The Node Runtime needs no npm runtime packages. Branch from `main`, keep each pull request focused and preserve other contributors' attribution.

Run the directly affected test, then the selected core checks:

```powershell
node --test test/resource-reader.test.js
npm run test:core
```

| Command | Scope |
|---|---|
| `npm run test:core` | Core CLI, Save, recovery, reader and startup checks; Node only |
| `npm run test:install` | Isolated installation and update; Node only |
| `npm run test:content` | DOCX, table processing and Host/UI readback; requires Python dependencies |
| `npm test` | Full Node suite; requires content and some Desktop components |

Core CI runs on Windows for `main`, `codex/**` and pull requests. Installation and content checks can be dispatched separately.

For content tests, create an environment inside the checkout:

```powershell
python -m venv python/.venv
$python = (Resolve-Path python/.venv/Scripts/python.exe).Path
& $python -m pip install ./python
$env:ATLAS_CONTENT_PYTHON = $python
$env:ATLAS_DESKTOP_PYTHON = $python
$env:ATLAS_TEST_PYTHON = $python
npm run test:content
```

Use fictional files and isolated state in `test/.tmp/`. Never test against a user's installed state or document collection. Keep generated state, snapshots, logs and test output out of commits.

## Known limits

The full suite has unresolved failures. A passing selected check applies only to that scope. Native sustained performance, installation on another machine, automatic Hook triggering and continuation between different AI products need further verification.

Preserve the initial error, diagnose its cause and verify the affected workflow. Do not weaken assertions to make them pass. Stop after three failed repair/retest cycles or three disproven hypotheses on the same issue; report what remains. Do not rerun the full suite after every small patch.

## Pull requests

Describe the problem, changed behavior and checks run. For file writes or recovery, cover path boundaries, stale versions, repeated requests and later external changes. Include a screenshot for UI changes, using fictional or redacted material.

## Publishing and privacy

Publish from a sanitized checkout. Never merge private development history into this repository. Review the changed files and check both the working tree and committed history:

```powershell
python scripts/check-public-source.py --worktree
python scripts/check-public-source.py
```

Enable the local pre-push check with `git config --local core.hooksPath .githooks`. It uses Python from PATH or `ATLAS_PUBLIC_CHECK_PYTHON`. Pattern checks cannot replace reviewing the actual files. Do not publish credentials, personal paths, private materials, chat exports or state databases.

## License

Original code and documentation use [MIT](LICENSE). Preserve copyright and third-party notices under `src/vendor/` and `assets/`. Artwork and logos retain their own terms. Only add material you have permission to redistribute.
