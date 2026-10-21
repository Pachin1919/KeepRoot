import assert from 'node:assert/strict';
import test from 'node:test';
import { renderResourceReaderView } from '../src/ui/views/resource-reader-view.js';
import { renderProjectResourceFolderGroup } from '../src/ui/views/project-resources-view.js';
import { readerLinkTokens } from '../src/resource-reader-service.js';
import {renderSearchView} from '../src/ui/views/search-view.js';
import fs from 'node:fs';

const base = '/projects/P-reader';
const returnHref = `${base}/resources?mode=table&view=VIEW-one&fulltext_terms=a%26b&folder=notes%2Fdeep`;
const model = (overrides = {}) => ({ project: { id: 'P-reader', name: 'Reader Project' }, returnHref,
  detailsHref: `${base}/resources/detail?path=notes%2Fsample.md`, resources: [{ resource_id: 'R-one', name: 'sample.md', relative_path: 'notes/sample.md' }],
  reader: { project_id: 'P-reader', resource_id: 'R-one', name: 'sample.md', relative_path: 'notes/sample.md', sha256: 'abc123', bytes: 20, kind: 'markdown', text: '# Title\n\nReadable body.' }, ...overrides });
const render = (value, locale = 'en') => renderResourceReaderView(value, { csrfToken: 'csrf-reader', locale });

test('Reader distinguishes missing files from unsupported binary previews and readable JSON', () => {
  const html = render(model({resources:[
    {resource_id:'missing',name:'gone.md',relative_path:'gone.md',status:'missing'},
    {resource_id:'binary',name:'bundle.zip',relative_path:'bundle.zip'},
    {resource_id:'json',name:'manifest.json',relative_path:'manifest.json'},
  ]}));
  assert.match(html, /<details class="reader-file-group reader-file-exceptions"><summary><span class="reader-folder-label">Unavailable files<\/span>[^]*?<span class="reader-file-link is-unavailable"[^>]*><strong>gone.md/u);
  assert.match(html, /<span class="reader-file-link is-unsupported"[^>]*><strong>bundle.zip/u);
  assert.match(html, /class="reader-file-link"[^>]*aria-label="manifest.json — manifest.json"/u);
  const source = render(model({reader:{...model().reader,name:'page.html',relative_path:'page.html',kind:'text',text:'<script>alert(1)</script>'}}));
  assert.match(source, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.doesNotMatch(source, /<script>alert\(1\)<\/script>/u);
});

test('Reader separates document commands and view controls while preserving live toggle names and targets', () => {
  const html = render(model(), 'zh-CN');
  const toolbar = html.match(/<header class="reader-toolbar">([^]*?)<\/header>/u)?.[1];
  assert.ok(toolbar);
  assert.match(toolbar, /class="reader-command-group reader-document-commands" role="group" aria-label="文档模式"/u);
  assert.match(toolbar, /class="reader-command-group reader-view-commands" role="group" aria-label="视图控制"/u);
  assert.match(toolbar, /class="reader-button reader-command-primary"[^>]*data-reader-inline-edit[^>]*data-reader-edit-label="编辑文字"[^>]*data-reader-read-label="渲染阅读"[^>]*aria-controls="reader-content">编辑文字<\/a>/u);
  for (const [control, target] of [['files', 'reader-files'], ['focus', 'reader-content'], ['source', 'reader-source']]) {
    assert.match(toolbar, new RegExp(`data-reader-${control}-toggle aria-controls="${target}"`, 'u'));
  }
  assert.match(toolbar, /class="reader-button reader-back-command"[^>]*>返回资源列表<\/a>/u);
  assert.match(toolbar, /<summary class="reader-button">更多<\/summary>/u);
  const modes = toolbar.match(/reader-document-commands[^>]*>([^]*?)<\/div>/u)[1];
  assert.doesNotMatch(modes, /data-reader-files-toggle|data-reader-source-toggle/u);
});

test('Reader folds bounded YAML properties, retains editor source, and serves Chinese collapsed-diff phrases',()=>{
 const text='---\r\ntitle: 月度观察\r\ntype: fictional-demo\r\n---\r\n\r\n# 正文\r\n北区。\r\n';
 const html=render(model({reader:{...model().reader,text}}),'zh-CN');
 assert.match(html,/<details class="reader-source-metadata"><summary>属性<\/summary><pre>title: 月度观察/u);
 assert.match(html,/<h1 id="reader-heading-正文">正文<\/h1>/u);assert.doesNotMatch(html,/<h2[^>]*>title:/u);
 const editing=render(model({manual:{text,requestKey:'properties',readHref:base+'/resources/read?resource_id=R-one'}}));assert.ok(editing.includes(text));
 const bundle=fs.readFileSync(new URL('../src/vendor/codemirror/reader-editor.js',import.meta.url),'utf8').replace(/\\u([0-9a-f]{4})/giu,(_,hex)=>String.fromCharCode(Number.parseInt(hex,16)));assert.ok(bundle.includes('$ 行未修改'));
});

test('body search describes body keywords and Reader labels its exact search return',()=>{
 const html=renderSearchView({project:{id:'P',name:'Project'},scope:'body',query:'北区',items:[]},{locale:'zh-CN'});
 const main=html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/u)?.[1];assert.ok(main);
 assert.match(main,/<label for="search-page-query">正文关键词<\/label>/u);assert.match(main,/搜索已注册材料的正文索引/u);assert.doesNotMatch(main,/不读取文件内容/u);
 const globalSearch=html.match(/<dialog[^>]*id="atlas-search"[^>]*>([\s\S]*?)<\/dialog>/u)?.[1];assert.ok(globalSearch);assert.match(globalSearch,/<form class="search-form" method="get" action="\/search">/u);
 const reader=render(model({returnHref:base+'/search?q=北区&scope=body'}),'zh-CN');assert.match(reader,/>返回搜索<\/a>/u);
});

test('Reader edit and read-only change review load the offline editor and preserve exact draft source', () => {
  const text='\uFEFF---\r\ntitle: 原文\r\n---\r\n\r\n[[未知目标]]\r\n';
  const editing=render(model({manual:{text,requestKey:'preview',readHref:base+'/resources/read?resource_id=R-one',expectedSha256:'abc',expectedFileId:'file'}}));
  assert.match(editing,/<script type="module" src="\/ui\/reader-editor.js"><\/script>/u);
  assert.match(editing,/data-reader-editor data-reader-format="markdown"/u);
  assert.ok(editing.includes(text));assert.doesNotMatch(editing,/<section class="reader-edit-versions"/u);
  const preview=render(model({manual:{readHref:base+'/resources/read?resource_id=R-one',update:{update_id:'U',revision:1,status:'preview_ready',baseline:{text},current:{text,sha256:'abc'},proposed:{text:text+'新增\r\n',sha256:'new'}}}}));
  assert.match(preview,/data-reader-original data-reader-source=/u);assert.match(preview,/class="reader-diff-legend"/u);
  assert.doesNotMatch(preview,/<pre>\uFEFF/u);assert.match(preview,/resources\/edit\/confirm/u);
});

test('Reader groups same-named resources by folder without losing identity, return scope or escaped full names', () => {
  const html = render(model({ resources: [
    { resource_id: 'R-one', name: 'sample.md', relative_path: '01_资料/sample.md' },
    { resource_id: 'R-two', name: 'sample.md', relative_path: '02_成果/sample.md' },
    { resource_id: 'R-root', name: '<name>.txt', relative_path: '<name>.txt' },
  ] }), 'zh-CN');
  assert.match(html, /<details class="reader-file-group" open><summary title="01_资料"><span class="reader-folder-label">01_资料/u);
  assert.match(html, /<details class="reader-file-group" open><summary title="02_成果"><span class="reader-folder-label">02_成果/u);
  assert.match(html, /项目根目录/u);
  assert.match(html, /title="02_成果\/sample.md" aria-label="sample.md — 02_成果\/sample.md"/u);
  assert.match(html, /&lt;name&gt;\.txt/u);
  assert.doesNotMatch(html, /<name>/u);
  const urls = [...html.matchAll(/<a class="reader-file-link" href="([^"]+resources\/read\?[^"]+)" title=/gu)].map(match => new URL(match[1].replaceAll('&amp;', '&'), 'http://atlas.local'));
  assert.deepEqual(new Set(urls.map(url => url.searchParams.get('resource_id'))), new Set(['R-one', 'R-two', 'R-root']));
  assert.ok(urls.every(url => url.searchParams.get('return_to') === returnHref));
  assert.match(html, /aria-current="page"><strong>sample.md/u);
  assert.match(html, /<details class="reader-actions-menu"><summary class="reader-button">更多/u);
});

test('Escaped Markdown and wiki links remain text even beside the same resolved link', () => {
  const text = String.raw`\[Literal](a.md) \[[folder/a|Literal]] [Open](a.md) [[folder/a|Open]] \[Web](https://example.test)`;
  const tokens = readerLinkTokens(text);
  assert.deepEqual(tokens, [{ syntax: 'relative_markdown', raw: 'a.md' }, { syntax: 'wikilink', raw: 'folder/a|Open' }]);
  const html = render(model({ reader: { ...model().reader, text }, links: tokens.map(item => ({ ...item, status: 'resolved', href: '/projects/P-reader/resources/read?resource_id=R-target' })) }));
  assert.equal([...html.matchAll(/class="reader-material-link"/gu)].length, 2);
  assert.ok(html.includes(String.raw`\[Literal](a.md)`));
  assert.ok(html.includes(String.raw`\[[folder/a|Literal]]`));
  assert.doesNotMatch(html, /href="https:\/\/example.test/u);
});

test('Reader provides safe basic Markdown and leaves unsupported or executable markup visible as text', () => {
  const html = render(model({ reader: { ...model().reader, text: '# Heading\n\nParagraph with `code`.\n\n- Item one\n- Item two\n\n1. Ordered\n\n```html\n<script>alert(1)</script>\n```\n\n<img src=x onerror=alert(1)>\n\n[Good](https://example.test/article) [Bad](javascript:alert)\n\n![Remote](https://example.test/image.png)' } }));
  assert.match(html, /<h1 id="reader-heading-heading">Heading<\/h1>/u); assert.match(html, /<p>Paragraph with <code>code<\/code>\.<\/p>/u);
  assert.match(html, /<ul>\s*<li>Item one<\/li>\s*<li>Item two<\/li>\s*<\/ul>/u); assert.match(html, /<ol>\s*<li>Ordered<\/li>\s*<\/ol>/u);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.doesNotMatch(html, /<script>alert|<img src=x|href="javascript:|src="https:\/\/example/u);
  assert.match(html, /href="https:\/\/example.test\/article" target="_blank" rel="noopener noreferrer"/u);
  assert.match(html, /\[Bad\]\(javascript:alert\)/u); assert.match(html, /!\[Remote\]\(https:\/\/example.test\/image.png\)/u);
});

test('Reader preserves scoped return and navigation and exposes explicit external edit with closed technical facts', () => {
  const html = render(model());
  assert.ok(html.includes(`href="${returnHref.replaceAll('&', '&amp;')}"`));
  const nav = html.match(/href="([^"]+resources\/read\?[^"]+)"/u)?.[1]; assert.ok(nav);
  const url = new URL(nav.replaceAll('&amp;', '&'), 'http://atlas.local');
  assert.equal(url.searchParams.get('return_to'), returnHref); assert.equal(url.searchParams.get('resource_id'), 'R-one');
  assert.match(html, /aria-current="page"/u); assert.match(html, /data-reader-files-toggle aria-controls="reader-files" aria-expanded="true"/u);
  assert.match(html, /data-reader-focus-toggle aria-controls="reader-content" aria-expanded="false"/u);
  assert.match(html, /data-reader-source-toggle aria-controls="reader-source" aria-expanded="false"/u);
  assert.match(html, /<aside class="reader-source" id="reader-source" hidden>/u);
  assert.match(html, /<details class="reader-technical"><summary>/u);
  assert.match(html, /method="post" action="\/projects\/P-reader\/resources\/open"/u);
  assert.match(html, /name="csrf" value="csrf-reader"/u); assert.match(html, /name="path" value="notes\/sample.md"/u);
  assert.doesNotMatch(html, /<iframe/u);
  assert.match(render(model(), 'zh-CN'), /返回资源列表/u);
});

test('Reader handles plain text, long paths, unavailable files and unknown formats without unsafe fallthrough', () => {
  const path = `${'long-folder/'.repeat(25)}<name>.txt`;
  const text = render(model({ reader: { ...model().reader, kind: 'text', relative_path: path, text: '<svg onload=alert(1)>\nSecond line' } }));
  assert.match(text, /&lt;svg onload=alert\(1\)&gt;/u); assert.ok(text.includes(path.replaceAll('<', '&lt;').replaceAll('>', '&gt;')));
  assert.doesNotMatch(text, /<svg onload/u);
  const unsupported = render(model({ reader: { ...model().reader, kind: 'pdf', text: 'Must not render as content' } }));
  assert.match(unsupported, /Inline reading is unavailable for this format/u); assert.doesNotMatch(unsupported, /Must not render as content/u);
  const failure = render(model({ notice: 'Missing <file>', reader: { ...model().reader, text: 'Stale body should stay hidden' } }));
  assert.match(failure, /role="alert"/u); assert.match(failure, /Missing &lt;file&gt;/u);
  assert.doesNotMatch(failure, /Stale body should stay hidden|resources\/open"/u);
  const unsafeReturn = render(model({ returnHref: 'javascript:alert(1)', detailsHref: '//evil.test/x' }));
  assert.doesNotMatch(unsafeReturn, /href="javascript:|href="\/\/evil/u);
});

test('Images use only the verified local image route for this Resource and hash', () => {
  const reader = { ...model().reader, kind: 'image', text: undefined, image_url: `${base}/resources/read-image?resource_id=R-one&expected_sha256=abc123` };
  assert.match(render(model({ reader })), /<img src="\/projects\/P-reader\/resources\/read-image\?resource_id=R-one&amp;expected_sha256=abc123"/u);
  for (const image_url of ['https://evil.test/a.png', 'data:image/png;base64,AAAA', `${base}/resources/read-image?resource_id=R-other&expected_sha256=abc123`, `${base}/resources/read-image?resource_id=R-one&expected_sha256=old`]) {
    const html = render(model({ reader: { ...reader, image_url } }));
    assert.doesNotMatch(html, /<div class="reader-image">/u);
    assert.match(html, /Inline reading is unavailable/u);
  }
});

test('PDF reader exposes accessible local version-bound controls without embedding a plugin or executable content', () => {
  const sha = 'a'.repeat(64); const pdf_url = `${base}/resources/read-pdf?resource_id=R-one&expected_sha256=${sha}`;
  const reader = { ...model().reader, kind: 'pdf', sha256: sha, pdf_url, text: '<script>PDF body must not be HTML</script>' };
  const html = render(model({ reader }), 'zh-CN');
  assert.match(html, /<script type="module" src="\/ui\/pdf-reader.js"><\/script>/u);
  assert.match(html, /data-pdf-reader/u); assert.match(html, /data-pdf-url="\/projects\/P-reader\/resources\/read-pdf\?resource_id=R-one&amp;expected_sha256=a{64}"/u);
  assert.match(html, /for="reader-pdf-page"/u); assert.match(html, /id="reader-pdf-page" type="number" min="1" max="500"/u);
  assert.match(html, /for="reader-pdf-zoom"/u); assert.match(html, /上一页/u); assert.match(html, /下一页/u); assert.match(html, /正在载入 PDF/u);
  assert.match(html, /data-pdf-canvas hidden/u); assert.match(html, /PDF 版本已变化/u); assert.match(html, /密码保护的 PDF/u);
  assert.doesNotMatch(html, /<iframe|<embed|<object|PDF body must not be HTML|src="https:/u);
  for (const value of ['https://evil.test/doc.pdf', 'data:application/pdf;base64,AAAA', `${base}/resources/read-pdf?resource_id=R-other&expected_sha256=${sha}`, `${base}/resources/read-pdf?resource_id=R-one&expected_sha256=${'b'.repeat(64)}`]) {
    const unsafe = render(model({ reader: { ...reader, pdf_url: value } }));
    assert.doesNotMatch(unsafe, /data-pdf-reader|\/ui\/pdf-reader.js/u);
  }
  assert.doesNotMatch(render(model({ reader, notice: 'Changed <PDF>' })), /data-pdf-reader|\/ui\/pdf-reader.js/u);
});

test('Reader renders only resolved material links, stable headings and escaped stored relationship evidence', () => {
  const href = '/projects/P-other/resources/read?resource_id=R-target#reader-heading-中文标题';
  const html = render(model({ reader: { ...model().reader, text: '# 中文标题\n# 中文标题\n[Target](../other/a.md#中文标题) [[other/a#中文标题|别名]]\n`[[other/a#中文标题|别名]]`\n![Image](../other/a.md#中文标题)\n[No](missing.md)' },
    links: [{ raw: '../other/a.md#中文标题', syntax: 'relative_markdown', status: 'resolved', href }, { raw: 'other/a#中文标题|别名', syntax: 'wikilink', status: 'resolved', href }, { raw: 'missing.md', syntax: 'relative_markdown', status: 'unresolved' }],
    relationships: { nodes: [{ resource_id: 'R-target', name: '中文材料' }], edges: [{ adjacent_resource_id: 'R-target', direction: 'outgoing', type: 'linked_to', evidence: { note: '<script>unsafe</script>' } }] },
  }), 'zh-CN');
  assert.match(html, /id="reader-heading-中文标题"/u); assert.match(html, /id="reader-heading-中文标题-2"/u);
  assert.equal([...html.matchAll(/class="reader-material-link"/gu)].length, 2);
  assert.match(html, /\[No\]\(missing.md\)/u); assert.match(html, /<code>\[\[other\/a#中文标题\|别名\]\]<\/code>/u);
  assert.match(html, /已存关系/u); assert.match(html, /当前材料指向/u); assert.match(html, /中文材料/u);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/u); assert.doesNotMatch(html, /<script>unsafe/u);
});

test('Readable registered rows carry reader URLs with return scope while table batch selectors stay intact', () => {
  const files = [{ resource_id: 'R-md', relative_path: 'notes/sample.md', name: 'sample.md', type: 'MD' },
    { resource_id: 'R-csv', relative_path: 'notes/table.csv', name: 'table.csv', type: 'CSV' },
    { relative_path: 'notes/unregistered.txt', name: 'unregistered.txt', type: 'TXT' }];
  const html = renderProjectResourceFolderGroup({ base, project: { id: 'P-reader' }, reader_return_href: returnHref,
    selected_folder_path: '', tree: { folders: [], files }, work_selection: { resource_ids: ['R-csv'] } });
  const href = html.match(/data-reader-href="([^"]+)"/u)?.[1]; assert.ok(href);
  const url = new URL(href.replaceAll('&amp;', '&'), 'http://atlas.local');
  const restored = new URL(url.searchParams.get('return_to'), 'http://atlas.local');
  assert.equal(restored.searchParams.get('view'), 'VIEW-one'); assert.equal(restored.searchParams.get('fulltext_terms'), 'a&b');
  assert.equal(restored.searchParams.has('resource_id'), false);
  assert.equal(restored.searchParams.has('path'), false);
  assert.equal([...html.matchAll(/data-reader-href=/gu)].length, 2);
  assert.match(html, /resource_id=R-csv/u);
  assert.match(html, /data-work-source data-resource-id="R-csv"[^>]*checked/u);
  assert.match(html, /data-open-resource/u);
});

test('Registered PDF rows offer Read and preserve the list return scope', () => {
  const html = renderProjectResourceFolderGroup({ base, project: { id: 'P-reader' }, reader_return_href: returnHref,
    selected_folder_path: '', tree: { folders: [], files: [{ resource_id: 'R-pdf', relative_path: '报告.pdf', name: '报告.pdf', type: 'PDF' }, { relative_path: '未登记.pdf', name: '未登记.pdf', type: 'PDF' }] } });
  assert.equal([...html.matchAll(/data-reader-href=/gu)].length, 1);
  const href = html.match(/data-reader-href="([^"]+)"/u)?.[1]; assert.ok(href);
  const url = new URL(href.replaceAll('&amp;', '&'), 'http://atlas.local');
  assert.equal(url.searchParams.get('resource_id'), 'R-pdf');
  assert.equal(new URL(url.searchParams.get('return_to'), 'http://atlas.local').searchParams.get('view'), 'VIEW-one');
});
