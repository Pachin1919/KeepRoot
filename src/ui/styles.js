import fs from 'node:fs';

const files = [
  new URL('./styles/tokens.css', import.meta.url),
  new URL('./styles/layout.css', import.meta.url),
  new URL('./styles/components.css', import.meta.url),
  new URL('./styles/round-timeline.css', import.meta.url),
  new URL('./styles/workspace.css', import.meta.url),
  new URL('./styles/board.css', import.meta.url),
  new URL('./styles/rules.css', import.meta.url),
  new URL('./styles/dashboard.css', import.meta.url),
  new URL('./styles/reader-monitors.css', import.meta.url),
  new URL('./styles/motion.css', import.meta.url),
];

let bundledStyles;
export function uiStyles() {
  // Runtime assets are fixed for this server process; preferences live in HTML.
  return bundledStyles ??= files.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
}
