#!/usr/bin/env node
// build-ai-preview.js — AI工具 pages 29-38 multi-frame preview builder
// 策略：读取 shared.css 并将 #stage 替换为 .ph，各 frame 用真实组件类
'use strict'
const fs   = require('fs')
const path = require('path')

const OUT_DIR  = __dirname
const OUT_HTML = path.join(OUT_DIR, 'mini-preview-ai.html')
const OUT_CSS  = path.join(OUT_DIR, 'mini-preview-ai.css')

// 读取 shared.css 并作用域化（#stage → .ph）
const sharedRaw = fs.readFileSync(path.join(OUT_DIR, 'shared.css'), 'utf8')
const scopedCss = sharedRaw.replace(/#stage\b/g, '.ph')

// gallery 外壳 CSS（不进入 .ph 作用域）
const galleryCss = `
body{margin:0;background:#12201c;padding:36px 28px 80px;
  font-family:-apple-system,'PingFang SC',sans-serif;
  display:flex;flex-wrap:wrap;gap:28px;align-items:flex-start}
.fw{display:flex;flex-direction:column;align-items:center;gap:11px}
.fl{font-size:12px;color:#7a8f84;font-weight:600;letter-spacing:.8px;
  text-transform:uppercase}
.shell{width:375px;height:812px;overflow:hidden;border-radius:34px;
  box-shadow:0 20px 72px rgba(0,0,0,.6);position:relative;flex-shrink:0}
.ph{width:375px;min-height:812px}
`

const frames = []
function frame(label, html) { frames.push({ label, html }) }

// ── helpers ───────────────────────────────────────────────────────
const nav = (title, col='var(--surface)', light=false) => `
<div class="statusbar${light?' light':''}" style="background:${col}">
  <span>9:41</span><div class="sb-icons">📶 5G 🔋</div>
</div>
<div class="navbar${light?' light':''}" style="background:${col};${light?'border-bottom:none':''}">
  <div class="nav-back"${light?' style="color:#fff"':''}>‹</div>
  <div class="nav-title"${light?' style="color:#fff"':''}>${title}</div>
  <div class="nav-right"></div>
</div>`

const actionbar = (...btns) =>
  `<div class="actionbar">${btns.map(([cls,lbl])=>`<button class="btn ${cls}">${lbl}</button>`).join('')}</div>`

// ── p29  AI 工具总览 ──────────────────────────────────────────────
frame('p29  AI 工具', `<div class="ph">
<div class="statusbar light" style="background:#3a1d55"><span>9:41</span>
  <div class="sb-icons">📶 5G 🔋</div></div>
<div class="content has-tabbar" style="padding-top:0">
  <div style="background:linear-gradient(160deg,#3a1d55,#7a5a86);
    padding:22px 20px 44px;position:relative;overflow:hidden">
    <div style="position:absolute;right:-20px;top:-20px;width:130px;height:130px;
      border-radius:50%;background:rgba(255,255,255,.06)"></div>
    <div class="badge plum" style="margin-bottom:12px">✦ AI 服务中心</div>
    <div style="font-family:var(--font-serif);font-size:22px;font-weight:700;
      color:#fff">求职 AI 全套工具</div>
    <div style="font-size:12.5px;color:rgba(255,255,255,.72);margin-top:7px">
      简历 · 面试 · 规划 · 匹配，AI 陪你全程</div>
  </div>
  <div class="card" style="margin:-28px 16px 0;position:relative">
    <div class="card-inner" style="display:flex;gap:10px;align-items:center">
      <div style="font-size:22px">✦</div>
      <div style="flex:1">
        <div style="font-size:13px;font-weight:600;color:var(--ink)">今日已用 2 次 AI 服务</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:3px">诊断 · 优化 各1次</div>
      </div>
      <span class="badge teal">历史记录</span>
    </div>
  </div>
  <div class="section-t" style="margin-top:18px">选择 AI 工具</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:0 16px">
    ${[['📋','简历诊断','逐条分析问题','var(--plum)'],
       ['✏️','简历优化','改写前后对照','var(--teal)'],
       ['📝','AI 生成简历','按岗位起草初稿','var(--slate)'],
       ['🎙','模拟面试','出题 + 复盘','var(--clay)'],
       ['🧭','职业规划','成长路径参考','var(--wheat)'],
       ['🔗','岗位匹配','与简历相符度','var(--plum)']]
      .map(([ic,t,d,c])=>`
    <div class="card" style="margin:0">
      <div class="card-inner" style="padding:14px">
        <div style="width:36px;height:36px;border-radius:10px;
          border-left:3px solid ${c};background:var(--paper);
          display:flex;align-items:center;justify-content:center;
          font-size:18px;margin-bottom:9px">${ic}</div>
        <div style="font-size:14px;font-weight:700;color:var(--ink)">${t}</div>
        <div style="font-size:11.5px;color:var(--muted);margin-top:3px">${d}</div>
      </div>
    </div>`).join('')}
  </div>
  <div class="spacer-lg"></div>
</div>
<div class="tabbar">
  <div class="tab"><div class="ti">⌂</div><div class="tl">首页</div></div>
  <div class="tab"><div class="ti">🖨</div><div class="tl">打印</div></div>
  <div class="tab"><div class="ti">💼</div><div class="tl">求职</div></div>
  <div class="tab on"><div class="ti">✦</div><div class="tl">AI</div></div>
  <div class="tab"><div class="ti">◍</div><div class="tl">我的</div></div>
</div>
</div>`)

// ── p30  简历上传 ─────────────────────────────────────────────────
frame('p30  简历上传', `<div class="ph">
${nav('上传简历','#3a1d55',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(155deg,#3a1d55,#7a5a86);
    padding:16px 20px 38px;margin:-16px -16px 0">
    <div class="badge plum" style="margin-bottom:9px">选择来源</div>
    <div style="font-family:var(--font-serif);font-size:18px;font-weight:700;color:#fff">
      上传你的简历</div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:5px">
      支持 PDF / Word / 扫描件</div>
  </div>
  <div class="card" style="margin-top:12px">
    ${[['📱','从手机选择文件','PDF · Word · txt · 图片'],
       ['📷','扫描纸质简历','调用终端扫描仪'],
       ['🤳','拍照识别','摄像头拍摄简历页']]
      .map(([ic,t,d],i,a)=>`
    <div class="row-item" style="${i<a.length-1?'border-bottom:1px solid var(--line-faint)':''}">
      <div style="width:42px;height:42px;border-radius:12px;
        background:var(--plum-wash);display:flex;align-items:center;
        justify-content:center;font-size:20px;flex-shrink:0">${ic}</div>
      <div class="ri-main">
        <div class="ri-t">${t}</div>
        <div class="ri-s">${d}</div>
      </div>
      <div class="ri-go">›</div>
    </div>`).join('')}
  </div>
  <div class="section-t">简历库（2 份）</div>
  <div class="card">
    ${[['前端开发-陈明.pdf','256 KB · 2天前','teal'],
       ['全栈方向-陈明.docx','198 KB · 1周前','plum']]
      .map(([n,m,c],i,a)=>`
    <div class="row-item" style="${i<a.length-1?'border-bottom:1px solid var(--line-faint)':''}">
      <div style="font-size:26px">📄</div>
      <div class="ri-main">
        <div class="ri-t">${n}</div>
        <div class="ri-s">${m}</div>
      </div>
      <span class="badge ${c}">选用</span>
    </div>`).join('')}
  </div>
  <div class="notice info">简历仅用于当前 AI 服务，处理后按策略自动清理。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['ghost-ink','跳过'],['plum lg','✦ 开始 AI 诊断'])}
</div>`)

// ── p31  简历诊断-结果 ────────────────────────────────────────────
frame('p31  诊断结果', `<div class="ph">
${nav('简历诊断','#183a32',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(135deg,#183a32,#1f9e86);
    border-radius:16px;padding:22px;display:flex;align-items:center;gap:20px;margin-top:4px">
    <div style="font-family:var(--font-serif);font-size:56px;font-weight:700;
      color:#fff;line-height:1">72</div>
    <div style="flex:1">
      <div style="font-size:13px;color:rgba(255,255,255,.65);margin-bottom:8px">综合评分</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <span style="font-size:11.5px;color:#ff8a8a">● 重要 3</span>
        <span style="font-size:11.5px;color:var(--wheat)">● 建议 5</span>
        <span style="font-size:11.5px;color:rgba(255,255,255,.45)">● 提示 2</span>
      </div>
    </div>
  </div>
  <div class="section-t">诊断详情</div>
  <div class="card">
    ${[['重要','工作经历描述过于笼统','工作经历 · 第 1 条',
        '用量化成果替代模糊表述，如"负责"改为"主导并提升 X%"。'],
       ['建议','缺少关键词匹配','技能 · 全部',
        '目标岗位要求 TypeScript / React，建议补充到技能栏。'],
       ['提示','个人简介篇幅偏长','个人简介',
        '建议控制在 3 行以内，突出核心竞争力。']]
      .map(([tier,t,p,tip],i,a)=>`
    <div style="padding:13px 15px;${i<a.length-1?'border-bottom:1px solid var(--line-faint)':''}">
      <span class="risk-tier ${tier==='重要'?'high':tier==='建议'?'mid':'low'}">${tier}</span>
      <div style="font-size:14px;font-weight:600;color:var(--ink);margin:7px 0 3px">${t}</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:7px">${p}</div>
      <div class="evidence-quote"><div class="eq-text">${tip}</div></div>
    </div>`).join('')}
  </div>
  <div class="compliance-note">诊断由 AI 生成，仅供参考，不代表招聘方评估标准。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['ghost-ink','📄 打印报告'],['primary lg','✦ 去 AI 优化'])}
</div>`)

// ── p32  简历优化-对比 ────────────────────────────────────────────
frame('p32  简历优化', `<div class="ph">
<div class="statusbar light" style="background:#3a1d55"><span>9:41</span>
  <div class="sb-icons">📶 5G 🔋</div></div>
<div class="navbar light" style="background:#3a1d55;border-bottom:none">
  <div class="nav-back" style="color:#fff">‹</div>
  <div class="nav-title" style="color:#fff">简历优化</div>
  <div class="nav-right"><span style="font-size:12px;padding:4px 10px;
    border-radius:20px;border:1px solid rgba(255,255,255,.4);color:rgba(255,255,255,.85)">对比</span></div>
</div>
<div class="content has-bar">
  <div class="notice plum"><span>✦</span>
    <div>AI 已生成优化建议，逐条查看并决定是否采用。</div>
  </div>
  ${[['工作经历 · 第 1 条',
      '参与公司前端项目的开发和维护工作，完成了各种功能的迭代。',
      '主导 3 个 React 模块重构，首屏加载从 4.2s→1.8s，上线后 DAU 提升 18%。',
      '补充量化数据，突出贡献规模与可量化结果。'],
     ['技能清单',
      '熟悉 Vue，了解 React，会写 CSS。',
      'TypeScript · React 18 · Vue 3 · Vite · Tailwind CSS',
      '补充岗位核心关键词，使用行业通用格式。']]
    .map(([sec,old,nw,why])=>`
  <div class="diff-view">
    <div class="dv-head">${sec}</div>
    <div class="dv-cols">
      <div class="dv-col old">
        <div class="dvc-label">原文</div>
        <div class="diff-old">${old}</div>
      </div>
      <div class="dv-col new">
        <div class="dvc-label">优化后</div>
        <div class="diff-new">${nw}</div>
      </div>
    </div>
    <div class="why-row"><span>✦</span><span>${why}</span></div>
  </div>`).join('')}
  <div class="spacer-lg"></div>
</div>
<div class="actionbar">
  <span style="font-size:13px;color:var(--muted);align-self:center">2 / 6 项</span>
  <button class="btn ghost-ink">导出</button>
  <button class="btn plum" style="flex:1.4">✦ 生成新版简历</button>
</div>
</div>`)

// ── p33  AI 生成简历（表单） ────────────────────────────────────────
frame('p33  AI生成简历', `<div class="ph">
${nav('AI 生成简历','#614870',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(155deg,#614870,#7a5a86);
    padding:16px 20px 34px;margin:-16px -16px 0">
    <div class="badge plum" style="margin-bottom:9px">✦ AI 辅助创作</div>
    <div style="font-family:var(--font-serif);font-size:20px;font-weight:700;color:#fff">
      告诉 AI 你的求职意向</div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:5px">
      填写基础信息，AI 起草结构完整的初稿</div>
  </div>
  <div class="section-t" style="margin-top:14px">目标岗位 <span style="color:var(--clay)">*</span></div>
  <div class="field"><input class="inp" value="前端开发工程师" /></div>
  <div class="section-t">工作年限</div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px">
    ${['应届生','1-3 年','3-5 年','5 年以上'].map((l,i)=>`
    <div style="padding:11px;border:1.5px solid ${i===1?'var(--plum)':'var(--line)'};
      border-radius:var(--r-md);text-align:center;font-size:13px;
      color:${i===1?'var(--plum-deep)':'var(--ink-soft)'};
      background:${i===1?'var(--plum-wash)':'var(--surface)'};
      font-weight:${i===1?'600':'400'}">${l}</div>`).join('')}
  </div>
  <div class="section-t">简历语气</div>
  <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:2px">
    ${['专业稳重','简洁干练','进取有冲劲','亲和沟通'].map((t,i)=>`
    <div style="flex-shrink:0;padding:8px 15px;border-radius:var(--r-full);
      border:1.5px solid ${i===0?'var(--plum)':'var(--line)'};font-size:13px;
      color:${i===0?'#fff':'var(--ink-soft)'};
      background:${i===0?'var(--plum)':'var(--surface)'}">${t}</div>`).join('')}
  </div>
  <div class="notice plum" style="margin-top:16px"><span>✦</span>
    <div>AI 仅根据你提供的信息起草，<b>不会编造经历</b>。生成后请核对并补充真实内容。</div>
  </div>
  <div class="compliance-note">AI 生成内容仅供参考，请确保填写信息真实。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['plum lg block','✦ 开始生成简历'])}
</div>`)

// ── p34  模拟面试-入口 ────────────────────────────────────────────
frame('p34  面试入口', `<div class="ph">
${nav('模拟面试','#3d3270',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(155deg,#3d3270,#614870);
    padding:16px 20px 34px;margin:-16px -16px 0">
    <div class="badge plum" style="margin-bottom:9px">✦ AI 面试教练</div>
    <div style="font-family:var(--font-serif);font-size:20px;font-weight:700;color:#fff">
      开始一轮模拟面试</div>
    <div style="font-size:12px;color:rgba(255,255,255,.7);margin-top:5px">
      AI 出题 · 逐题分析 · 结构化复盘报告</div>
  </div>
  <div class="section-t" style="margin-top:14px">目标岗位</div>
  <div class="field"><input class="inp" value="前端工程师（React 方向）" /></div>
  <div class="section-t">面试级别</div>
  <div style="display:flex;flex-wrap:wrap;gap:9px">
    ${['校招','初级','中级','高级'].map((l,i)=>`
    <div style="padding:9px 20px;border-radius:var(--r-full);font-size:13px;
      border:1.5px solid ${i===1?'var(--plum)':'var(--line)'};
      color:${i===1?'var(--plum-deep)':'var(--ink)'};
      background:${i===1?'var(--plum-wash)':'var(--surface)'};">${l}</div>`).join('')}
  </div>
  <div class="section-t">题目数量</div>
  <div style="display:flex;gap:9px">
    ${[5,10,15].map((n,i)=>`
    <div style="padding:9px 24px;border-radius:var(--r-full);font-size:13px;
      border:1.5px solid ${i===1?'var(--plum)':'var(--line)'};
      color:${i===1?'var(--plum-deep)':'var(--ink)'};
      background:${i===1?'var(--plum-wash)':'var(--surface)'};">${n} 题</div>`).join('')}
  </div>
  <div class="compliance-note">AI 面试仅供练习，不代表真实招聘评估结果。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['plum lg block','✦ 开始模拟面试'])}
</div>`)

// ── p35  模拟面试-答题中 ──────────────────────────────────────────
frame('p35  答题中', `<div class="ph">
<div class="statusbar light" style="background:#3d3270"><span>9:41</span>
  <div class="sb-icons">📶 5G 🔋</div></div>
<div class="navbar light" style="background:#3d3270;border-bottom:none">
  <div class="nav-back" style="color:#fff">‹</div>
  <div class="nav-title" style="color:#fff">第 3 / 10 题</div>
  <div class="nav-right" style="font-size:12px;color:rgba(255,255,255,.75)">前端工程师</div>
</div>
<div class="content has-bar">
  <div class="progress" style="margin-top:4px">
    <i style="width:30%"></i></div>
  <div class="card" style="margin-top:6px">
    <div class="card-inner">
      <div style="font-size:15px;font-weight:600;color:var(--ink);line-height:1.6">
        请介绍一个你主导推进的复杂项目，遇到了什么困难，你是如何解决的？</div>
      <div style="font-size:12px;color:var(--muted);margin-top:12px;padding-top:12px;
        border-top:1px solid var(--line-faint)">
        💡 参考 STAR 法则：情境 → 任务 → 行动 → 结果</div>
    </div>
  </div>
  <textarea style="width:100%;min-height:140px;background:var(--surface);
    border-radius:var(--r-lg);padding:15px;font-size:14px;color:var(--ink);
    line-height:1.7;border:1.5px solid var(--line);resize:none;
    font-family:inherit;box-sizing:border-box" placeholder="输入你的回答…"></textarea>
  <div style="font-size:11.5px;color:var(--faint);text-align:right">0 字</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['plum lg block','提交回答'])}
</div>`)

// ── p36  面试复盘报告 ─────────────────────────────────────────────
frame('p36  面试复盘', `<div class="ph">
${nav('面试反馈报告','#614870',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(155deg,#614870,#7a5a86);
    padding:22px 20px 48px">
    <div class="badge plum" style="margin-bottom:12px">✦ AI 评估 · 仅供参考</div>
    <div style="display:flex;align-items:center;gap:18px">
      <div style="font-family:var(--font-serif);font-size:44px;font-weight:700;
        color:#fff;line-height:1">78<small style="font-size:16px;opacity:.65;font-weight:400">/100</small></div>
      <div>
        <div style="font-family:var(--font-serif);font-size:17px;font-weight:700;color:#fff">
          表现不错</div>
        <div style="font-size:12px;color:rgba(255,255,255,.72);margin-top:5px;line-height:1.5">
          回答条理清晰，建议加强结果量化。</div>
      </div>
    </div>
  </div>
  <div class="card" style="margin:-30px 16px 0;position:relative">
    <div class="card-inner">
      ${[['表达逻辑',82,''],['专业深度',75,''],
         ['结构化',64,'clay'],['应变能力',80,'']].map(([n,v,cls])=>`
      <div style="display:flex;align-items:center;gap:11px;padding:9px 0;
        border-bottom:1px solid var(--line-faint)">
        <div style="width:72px;font-size:13px;color:var(--ink-soft);flex-shrink:0">${n}</div>
        <div class="meter${cls?' '+cls:''}"><i style="width:${v}%"></i></div>
        <div style="width:28px;text-align:right;font-family:var(--font-serif);
          font-weight:700;font-size:14px;color:var(--${cls||'teal'})">${v}</div>
      </div>`).join('')}
    </div>
  </div>
  <div class="section-t">逐题点评</div>
  <div class="card">
    <div style="padding:13px 15px;border-bottom:1px solid var(--line-faint)">
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;
        background:#e9f6f1;color:#1a6b5a;padding:2px 9px;border-radius:var(--r-full)">
        ✓ 回答亮眼</span>
      <div style="font-size:13.5px;font-weight:600;color:var(--ink);margin:8px 0 8px">
        Q2. 如何把首屏加载从 3.2s 降到 1.4s？</div>
      <div class="evidence-quote"><div class="eq-label">你的回答要点</div>
        <div class="eq-text">路由懒加载、图片 CDN + WebP、接口缓存</div></div>
      <div class="notice plum" style="margin-top:9px"><span>✦</span>
        <div>手段完整、有明确数据对比，是很好的 STAR 式回答。</div></div>
    </div>
    <div style="padding:13px 15px">
      <span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;
        background:#fdf1e6;color:#9c5a24;padding:2px 9px;border-radius:var(--r-full)">
        ↑ 可提升</span>
      <div style="font-size:13.5px;font-weight:600;color:var(--ink);margin:8px 0 8px">
        Q3. 团队意见冲突时你会怎么处理？</div>
      <div style="font-size:13px;color:var(--muted);line-height:1.65">
        回答偏笼统，建议用 <b style="color:var(--ink)">具体事例 + 结果</b> 支撑。</div>
    </div>
  </div>
  <div class="compliance-note">本报告由 AI 生成，仅用于练习参考。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['ghost-ink','📄 打印报告'],['plum','✦ 再练一次'])}
</div>`)

// ── p37  岗位匹配-结果 ────────────────────────────────────────────
frame('p37  岗位匹配', `<div class="ph">
${nav('岗位匹配分析','#183a32',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(135deg,#183a32,#1f9e86);
    border-radius:16px;padding:22px;display:flex;align-items:center;gap:20px;margin-top:4px">
    <div style="width:76px;height:76px;border-radius:50%;
      border:5px solid rgba(255,255,255,.25);display:flex;flex-direction:column;
      align-items:center;justify-content:center;flex-shrink:0">
      <div style="font-family:var(--font-serif);font-size:26px;font-weight:700;color:#fff;line-height:1">76%</div>
      <div style="font-size:11px;color:rgba(255,255,255,.55)">匹配</div>
    </div>
    <div style="flex:1">
      <div style="font-size:14.5px;font-weight:700;color:#fff">前端工程师（React）</div>
      <div style="font-size:12px;color:rgba(255,255,255,.65);margin-top:5px">
        某互联网公司 · 来源：第三方平台</div>
      <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:7px">
        匹配度由 AI 分析生成，仅供参考。</div>
    </div>
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:700;color:var(--teal);letter-spacing:1px;
      padding:10px 15px;background:var(--paper);border-bottom:1px solid var(--line-faint)">
      ✓ 优势</div>
    ${['具备 React / TypeScript 核心技能，与岗位高度吻合',
       '有性能优化实战经验，首屏时间可量化',
       '工作年限与目标层级匹配'].map(t=>`
    <div style="display:flex;gap:12px;padding:11px 15px;
      border-bottom:1px solid var(--line-faint)">
      <span style="color:var(--teal);font-size:14px;flex-shrink:0">✓</span>
      <div style="font-size:13px;color:var(--ink);line-height:1.5">${t}</div>
    </div>`).join('')}
    <div style="font-size:11px;font-weight:700;color:var(--wheat);letter-spacing:1px;
      padding:10px 15px;background:var(--paper);border-bottom:1px solid var(--line-faint)">
      △ 差距</div>
    ${['简历中未体现 Node.js 后端经验（岗位加分项）',
       '缺少移动端 / 小程序开发案例'].map(t=>`
    <div style="display:flex;gap:12px;padding:11px 15px;
      border-bottom:1px solid var(--line-faint)">
      <span style="color:var(--wheat);font-size:14px;flex-shrink:0">△</span>
      <div style="font-size:13px;color:var(--ink);line-height:1.5">${t}</div>
    </div>`).join('')}
  </div>
  <div class="notice info"><span>✦</span>
    <div>建议在技能栏补充 Node.js 相关经验，即便是个人项目也有助于提升匹配度。</div>
  </div>
  <div class="compliance-note">匹配度由 AI 分析，仅供参考，不代表招聘方评估。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['ghost-ink','📄 打印分析'],['primary lg','查看该岗位 →'])}
</div>`)

// ── p38  职业规划-结果 ────────────────────────────────────────────
frame('p38  职业规划', `<div class="ph">
${nav('职业规划建议','#183a32',true)}
<div class="content has-bar">
  <div style="background:linear-gradient(155deg,#4a6a5c,#1f9e86);
    border-radius:16px;padding:22px;margin-top:4px">
    <div class="badge teal" style="margin-bottom:10px">✦ AI 规划建议 · 仅供参考</div>
    <div style="font-family:var(--font-serif);font-size:20px;font-weight:700;color:#fff">
      前端 → 全栈工程师成长路径</div>
    <div style="font-size:12.5px;color:rgba(255,255,255,.72);margin-top:7px;line-height:1.6">
      结合你的背景与意向，以下方向匹配度较高，供参考。</div>
    <div style="font-size:11px;color:rgba(255,255,255,.4);margin-top:10px;line-height:1.5">
      职业规划由 AI 生成，仅供参考，不代表真实职业发展保障。</div>
  </div>
  ${[['TOP 1','全栈工程师','高匹配','teal',
      '技术栈覆盖面广，有 React 基础可快速延伸 Node.js 全栈。',
      ['补充 Node.js 项目','学习 Docker/CI','积累后端 PR']],
     ['TOP 2','前端技术专家','中匹配','plum',
      '专注前端深度，进阶架构与性能优化方向。',
      ['深化性能专项','参与开源贡献','输出技术博文']]]
    .map(([rank,title,fit,c,reason,steps])=>`
  <div class="card">
    <div class="card-inner">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="font-size:12px;font-weight:700;color:var(--${c})">${rank}</div>
        <div style="flex:1;font-size:15px;font-weight:700;color:var(--ink)">${title}</div>
        <span class="badge ${c}">${fit}</span>
      </div>
      <div style="font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:10px">${reason}</div>
      <div style="display:flex;flex-wrap:wrap;gap:7px">
        ${steps.map(s=>`<span class="chip">${s}</span>`).join('')}
      </div>
    </div>
  </div>`).join('')}
  <div class="compliance-note">规划建议由 AI 生成，仅供参考，不构成专业意见。</div>
  <div class="spacer-lg"></div>
</div>
${actionbar(['ghost-ink','📄 打印规划'],['primary lg','✦ 重新生成'])}
</div>`)

// ── 删除旧占位注释行（文件头部的遗留标记） ──────────────────────────

// ── HTML / CSS 生成 ───────────────────────────────────────────────
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>智达小程序 · AI工具 pages 29-38 预览</title>
<link rel="stylesheet" href="mini-preview-ai.css">
</head>
<body>
<div style="width:100%;text-align:center;padding:0 0 32px;color:#8a978f;
  font-family:-apple-system,'PingFang SC',sans-serif">
  <h1 style="font-size:20px;font-weight:700;color:#c8cfc9;margin:0 0 6px;letter-spacing:2px">
    智达 · AI 工具 pages 29–38</h1>
  <p style="font-size:13px;margin:0">
    shared.css 真实组件 · ${frames.length} frames · 390×812</p>
</div>
${frames.map(f=>`
<div class="fw">
  <div class="fl">${f.label}</div>
  <div class="shell">${f.html}</div>
</div>`).join('\n')}
</body>
</html>`

const css = `/* mini-preview-ai.css — auto-generated by build-ai-preview.js */
/* gallery wrapper */
${galleryCss}
/* shared.css scoped: #stage → .ph */
${scopedCss}
`

fs.writeFileSync(OUT_HTML, html, 'utf8')
fs.writeFileSync(OUT_CSS,  css,  'utf8')
console.log('✅  ' + OUT_HTML)
console.log('✅  ' + OUT_CSS)
console.log('    ' + frames.length + ' frames')
