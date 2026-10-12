# Offline Reader editor

CodeMirror 6 supplies editing, Markdown highlighting and a read-only unified merge view. No CDN or installed native component is required. `reader-editor.js` is the fixed browser ESM bundle; the root Runtime has no new dependency.

Pinned direct versions: commands 6.11.1, lang-markdown 6.5.2, language 6.13.1, merge 6.12.1, state 6.7.6, view 6.43.14. The build uses esbuild 0.28.2. The lockfile pins transitive dependencies and package integrity. Included dependency licenses are in `THIRD-PARTY-NOTICES.txt`.

Merge reference: https://github.com/codemirror/merge commit `3bc269331394691dcce9784ba8c93b318d15535f` (6.12.1).

To reproduce, create a fresh directory under `test/.tmp/`, copy this directory's `package.json` and `package-lock.json` into it, then run these commands **from that temporary directory**:

```powershell
npm ci
node ../../../src/vendor/codemirror/build.mjs
```

The script resolves dependencies from the current temporary directory, writes only the vendored bundle and notices, and rejects a build outside `test/.tmp/`. Adjust the relative path when using deeper temporary directories. Do not run dependency installation in the repository root.

Current bundle: 537981 bytes; SHA-256 `899534ef91390df3c754e5efb449b1613b38c1cd33ea70f6c2fce76bbc75f7f7`.
