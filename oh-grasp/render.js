'use strict';
const fs = require('fs');
const path = require('path');

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const VIEWER_SRC = fs.readFileSync(path.join(__dirname, 'viewer.js'), 'utf8');

const CSS = `
  :root { --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --text:#1a202c; --muted:#5b6472; --faint:#9aa3b2; --border:#e5e7eb; --border-strong:#cbd5e1;
    --accent:#6366f1; --accent-deep:#4338ca; --chip-bg:#f1f5f9; --chip-border:#e2e8f0; --canvas:#f8fafc; }
  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body { font-family: var(--sans); background: #ffffff; color: var(--text); padding-bottom: 90px; }

  .switcher {
    position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%);
    display: flex; align-items: center; gap: 14px;
    background: #10151c; color: #e6edf3; border: 1px solid #2a3548;
    padding: 8px 12px; border-radius: 999px; box-shadow: 0 8px 30px rgba(0,0,0,.25);
    z-index: 999; font-size: 13px;
  }
  .switcher button { width: 30px; height: 30px; border-radius: 50%; border: 1px solid #2a3548; background: #1a2230; color: #e6edf3; cursor: pointer; font-size: 15px; line-height: 1; }
  .switcher button:hover { background: #24304a; }
  .switcher .sw-tag { font-size: 10px; letter-spacing: .08em; color: #8b98a9; text-transform: uppercase; }

  /* ===== A · Flow ===== */
  .vA { max-width: 1060px; margin: 0 auto; padding: 40px 28px; }
  .vA-head { margin-bottom: 24px; }
  .vA-headrow { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
  .vA-headmain { min-width: 0; }
  .vA-title { font-family: var(--mono); font-size: 26px; font-weight: 700; margin: 0 0 6px; }
  .vA-sub { font-size: 15px; color: var(--muted); margin: 0 0 18px; }
  .vA-lang { display: flex; gap: 2px; flex: none; background: var(--canvas); border: 1px solid var(--border); border-radius: 999px; padding: 3px; }
  .vA-lang-btn { border: none; background: none; font: inherit; font-size: 12px; line-height: 1; padding: 6px 11px; border-radius: 999px; cursor: pointer; color: var(--muted); }
  .vA-lang-btn:hover { color: var(--text); }
  .vA-lang-btn.sel { background: var(--accent); color: #fff; }
  .vA-io { display: flex; flex-wrap: wrap; gap: 10px; }
  .vA-io .group { display: flex; align-items: center; gap: 8px; }
  .vA-io .cap { font-size: 12px; color: var(--faint); letter-spacing: .04em; }
  .vA-io .chip { font-family: var(--mono); font-size: 12px; background: var(--chip-bg); border: 1px solid var(--chip-border); color: var(--text); padding: 4px 10px; border-radius: 999px; }
  .vA-body { display: grid; grid-template-columns: 220px 1fr; gap: 32px; align-items: start; }
  .vA-sec { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin: 0 0 14px; }
  .vA-extcard { background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; }
  .vA-extname { font-family: var(--mono); font-size: 15px; font-weight: 600; color: var(--text); }
  .vA-extdesc { font-size: 12px; color: var(--muted); margin: 4px 0 8px; }
  .vA-extuse { font-size: 12px; color: var(--accent-deep); font-family: var(--mono); }
  .vA-hint { font-size: 12px; color: var(--faint); margin-bottom: 10px; }
  .vA-flow { background: var(--canvas); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; position: relative; height: 580px; cursor: grab; user-select: none; }
  .vA-flow.dragging { cursor: grabbing; }
  .vA-zoom { position: absolute; left: 0; top: 0; transform-origin: 0 0; will-change: transform; }
  .vA-src { font-family: var(--mono); font-size: 12px; line-height: 1.5; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0 0 16px; white-space: pre; }
  .vA-zoom-badge { position: absolute; top: 10px; right: 12px; font-size: 11px; color: var(--faint); background: #fff; border: 1px solid var(--border); border-radius: 6px; padding: 2px 8px; }
  .node { cursor: pointer; }
  .node rect { transition: stroke .1s, fill .1s; }
  .node:hover rect { stroke: var(--accent); }
  .node.sel rect { stroke: var(--accent); stroke-width: 1.5; fill: #eef2ff; }
  .vA-overlay { position: fixed; inset: 0; background: rgba(15,23,42,.35); display: none; align-items: center; justify-content: center; z-index: 60; padding: 24px; }
  .vA-overlay.open { display: flex; }
  .vA-modal { position: relative; background: #fff; border: 1px solid var(--border); border-radius: 14px; box-shadow: 0 24px 60px rgba(15,23,42,.25); padding: 22px 24px; width: min(620px, 100%); max-height: 82vh; overflow-y: auto; }
  .vA-detail-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; }
  .vA-detail-name { font-family: var(--mono); font-size: 20px; font-weight: 700; }
  .vA-detail-kind { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); }
  .vA-detail-close { margin-left: auto; border: none; background: none; color: var(--faint); font-size: 22px; cursor: pointer; line-height: 1; }
  .vA-detail-desc { font-size: 14px; line-height: 1.7; color: var(--muted); margin: 0 0 16px; }
  .vA-modal h4 { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); margin: 0 0 8px; }
  .vA-empty { color: var(--faint); font-size: 13px; }
  .port { cursor: pointer; }
  .port:hover { fill: #6366f1; }
  .vA-modal-wide { width: min(820px, 100%); }
  .vA-modal-sm { width: min(420px, 100%); }
  .vA-flow-sub { height: 320px; }
  .vA-mgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
  .vA-mcard { display: flex; flex-direction: column; gap: 4px; text-align: left; background: var(--canvas); border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; cursor: pointer; font: inherit; }
  .vA-mcard:hover { border-color: var(--accent); }
  .vA-mcard-name { font-family: var(--mono); font-size: 14px; font-weight: 600; }
  .vA-mcard-desc { font-size: 12px; color: var(--muted); }
  .vA-boundary { display: flex; flex-direction: column; gap: 6px; }
  .vA-bedge { font-size: 13px; color: var(--muted); font-family: var(--mono); }
  .vA-bedge-arrow { color: var(--accent-deep); }
  .vA-bedge-lab { color: var(--text); }
  .vA-pp-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .vA-pp-row:last-child { border-bottom: none; }
  .vA-pp-mod { font-family: var(--mono); font-weight: 600; }
  .vA-pp-arrow { color: var(--faint); }
  .vA-pp-lab { color: var(--accent-deep); }

  /* ===== B · Index ===== */
  .vB { max-width: 960px; margin: 0 auto; padding: 48px 32px; }
  .vB-head { border-bottom: 1px solid var(--border); padding-bottom: 24px; margin-bottom: 32px; }
  .vB-title { font-family: var(--mono); font-size: 28px; font-weight: 700; margin: 0 0 8px; }
  .vB-sub { font-size: 16px; color: var(--muted); margin: 0 0 20px; }
  .vB-io { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .vB-io dt { font-size: 11px; letter-spacing: .1em; text-transform: uppercase; color: var(--faint); margin-bottom: 6px; }
  .vB-io dd { margin: 0; font-size: 14px; color: var(--text); }
  .vB h2 { font-size: 14px; letter-spacing: .08em; text-transform: uppercase; color: var(--accent); margin: 0 0 16px; }
  .vB h2 span { color: var(--faint); font-weight: 400; }
  .vB-ext { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 40px; }
  .vB-extcard { border: 1px solid var(--border); border-radius: 10px; padding: 16px; }
  .vB-extname { font-family: var(--mono); font-size: 15px; font-weight: 600; }
  .vB-extdesc { font-size: 13px; color: var(--muted); margin: 4px 0 12px; }
  .vB-extuse { font-size: 12px; color: var(--accent-deep); font-family: var(--mono); }
  .vB-tbl { width: 100%; border-collapse: collapse; }
  .vB-tbl th { text-align: left; font-size: 12px; color: var(--faint); font-weight: 500; padding: 0 0 10px; border-bottom: 1px solid var(--border); }
  .vB-tbl td { padding: 14px 0; border-bottom: 1px solid #f0f2f5; vertical-align: top; font-size: 14px; }
  .vB-tbl td.m { font-family: var(--mono); font-weight: 600; }
  .vB-tbl td.d { color: var(--muted); }
  .vB-flow { font-family: var(--mono); font-size: 13px; color: var(--accent-deep); white-space: nowrap; }
`;

function render(ir) {
  const title = escapeHtml(ir.meta.title);
  const json = JSON.stringify(ir, null, 2).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — structure</title>
<style>${CSS}</style>
</head>
<body>
<div id="root"></div>

<div class="switcher">
  <button id="prev" aria-label="上一个">←</button>
  <span class="sw-tag">oh-grasp</span>
  <span id="swlabel">A — Flow · 数据流图</span>
  <button id="next" aria-label="下一个">→</button>
</div>

<script type="application/json" id="oh-grasp-ir">${json}</script>
<script>${VIEWER_SRC}</script>
</body>
</html>`;
}

module.exports = { render };

if (require.main === module) {
  const [, , irPath, outPath] = process.argv;
  if (!irPath) {
    console.error('Usage: node render.js <ir.json> [output.html]');
    process.exit(2);
  }
  const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
  const html = render(ir);
  if (outPath) fs.writeFileSync(outPath, html, 'utf8');
  else process.stdout.write(html);
}
