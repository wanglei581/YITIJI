#!/usr/bin/env node
/**
 * build-jobs-preview.js  (worktree version)
 * 从 WeChatProjects/zhiyida 读取源文件，生成求职信息预览 HTML
 * 输出: mini-preview-jobs.html + mini-preview-jobs.css（此目录，由 http.server 5291 服务）
 */
'use strict';
const fs   = require('fs');
const path = require('path');

// 小程序源码目录（跨项目读取）
const PROJ    = path.resolve('/Users/wanglei/WeChatProjects/zhiyida');
const OUT_DIR = __dirname;
const W = 402, H = 856;

// ── CSS 工具 ──────────────────────────────────────────────────────────────────
function readTokens() {
  const src = fs.readFileSync(path.join(PROJ, 'app.wxss'), 'utf8');
  const m = src.match(/(?::root|page)\s*\{([^}]+)\}/s);
  return m ? m[1].trim() : '';
}
function readPageCss(rel) {
  try { return fs.readFileSync(path.join(PROJ, rel), 'utf8'); } catch { return ''; }
}
function readAppCss() {
  return fs.readFileSync(path.join(PROJ, 'app.wxss'), 'utf8');
}

// ── Frame 定义 (手写 HTML，不解析 WXML) ────────────────────────────────────────
const FRAMES = [
  {
    no: '17', label: '岗位列表',
    pageCss: 'pages/jobs/jobs.wxss',
    html: `
<div class="page-wrap">
  <div style="height:20px"></div>
  <div class="navbar">
    <div class="nav-center nav-title">求职信息</div>
  </div>
  <div class="content">
    <div class="filter-bar">
      <span class="filter-chip active tap">全部</span>
      <span class="filter-chip tap">岗位</span>
      <span class="filter-chip tap">招聘会</span>
      <span class="filter-chip tap">找企业</span>
      <span class="filter-chip tap">政策</span>
    </div>
    <div class="section-t">推荐岗位 <span class="s-sub">来自第三方平台</span></div>
    <div class="job-card tap">
      <div class="jc-top"><span class="jc-title">前端开发工程师</span><span class="jc-salary">8–14K</span></div>
      <div class="jc-company">杭州某科技有限公司 · 西湖区</div>
      <div class="jc-tags"><span class="tag sm">互联网</span><span class="tag sm">本科及以上</span><span class="tag sm">React</span></div>
      <div class="jc-footer"><span class="match-badge high">较高参考</span><span class="jc-source">智联招聘 · 2 小时前</span></div>
    </div>
    <div class="job-card tap">
      <div class="jc-top"><span class="jc-title">UI/UX 设计师</span><span class="jc-salary">9–15K</span></div>
      <div class="jc-company">某互联网公司 · 滨江区</div>
      <div class="jc-tags"><span class="tag sm">设计</span><span class="tag sm">经验不限</span><span class="tag sm">Figma</span></div>
      <div class="jc-footer"><span class="match-badge mid">中等参考</span><span class="jc-source">官方人才网 · 今天</span></div>
    </div>
    <div class="job-card tap">
      <div class="jc-top"><span class="jc-title">产品运营专员</span><span class="jc-salary">6–10K</span></div>
      <div class="jc-company">某文化传媒 · 拱墅区</div>
      <div class="jc-tags"><span class="tag sm">运营</span><span class="tag sm">大专及以上</span><span class="tag sm">应届可</span></div>
      <div class="jc-footer"><span class="match-badge mid">中等参考</span><span class="jc-source">前程无忧 · 昨天</span></div>
    </div>
    <div class="notice info"><span class="n-ic">ℹ</span>岗位信息来自第三方平台，请在来源平台完成投递。本终端不收取简历，不参与招聘流程。</div>
  </div>
</div>`,
  },
  {
    no: '18', label: '岗位详情',
    pageCss: 'pages/job-detail/job-detail.wxss',
    html: `
<div class="page-wrap">
  <div style="height:20px"></div>
  <div class="navbar">
    <div class="nav-back"><span class="nav-back-ic">›</span></div>
    <div class="nav-center nav-title">岗位详情</div>
  </div>
  <div class="content has-bar">
    <div class="job-header">
      <div class="jh-title">后端开发工程师（Node.js）</div>
      <div class="jh-salary">15k–25k</div>
      <div class="jh-company">某科技有限公司</div>
      <div class="jh-tags">
        <span class="tag sm">全职</span><span class="tag sm">本科</span>
        <span class="tag sm">3–5年</span><span class="tag sm">深圳·南山</span>
      </div>
    </div>
    <div class="info-card">
      <div class="ic-title">来源信息</div>
      <div class="ic-row"><span class="ic-k">来源机构</span><span class="ic-v">深圳市公共就业服务中心</span></div>
      <div class="ic-row"><span class="ic-k">外部 ID</span><span class="ic-v mono">JOB-2026-087634</span></div>
      <div class="ic-row"><span class="ic-k">同步时间</span><span class="ic-v">2026-07-24 09:12</span></div>
      <div class="ic-note">本岗位信息来自第三方平台，请在来源平台完成投递。</div>
    </div>
    <div class="ai-entry tap">
      <div class="ae-left"><span class="ae-ic">✦</span></div>
      <div class="ae-body"><div class="ae-title">AI 岗位匹配参考</div><div class="ae-sub">查看与您简历的匹配度分析</div></div>
      <span class="ae-arr">›</span>
    </div>
    <div class="section-t">岗位职责</div>
    <div class="duty-list">
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">负责后端业务逻辑开发与接口设计</span></div>
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">参与系统架构设计与技术选型</span></div>
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">编写技术文档，保障代码质量</span></div>
    </div>
    <div class="section-t">任职要求</div>
    <div class="duty-list">
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">3年以上 Node.js 后端开发经验</span></div>
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">熟悉 PostgreSQL / MySQL / Redis</span></div>
      <div class="duty-item"><span class="duty-dot"></span><span class="duty-text">本科及以上学历，计算机相关专业</span></div>
    </div>
    <div class="notice info"><span class="n-ic">ℹ</span>投递须前往来源平台操作，本终端不收取简历。</div>
  </div>
  <div class="actionbar">
    <div class="btn ghost tap">扫码投递</div>
    <div class="btn primary tap flex-1-6">去来源平台投递</div>
  </div>
</div>`,
  },
  {
    no: '19', label: '招聘会详情',
    pageCss: 'pages/fair-detail/fair-detail.wxss',
    html: `
<div class="page-wrap">
  <div style="height:20px"></div>
  <div class="navbar">
    <div class="nav-back"><span class="nav-back-ic">›</span></div>
    <div class="nav-center nav-title">招聘会详情</div>
  </div>
  <div class="content has-bar">
    <div class="fair-hero">
      <span class="fh-badge active">进行中</span>
      <div class="fh-title">2026 深圳春季综合招聘会</div>
      <div class="fh-org">深圳市人力资源和社会保障局 主办</div>
    </div>
    <div class="info-grid">
      <div class="ig-cell"><div class="ig-label">时间</div><div class="ig-val">07-25 09:00–17:00</div></div>
      <div class="ig-cell"><div class="ig-label">形式</div><div class="ig-val">线下（现场招聘）</div></div>
      <div class="ig-cell"><div class="ig-label">参会单位</div><div class="ig-val">168 家</div></div>
      <div class="ig-cell"><div class="ig-label">面向对象</div><div class="ig-val">应届生 / 社会人才</div></div>
    </div>
    <div class="info-card">
      <div class="ic-title">来源信息</div>
      <div class="ic-row"><span class="ic-k">来源机构</span><span class="ic-v">深圳市公共就业服务中心</span></div>
      <div class="ic-row"><span class="ic-k">外部 ID</span><span class="ic-v mono">FAIR-2026-041</span></div>
      <div class="ic-row"><span class="ic-k">同步时间</span><span class="ic-v">2026-07-24 08:00</span></div>
    </div>
    <div class="section-t">活动介绍</div>
    <div class="body-text">本次招聘会汇聚制造业、科技、服务等各类企业，现场提供就业咨询、简历打印等配套服务。</div>
    <div class="section-t">展位预览</div>
    <div class="booth-list">
      <div class="booth-item"><span class="bi-zone zone-a">A</span><span class="bi-name">华为技术有限公司</span><span class="bi-pos">A-01</span></div>
      <div class="booth-item"><span class="bi-zone zone-b">B</span><span class="bi-name">比亚迪股份有限公司</span><span class="bi-pos">B-07</span></div>
      <div class="booth-item"><span class="bi-zone zone-c">C</span><span class="bi-name">腾讯科技（深圳）有限公司</span><span class="bi-pos">C-03</span></div>
    </div>
    <div class="st-action tap">查看完整展位导览图 ›</div>
    <div class="notice info"><span class="n-ic">ℹ</span>预约须前往来源平台操作。</div>
  </div>
  <div class="actionbar">
    <div class="btn ghost tap">扫码预约</div>
    <div class="btn primary tap flex-1-4">去来源平台预约</div>
  </div>
</div>`,
  },
  {
    no: '20', label: '展位导览图',
    pageCss: 'pages/fair-map/fair-map.wxss',
    html: `
<div class="page-wrap">
  <div style="height:20px"></div>
  <div class="navbar">
    <div class="nav-back"><span class="nav-back-ic">›</span></div>
    <div class="nav-center nav-title">展位导览图</div>
    <div class="nav-right"><span class="nav-btn">🖨</span></div>
  </div>
  <div class="content has-bar">
    <div class="map-area">
      <div class="map-hint">点击分区可高亮定位</div>
      <div class="map-canvas">
        <div class="zone-block zone-a" style="top:8%;left:5%;width:40%;height:35%">
          <span class="zone-label">A 区</span><span class="zone-sub">制造业</span>
        </div>
        <div class="zone-block zone-c" style="top:8%;left:55%;width:40%;height:35%">
          <span class="zone-label">C 区</span><span class="zone-sub">科技互联网</span>
        </div>
        <div class="zone-block zone-b" style="top:50%;left:5%;width:55%;height:35%">
          <span class="zone-label">B 区</span><span class="zone-sub">综合</span>
        </div>
        <div class="zone-block zone-s" style="top:50%;left:68%;width:27%;height:35%">
          <span class="zone-label">S 区</span><span class="zone-sub">服务业</span>
        </div>
        <span class="map-entrance">入口↓</span>
      </div>
    </div>
    <div class="legend">
      <div class="lg-item"><span class="lg-dot zone-a"></span><span class="lg-text">A 区 · 制造业</span></div>
      <div class="lg-item"><span class="lg-dot zone-c"></span><span class="lg-text">C 区 · 科技互联网</span></div>
      <div class="lg-item"><span class="lg-dot zone-b"></span><span class="lg-text">B 区 · 综合</span></div>
      <div class="lg-item"><span class="lg-dot zone-s"></span><span class="lg-text">S 区 · 服务业</span></div>
    </div>
    <div class="section-t">分区展位一览</div>
    <div class="zone-index">
      <div class="zi-row tap"><span class="zi-dot zone-a"></span><div class="zi-body"><div class="zi-name">A 区 · 制造业</div><div class="zi-range">A01–A40</div></div><span class="zi-count">42</span><span class="zi-arr">›</span></div>
      <div class="zi-row tap"><span class="zi-dot zone-c"></span><div class="zi-body"><div class="zi-name">C 区 · 科技互联网</div><div class="zi-range">C01–C35</div></div><span class="zi-count">36</span><span class="zi-arr">›</span></div>
      <div class="zi-row tap"><span class="zi-dot zone-b"></span><div class="zi-body"><div class="zi-name">B 区 · 综合</div><div class="zi-range">B01–B50</div></div><span class="zi-count">50</span><span class="zi-arr">›</span></div>
      <div class="zi-row tap"><span class="zi-dot zone-s"></span><div class="zi-body"><div class="zi-name">S 区 · 服务业</div><div class="zi-range">S01–S20</div></div><span class="zi-count">22</span><span class="zi-arr">›</span></div>
    </div>
    <div class="map-tip">图示为示意图，以现场实际布局为准</div>
  </div>
  <div class="actionbar">
    <div class="btn ghost tap">保存图片</div>
    <div class="btn primary tap flex-1-4">打印导览图</div>
  </div>
</div>`,
  },
  {
    no: '21', label: '政策详情',
    pageCss: 'pages/policy-detail/policy-detail.wxss',
    html: `
<div class="page-wrap">
  <div style="height:20px"></div>
  <div class="navbar">
    <div class="nav-back"><span class="nav-back-ic">›</span></div>
    <div class="nav-center nav-title">政策详情</div>
  </div>
  <div class="content has-bar">
    <div class="policy-hero">
      <span class="ph-cat">就业补贴</span>
      <div class="ph-title">2026年深圳市高校毕业生就业补贴实施办法</div>
      <div class="ph-meta"><span>深圳市人力资源和社会保障局</span><span class="ph-dot">·</span><span>2026-01-15</span></div>
    </div>
    <div class="ai-card">
      <div class="ai-head">✦ AI 政策速读</div>
      <div class="ai-body">面向深圳首次就业应届生，按学历层次提供一次性补贴，最高 6000 元，申领截至 2026-12-31。</div>
      <div class="ai-disclaimer">AI 速读仅供参考，以官方原文为准。</div>
    </div>
    <div class="section-t">补贴对象</div>
    <div class="body-text">在深圳市首次就业且签订1年以上劳动合同并缴纳社保的应届高校毕业生（毕业年度为2026年）。</div>
    <div class="section-t">补贴标准</div>
    <div class="policy-table">
      <div class="pt-row"><span class="pt-type">专科毕业生</span><span class="pt-amt">2000 元</span></div>
      <div class="pt-row"><span class="pt-type">本科毕业生</span><span class="pt-amt">3000 元</span></div>
      <div class="pt-row"><span class="pt-type">硕士研究生</span><span class="pt-amt">5000 元</span></div>
      <div class="pt-row"><span class="pt-type">博士研究生</span><span class="pt-amt">6000 元</span></div>
    </div>
    <div class="section-t">申领流程</div>
    <div class="step-flow">
      <div class="sf-item"><span class="sf-n">1</span><span class="sf-text">在深圳就业并完成社保参保登记</span></div>
      <div class="sf-item"><span class="sf-n">2</span><span class="sf-text">登录"深圳就业"小程序或前往就业服务窗口申报</span></div>
      <div class="sf-item"><span class="sf-n">3</span><span class="sf-text">上传毕业证、劳动合同、社保缴纳记录</span></div>
      <div class="sf-item"><span class="sf-n">4</span><span class="sf-text">审核通过后，补贴发放至本人银行账户</span></div>
    </div>
    <div class="info-card">
      <div class="ic-title">来源信息</div>
      <div class="ic-row"><span class="ic-k">发布机构</span><span class="ic-v">深圳市人社局</span></div>
      <div class="ic-row"><span class="ic-k">同步时间</span><span class="ic-v">2026-07-24 08:00</span></div>
    </div>
    <div class="notice info"><span class="n-ic">ℹ</span>本内容来自官方渠道，仅供参考，请以官方原文为准。</div>
  </div>
  <div class="actionbar">
    <div class="btn ghost tap">打印政策</div>
    <div class="btn primary tap flex-1-6">查看官方原文</div>
  </div>
</div>`,
  },
];

// ── 生成 CSS ──────────────────────────────────────────────────────────────────
function buildCss() {
  const appCss = readAppCss();
  const extra = [...new Set(FRAMES.map(f => f.pageCss).filter(Boolean))]
    .map(rel => readPageCss(rel)).join('\n');
  return `/* Auto-generated by build-jobs-preview.js */
:root { ${readTokens()} }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #1a1a1a; font-family: -apple-system, "PingFang SC", sans-serif;
  padding: 40px 20px 60px; }
h1 { color: #fff; text-align: center; font-size: 18px; margin-bottom: 32px;
  font-weight: 500; letter-spacing: 1px; }
.frames { display: flex; flex-wrap: wrap; gap: 32px; justify-content: center; }
.frame  { display: flex; flex-direction: column; align-items: center; gap: 12px; }
.frame-label { color: #aaa; font-size: 12px; letter-spacing: 1px; }
.frame-no    { color: #555; font-size: 11px; }
.phone { width: ${W}px; height: ${H}px; background: #111; border-radius: 44px;
  box-shadow: 0 20px 60px rgba(0,0,0,.6); overflow: hidden; }
.phone-inner { width: ${W}px; height: ${H}px; overflow-y: auto; overflow-x: hidden;
  position: relative; background: var(--paper);
  font-size: 14px; line-height: 1.5; color: var(--ink); }
.phone-inner::-webkit-scrollbar { display: none; }

${appCss}
${extra}

.phone-inner .page-wrap { min-height: ${H}px; }
.phone-inner .content { padding: 16px 16px 100px; }
.phone-inner .content.has-bar { padding-bottom: 110px; }
`;
}

// ── 生成 HTML ─────────────────────────────────────────────────────────────────
function buildHtml(cssFile) {
  const frames = FRAMES.map(f => `
  <div class="frame">
    <div class="frame-no">页面 ${f.no}</div>
    <div class="phone"><div class="phone-inner">${f.html}</div></div>
    <div class="frame-label">${f.label}</div>
  </div>`).join('');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>小程序预览 · 求职信息 Batch 3</title>
<link rel="stylesheet" href="${cssFile}" />
</head>
<body>
<h1>小程序预览 — 求职信息 (Batch 3 · 页面 17–21)</h1>
<div class="frames">${frames}
</div>
</body>
</html>
`;
}

// ── 输出 ──────────────────────────────────────────────────────────────────────
const CSS_FILE = 'mini-preview-jobs.css';
fs.writeFileSync(path.join(OUT_DIR, CSS_FILE),            buildCss(),          'utf8');
fs.writeFileSync(path.join(OUT_DIR, 'mini-preview-jobs.html'), buildHtml(CSS_FILE), 'utf8');
console.log('✅  mini-preview-jobs.html');
console.log('✅  mini-preview-jobs.css');
console.log(`    ${FRAMES.length} frames: ${FRAMES.map(f => f.no + ' ' + f.label).join(', ')}`);
