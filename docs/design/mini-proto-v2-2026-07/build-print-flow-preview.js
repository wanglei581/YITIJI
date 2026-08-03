#!/usr/bin/env node
/**
 * 打印子流程预览（Batch 2）：把真实实现的 5 个子页
 *   print-upload / print-store / print-pay / print-pickup / print-done
 * 的 wxml + wxss 渲染成浏览器可看的预览，用真实 app.wxss 设计系统。
 * 仅用于设计预览截图，不进入小程序构建。
 *
 * 做法：
 *  1) 用 Page() shim 捕获每页 data（初始态）。
 *  2) 迷你 WXML 模板引擎：展开 wx:for + 求值 {{表达式}}，剥离小程序专有属性。
 *  3) 拼接真实 CSS（app.wxss + 各子页 wxss），输出 html/css。
 */
const fs = require('fs');
const path = require('path');

const MP = '/Users/wanglei/WeChatProjects/zhiyida';
const OUT_HTML = path.join(__dirname, 'mini-preview-print-flow.html');
const OUT_CSS = path.join(__dirname, 'mini-preview-print-flow.css');

const PAGES = [
  { id: 'print-upload', cap: '06 · 打印参数' },
  { id: 'print-store', cap: '10 · 选择门店' },
  { id: 'print-pay', cap: '11 · 确认支付' },
  { id: 'print-pickup', cap: '12 · 取件码（尚未打印）' },
  { id: 'print-done', cap: '13 · 打印完成（示例态）' },
];

function readPage(id, ext) {
  return fs.readFileSync(path.join(MP, 'pages', id, `${id}.${ext}`), 'utf8');
}

// ── 捕获每页 data（初始态） ─────────────────────────────
function captureData(id) {
  const js = readPage(id, 'js');
  let captured = {};
  const Page = (o) => { captured = o.data || {}; };
  const getApp = () => ({ globalData: { statusBarHeight: 20 } });
  try {
    // eslint-disable-next-line no-new-func
    new Function('Page', 'getApp', 'wx', js)(Page, getApp, { navigateTo() {}, showModal() {}, showToast() {}, switchTab() {}, navigateBack() {} });
  } catch (e) {
    console.warn(`[warn] ${id} data 捕获失败:`, e.message);
  }
  return captured;
}

// ── 表达式求值 ─────────────────────────────────────────
function evalExpr(expr, scope) {
  try {
    const keys = Object.keys(scope);
    // eslint-disable-next-line no-new-func
    return Function(...keys, `return (${expr})`)(...keys.map((k) => scope[k]));
  } catch (e) {
    return '';
  }
}

function substituteVars(tpl, scope) {
  return tpl.replace(/\{\{([^}]+)\}\}/g, (m, e) => {
    const v = evalExpr(e.trim(), scope);
    return v == null ? '' : String(v);
  });
}

// 找到从 startIdx（'<' 处）开始、tagName 的配对闭合结束位置（返回结束后的下标）
function findElementEnd(html, startIdx, tagName) {
  const openRe = new RegExp(`<${tagName}(\\s|>|/)`, 'g');
  const closeRe = new RegExp(`</${tagName}>`, 'g');
  let depth = 0;
  let i = startIdx;
  while (i < html.length) {
    openRe.lastIndex = i;
    closeRe.lastIndex = i;
    const om = openRe.exec(html);
    const cm = closeRe.exec(html);
    const oPos = om ? om.index : Infinity;
    const cPos = cm ? cm.index : Infinity;
    if (oPos === Infinity && cPos === Infinity) break;
    if (oPos < cPos) {
      // 判断该开标签是否自闭合
      const tagClose = html.indexOf('>', oPos);
      const selfClose = html[tagClose - 1] === '/';
      if (!selfClose) depth += 1;
      i = tagClose + 1;
    } else {
      depth -= 1;
      i = cPos + `</${tagName}>`.length;
      if (depth === 0) return i;
    }
  }
  return html.length;
}

function render(tpl, scope) {
  const forIdx = tpl.indexOf('wx:for=');
  if (forIdx === -1) return substituteVars(tpl, scope);

  const elemStart = tpl.lastIndexOf('<', forIdx);
  const tagMatch = /^<([a-zA-Z][\w-]*)/.exec(tpl.slice(elemStart));
  const tagName = tagMatch[1];
  const elemEnd = findElementEnd(tpl, elemStart, tagName);
  const before = tpl.slice(0, elemStart);
  let element = tpl.slice(elemStart, elemEnd);
  const after = tpl.slice(elemEnd);

  const openTagEnd = element.indexOf('>');
  const openTag = element.slice(0, openTagEnd + 1);

  const forExpr = (/wx:for="\{\{([^}]+)\}\}"/.exec(openTag) || [])[1] || '[]';
  const itemName = (/wx:for-item="([^"]+)"/.exec(openTag) || [])[1] || 'item';
  const indexName = (/wx:for-index="([^"]+)"/.exec(openTag) || [])[1] || 'index';
  const list = evalExpr(forExpr, scope) || [];

  // 去掉本层 wx:for 系列属性，避免重复展开
  const strippedOpen = openTag
    .replace(/\s*wx:for="[^"]*"/, '')
    .replace(/\s*wx:for-item="[^"]*"/, '')
    .replace(/\s*wx:for-index="[^"]*"/, '')
    .replace(/\s*wx:key="[^"]*"/, '');
  const strippedElement = strippedOpen + element.slice(openTagEnd + 1);

  const loopOut = (Array.isArray(list) ? list : [])
    .map((v, i) => render(strippedElement, { ...scope, [itemName]: v, [indexName]: i }))
    .join('');

  return substituteVars(before, scope) + loopOut + render(after, scope);
}

function cleanupAttrs(html) {
  return html
    .replace(/\s(bind|catch)[a-zA-Z:]*="[^"]*"/g, '')
    .replace(/\sdata-[a-zA-Z0-9-]+="[^"]*"/g, '')
    .replace(/\swx:(key|for|for-item|for-index|if|elif)="[^"]*"/g, '')
    .replace(/\swx:else/g, '');
}

// ── 组装 CSS ───────────────────────────────────────────
let css = readPage('print-upload', 'wxss') && ''; // noop, keep order below
css = fs.readFileSync(path.join(MP, 'app.wxss'), 'utf8');
css = css.replace(/\bpage\s*\{/g, '.screen {');
for (const p of PAGES) {
  css += `\n\n/* ===== ${p.id} ===== */\n` + readPage(p.id, 'wxss');
}
const base = `
/* ── 预览基座（仅浏览器预览用） ── */
view, scroll-view { display: block; box-sizing: border-box; }
text { display: inline; }
.screen {
  position: relative;
  width: 390px; height: 844px;
  overflow: hidden;
  border-radius: 42px;
  font-family: var(--font-sans);
  background: var(--paper);
}
.screen .page-wrap { min-height: 0; height: 100%; display: flex; flex-direction: column; }
.screen .content { flex: 1; overflow-y: auto; }
.screen .actionbar { position: absolute; }
`;
fs.writeFileSync(OUT_CSS, base + '\n' + css);

// ── 组装 HTML ──────────────────────────────────────────
let frames = '';
for (const p of PAGES) {
  const data = captureData(p.id);
  const wxml = readPage(p.id, 'wxml');
  const html = cleanupAttrs(render(wxml, data));
  frames += `
  <div class="frame">
    <div class="screen">${html}</div>
    <div class="cap">${p.cap}</div>
  </div>`;
}

const doc = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>智达小程序 · 打印子流程预览</title>
<link rel="stylesheet" href="mini-preview-print-flow.css">
<style>
  body { margin:0; background:#1a1f1d; font-family:-apple-system,'PingFang SC',sans-serif; padding:40px 24px 80px; }
  .head { color:#e8e4d8; text-align:center; margin-bottom:32px; }
  .head h1 { font-size:22px; font-weight:700; letter-spacing:2px; margin:0 0 8px; }
  .head p { font-size:13px; color:#8a978f; margin:0; }
  .gallery { display:flex; gap:28px; justify-content:flex-start; overflow-x:auto; padding:0 8px 24px; }
  .frame { flex:0 0 auto; }
  .frame .cap { color:#c8cfc9; font-size:13px; text-align:center; margin-top:14px; letter-spacing:1px; }
  .screen { box-shadow:0 24px 70px rgba(0,0,0,.5); border:6px solid #0c0f0e; }
</style>
</head>
<body>
<div class="head">
  <h1>智达 · 打印子流程（手机付费 · 到店取件）</h1>
  <p>真实实现代码渲染 · 上传参数 → 选门店 → 手机付费 → 取件码 → 完成 · 出纸锚定一体机 · 390×844</p>
</div>
<div class="gallery">${frames}
</div>
</body>
</html>`;
fs.writeFileSync(OUT_HTML, doc);
console.log('written', OUT_HTML, 'and', OUT_CSS);
