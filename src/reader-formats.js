// Preview source/configuration as escaped UTF-8 text, never as executable HTML.
const TEXT_EXTENSIONS = new Set(('.md .markdown .txt .json .jsonc .jsonl .ndjson .yaml .yml .toml .ini .cfg .conf .xml .html .htm .svg .css .scss .less .js .jsx .mjs .cjs .ts .tsx .py .pyw .ps1 .psm1 .sh .bat .cmd .sql .diff .patch .log .csvlog .rst .tex .c .h .cpp .hpp .cs .java .go .rs .rb .php .swift .kt .vue .svelte .gd .gitattributes .gitignore .editorconfig .env').split(' '));
const TEXT_NAMES = new Set(['dockerfile', 'makefile', 'license', 'readme', '.npmrc', '.nvmrc']);
export function isReaderText(file) {
  const name = String(file ?? '').replaceAll('\\', '/').split('/').at(-1).toLowerCase();
  return TEXT_NAMES.has(name) || name.startsWith('.env.') || TEXT_EXTENSIONS.has(name.slice(name.lastIndexOf('.')));
}
export function isReaderFile(file) {
  return isReaderText(file) || /\.(?:pdf|docx|csv|tsv|xlsx|png|jpe?g|webp|gif)$/iu.test(String(file ?? ''));
}
