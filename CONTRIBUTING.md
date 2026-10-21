# Contributing to Keeproot

Small changes that complete a real user or Host task are welcome. The current feature scope is frozen at `2.0.0-preview.1`; prioritize reproducible defects, Host interoperability, performance and documentation over new architecture.

## Start here

1. Open an issue with a small fictional reproduction and the expected result. For a larger change, discuss the workflow before implementing it.
2. Branch from current `main`. Keep one purpose per pull request and preserve other contributors' attribution.
3. Use Node.js 24+. The Node Runtime has no npm runtime dependencies to install.
4. Run the smallest affected test first, then the selected core regression before submitting:

```powershell
node --test test/resource-reader.test.js
npm run test:core
```

Tests use `test/.tmp/` for fictional files and isolated state. Never point a test at an installed user's state or real document collection. Do not commit generated state, snapshots, logs or test output.

## Test commands and CI

| Command | Scope | Dependencies |
|---|---|---|
| `npm run test:core` | Project registration/CLI, Save, declared-scope recovery, text boundaries/paging, reader interaction, startup schema, impact metadata and demand-loaded Toolbox | Node 24+; no Python component required |
| `npm run test:install` | Isolated Runtime/Skill installation, integrity, upgrade failure and state preservation | Node 24+; no real installation is changed |
| `npm run test:content` | DOCX parsing, the table Work Module and Host/UI graph readback | Node 24+ and explicit Python with pinned content dependencies |
| `npm test` | The historical full Node suite, including wider UI and environment checks | Content dependencies; some paths also require Desktop components |

Core regression runs on Windows for pushes to `main`/`codex/**` and pull requests. Installation/content regression is a separate manually dispatched workflow. This Windows scope does not claim Linux/macOS support. Workflow timeouts end a stalled job; do not weaken an assertion to make it pass.

For Python content tests, create a local environment inside the checkout:

```powershell
python -m venv python/.venv
$python = (Resolve-Path python/.venv/Scripts/python.exe).Path
& $python -m pip install ./python
$env:ATLAS_CONTENT_PYTHON = $python
$env:ATLAS_DESKTOP_PYTHON = $python
$env:ATLAS_TEST_PYTHON = $python
npm run test:content
```

The interpreter variables are set for this shell. Selecting a Python binary is not enough: its required packages must be installed. A missing component is an environment failure, not evidence that the product workflow passed.

For a defect: preserve the initial error, diagnose one cause, add a focused regression and verify the affected workflow. After three failed repair/retest cycles or three disproven hypotheses on one scope, stop and report the remaining blocker and evidence. Existing paused scopes do not restart just because a new PR is opened. Do not rerun the entire suite after every small patch.

## Validation status and maintenance priorities

Historical baselines are dated evidence, not current CI results:

| Recorded checkpoint | Result and boundary |
|---|---|
| October 12 UI checkpoint | 1,031 passed, 44 failed, one skipped; three stale assertions were then repaired in focused checks. |
| October 13 onboarding checkpoint | The 41 previously retained checks passed a focused run. The milestone was checked in segments, not one green full-suite run. |
| October 14 full baseline | 1,081 passed, 39 failed, one skipped. Later patches have targeted evidence; that does not establish the current status of every historical failure. |
| October 15 reader/startup changes | Named boundary, paging, editor, startup and navigation checks plus installed HTML workflows were exercised. Native long-running acceptance was not established. |

Current Actions runs report their selected scope only. Keep unresolved historical failures visible until a named reproduction establishes whether each is a regression, stale assertion, or environment problem. Do not advertise the full product as validated because core CI passes.

Useful bounded contributions:

- Reproduce one remaining historical failure using fictional input and classify its root cause.
- Diagnose native-window sustained latency separately from HTTP time and short browser samples.
- Complete ordinary first contact from another Host, with the same saved result read back after reopening.
- Verify first installation/update on a clean Windows environment and state preservation.
- Clarify machine-facing examples and return-context behavior. Keep UI showcases secondary to callable behavior.

The recorded table numeric-refusal timeout remains paused; it is not part of the selected CI commands. Reopen it only with new cause evidence and a bounded verification plan. Real automatic Hook triggering, native sustained performance, second-product Host continuation and nondeveloper first use remain open acceptance gaps.

## Pull request review

Include the user/Host task, exact changed behavior, checks run and checks not run. For writes/recovery, prove the path boundary, stale-version refusal, idempotency and protection of later changes. For UI changes, include a screenshot using fictional or redacted material. Passing mocks, source tests, installed CLI, rendered UI and native/real-user acceptance are different evidence categories.

## Publishing and privacy

Public updates must come from a sanitized checkout. Never merge private development history into the public repository. Before committing and pushing:

```powershell
python scripts/check-public-source.py --worktree
python scripts/check-public-source.py
```

The local pre-push hook can be enabled with `git config --local core.hooksPath .githooks`; it uses Python from PATH or `ATLAS_PUBLIC_CHECK_PYTHON`. The privacy workflow checks reachable history. These pattern checks are not a guarantee that a file contains no private information: review the actual changed files. Do not upload local paths, real project names, credentials, document bodies, chat exports or state databases as evidence.

## Licensing

Original source and accompanying documentation use [MIT](LICENSE). Preserve the existing copyright and third-party notices, including notices under `src/vendor/` and `assets/`. Artwork, logos and other non-code creative assets are outside the MIT grant unless explicitly stated. Do not add code or assets whose redistribution rights are unclear.
