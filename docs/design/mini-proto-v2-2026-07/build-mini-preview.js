#!/usr/bin/env node
/**
 * 组装小程序 premium 改版预览：把真实的 app.wxss + 各页 wxss 拼成一份
 * 浏览器可渲染的 CSS（WXSS 本质是 CSS，<view>/<text> 作为自定义元素渲染）。
 * 仅用于设计预览截图，不进入小程序构建。
 */
const fs = require('fs');
const path = require('path');

const MP = '/Users/wanglei/WeChatProjects/zhiyida';
const OUT = path.join(__dirname, 'mini-preview-premium.css');

function read(p) { return fs.readFileSync(path.join(MP, p), 'utf8'); }

let css = read('app.wxss');

// page{} 的 token 作用域改到 .screen，让每个手机框独立继承
css = css.replace(/\bpage\s*\{/g, '.screen {');

// 各页样式（这些用 class 选择器，直接可用）
const pages = ['home', 'print', 'jobs', 'ai', 'me'];
for (const p of pages) {
  css += `\n\n/* ===== ${p} ===== */\n` + read(`pages/${p}/${p}.wxss`);
}

// 预览基座：自定义元素显示规则 + 把 fixed 定位收敛到手机框内
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
}
.screen .content { height: 100%; overflow-y: auto; }
/* tabbar / actionbar 在预览里贴手机框底部而非视口 */
.screen .tabbar, .screen .actionbar { position: absolute; }
`;

fs.writeFileSync(OUT, base + '\n' + css);
console.log('written', OUT, css.length + base.length, 'bytes');
