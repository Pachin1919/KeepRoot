import {EditorState,Text} from '@codemirror/state';
import {EditorView, keymap, lineNumbers, highlightActiveLine, drawSelection} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {markdown} from '@codemirror/lang-markdown';
import {syntaxHighlighting, defaultHighlightStyle} from '@codemirror/language';
import {unifiedMergeView} from '@codemirror/merge';

const editors = new WeakMap();
export function destroy(root) {
  for (const host of root.querySelectorAll('[data-reader-editor]')) {
    editors.get(host)?.destroy(); editors.delete(host);
  }
}
export function focus(root) {
  const host = root.querySelector('[data-reader-editor]');
  editors.get(host)?.focus();
}
export function text(root) {
  const host=root.querySelector('[data-reader-editor]');
  const view=editors.get(host);
  return view?.state.sliceDoc();
}
export function mount(root) {
  for (const host of root.querySelectorAll('[data-reader-editor]')) {
    if (editors.has(host)) continue;
    const input = host.parentElement.querySelector('textarea[name="text"]');
    if (!input) continue;
    const originalInput=host.parentElement.querySelector('[data-reader-original]');
    const original = originalInput ? JSON.parse(originalInput.dataset.readerSource) : undefined;
    const source = input.dataset.readerSource ? JSON.parse(input.dataset.readerSource) : input.value;
    const review = original !== undefined;
    // An explicit separator preserves CRLF, BOM and terminal newline. Mixed
    // endings use LF separation with each existing CR retained in the document.
    const separator = /\r\n/u.test(source) && !/(?<!\r)\n/u.test(source) ? '\r\n' : '\n';
    const extensions = [EditorState.lineSeparator.of(separator), lineNumbers(), drawSelection(),
      EditorState.phrases.of(document.documentElement.lang.startsWith('zh') ? {'$ unchanged lines':'$ 行未修改'} : {}),
      syntaxHighlighting(defaultHighlightStyle), EditorView.lineWrapping,
      EditorView.contentAttributes.of({'aria-label': input.getAttribute('aria-label') || 'Text editor'}),
      EditorView.theme({ '&': {fontSize:'inherit'}, '.cm-content': {fontFamily:'var(--font-sans)',padding:'18px 0',lineHeight:'1.8'},
        '.cm-scroller': {fontFamily:'var(--font-sans)',overflow:'auto'}, '.cm-gutters': {backgroundColor:'var(--canvas)',color:'var(--muted)',border:'none'},
        '&.cm-focused': {outline:'2px solid var(--accent)',outlineOffset:'2px'} })];
    if (host.dataset.readerFormat === 'markdown') extensions.push(markdown());
    if (review) extensions.push(EditorState.readOnly.of(true), EditorView.editable.of(false), unifiedMergeView({
      original:Text.of(original.split(separator)), mergeControls:false, highlightChanges:true, allowInlineDiffs:true,
      collapseUnchanged:{margin:3,minSize:6}, syntaxHighlightDeletions:false,
    }));
    else extensions.push(history(), highlightActiveLine(), keymap.of([...defaultKeymap,...historyKeymap,indentWithTab]),
      EditorView.updateListener.of(update => {
        if (!update.docChanged) return;
        input.value = update.state.sliceDoc();
        input.dataset.readerSource = JSON.stringify(update.state.sliceDoc());
        input.dispatchEvent(new Event('input',{bubbles:true}));
      }));
    const view = new EditorView({state:EditorState.create({doc:source,extensions}),parent:host});
    editors.set(host,view); input.hidden=true; host.hidden=false;
  }
}
