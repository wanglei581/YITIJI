# 青序 LightFlow 三主 Tab 4188 布局一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (\`- [ ]\`) syntax for tracking.

**Goal:** 让首页、AI 助手和“我的”三个主 Tab 使用用户指定 4188 服务台的同一功能导航、面板层级和响应式排版，同时不改变任何真实业务闭环。

**Architecture:** 新增一个仅负责分类导航的 \`ReferenceServiceNav\`，并以两个局部 CSS 文件定义三页共用的五个布局原语。首页、AI 助手和 Profile 保留各自的数据、路由和交互实现，只把原有分组骨架替换为上述原语；跨页静态守卫同时确认共享结构、SPA hash 行为和原有真实性合同。

**Tech Stack:** React 18、React Router 7、TypeScript、Vite、现有 KIcon、Node 静态 verify 脚本、ESLint、TypeScript。

---

## 不可突破的范围

- 不改 \`services/api/**\`、数据库、终端 Agent、认证协议、TRTC 协议、支付、打印状态机、Admin、Partner 或 \`legacy-miaoda/**\`。
- 不改 \`/me/*\` 路由、\`me-detail-inkpaper.css\` 和任何明细页；Profile 只重排 \`/profile\` 入口页。
- 首页 \`service-value\` Hero、\`IdentityPanel\`、\`ContinuePanel\`、真实登录弹窗、顶部状态和底部三 Tab 必须原样保留，且次序为 \`IdentityPanel → ContinuePanel → ReferenceServiceNav\`。
- 岗位与招聘会继续只作来源平台入口；不得新增投递、预约、支付、候选人推荐等闭环文案或操作。

## 文件归属与顺序

| 任务 | 文件归属 | 前置 | 可并行 |
| --- | --- | --- | --- |
| 1 | \`apps/kiosk/src/components/lightflow/**\`、跨页 verify 初稿 | 无 | 否 |
| 2 | \`apps/kiosk/src/pages/home/**\`、\`verify-home-service-desk.mjs\` | 任务 1 | 与任务 3、4 并行 |
| 3 | \`apps/kiosk/src/pages/assistant/**\`、\`verify-lightflow-k2a-ai-career.mjs\` | 任务 1 | 与任务 2、4 并行 |
| 4 | \`apps/kiosk/src/pages/profile/{ProfilePage,profileEntries,components/**,profile-inkpaper.css,profile-lightflow-*.css}\`、两个 Profile verify | 任务 1 | 与任务 2、3 并行 |
| 5 | \`apps/kiosk/package.json\`、\`.github/workflows/ci.yml\`、跨页 verify、进度文档 | 任务 2、3、4 | 否 |

每个任务完成后只暂存其所属文件；不得 \`git add .\`。任务 2、3、4 只能在任务 1 提交后同时开始，三个任务不能修改彼此归属的文件。

### Task 1: 建立共享 4188 导航与布局合同

**Files:**

- Create: \`apps/kiosk/src/components/lightflow/ReferenceServiceNav.tsx\`
- Create: \`apps/kiosk/src/components/lightflow/reference-service-nav.css\`
- Create: \`apps/kiosk/src/components/lightflow/reference-layout.css\`
- Create: \`apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs\`

- [ ] **Step 1: 先写跨页静态守卫，并确认它在旧页面上失败**

读取 \`HomePage.tsx\`、\`AssistantPage.tsx\`、\`ProfilePage.tsx\` 和三个共享文件。逐页断言：导入并渲染 \`ReferenceServiceNav\`，同时出现五个共享 class；断言 CSS 仅有三种页面根作用域，并提供桌面和 390px 规则。

\`\`\`js
const requiredClasses = [
  'lf-reference-panel',
  'lf-reference-group-head',
  'lf-reference-primary',
  'lf-reference-secondary',
  'lf-reference-pair',
]

for (const [name, source] of Object.entries({ home, assistant, profile })) {
  expect(source.includes('ReferenceServiceNav'), \`\${name} 共享顶部分类导航\`)
  for (const className of requiredClasses) {
    expect(source.includes(className), \`\${name} 使用 \${className}\`)
  }
}
\`\`\`

Run: \`node apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs\`

Expected: FAIL，提示共享组件及五个 class 尚不存在；这是允许的 RED 状态。

- [ ] **Step 2: 实现无刷新的统一导航组件**

固定输出六个标签和 hash；点击时只做 SPA 跳转，绝不写 \`<a href="/#…">\` 或 \`window.location\`。组件接口不接受业务数据，不复制页面入口。

\`\`\`tsx
export const REFERENCE_SERVICE_ITEMS = [
  { label: '简历服务', hash: '#resume' },
  { label: '岗位信息', hash: '#jobs' },
  { label: '招聘会', hash: '#job-fairs' },
  { label: '打印扫描', hash: '#print-scan' },
  { label: '面试训练', hash: '#interview' },
  { label: '政策服务', hash: '#policy' },
] as const

export function ReferenceServiceNav() {
  const navigate = useNavigate()
  return (
    <nav className="reference-service-nav" aria-label="服务分类">
      {REFERENCE_SERVICE_ITEMS.map((item) => (
        <button key={item.hash} type="button"
          onClick={() => navigate({ pathname: '/', hash: item.hash })}>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
\`\`\`

- [ ] **Step 3: 用两个共享 CSS 文件实现唯一布局原语**

\`reference-service-nav.css\` 只处理导航：桌面六等分、底部细分隔线、390px 三列两行、48px 最小触控高度。 \`reference-layout.css\` 只处理五个原语：白色扁平面板、56px 图标分组头、104px 双列主入口、80px 分隔线次入口，以及桌面两列 / 窄屏单列的工作面板。

\`\`\`css
.khome .reference-service-nav,
.kassist.kassist-lightflow .reference-service-nav,
.kprofile.kprofile-lightflow .reference-service-nav { /* six columns */ }

.khome .lf-reference-primary,
.kassist.kassist-lightflow .lf-reference-primary,
.kprofile.kprofile-lightflow .lf-reference-primary { min-height: 104px; }

@media (max-width: 500px) {
  .khome .reference-service-nav,
  .kassist.kassist-lightflow .reference-service-nav,
  .kprofile.kprofile-lightflow .reference-service-nav {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .khome .lf-reference-pair,
  .kassist.kassist-lightflow .lf-reference-pair,
  .kprofile.kprofile-lightflow .lf-reference-pair { grid-template-columns: 1fr; }
}
\`\`\`

禁止 \`html\`、\`body\`、\`:root\`、\`.me-inkdetail\`、无页面根前缀的 selector 或大型投影 / 纸纹。

- [ ] **Step 4: 再跑 RED 守卫，确认失败只来自尚未迁移的三页**

Run: \`node apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs\`

Expected: FAIL，且失败信息只涉及 Home / Assistant / Profile 未引入结构；组件、标签序列和 CSS 根作用域断言通过。

- [ ] **Step 5: 复核并提交基础层**

Run: \`pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint && git diff --check\`

Expected: PASS。

\`\`\`bash
git add apps/kiosk/src/components/lightflow/ReferenceServiceNav.tsx \\
  apps/kiosk/src/components/lightflow/reference-service-nav.css \\
  apps/kiosk/src/components/lightflow/reference-layout.css \\
  apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs
git commit -m "feat(kiosk): add shared 4188 service layout"
\`\`\`

### Task 2: 将首页服务目录改为 4188 的功能顺序

**Files:**

- Modify: \`apps/kiosk/src/pages/home/HomePage.tsx\`
- Modify: \`apps/kiosk/src/pages/home/home-service-desk.css\`
- Modify: \`apps/kiosk/src/pages/home/styles/home-services.css\`
- Modify: \`apps/kiosk/src/pages/home/styles/home-responsive.css\`
- Modify: \`apps/kiosk/scripts/verify-home-service-desk.mjs\`

- [ ] **Step 1: 先把首页守卫改成目标结构并确认 RED**

保留原有 Hero、设备状态、登录弹窗、百宝箱、智慧校园、路线与合规断言；将仅检查 \`service-quick-nav\` / 旧大圆角卡片的视觉断言改为：\`ReferenceServiceNav\`、\`useLocation\` + hash \`scrollIntoView\`、六个目标锚点、AI 简历双主入口、岗位与招聘会 \`lf-reference-pair\`。

\`\`\`js
for (const id of ['resume', 'jobs', 'job-fairs', 'print-scan', 'interview', 'policy']) {
  expectMatches(home, new RegExp(\`id=["']\${id}["']\`), \`首页保留 #\${id} 锚点\`)
}
expectMatches(home, /AI简历诊断[\\s\\S]{0,140}AI简历优化/, 'AI 简历首行双主入口')
expectMatches(home, /className="lf-reference-pair"[\\s\\S]{0,500}岗位信息[\\s\\S]{0,900}招聘会/, '岗位与招聘会同列')
\`\`\`

Run: \`pnpm --filter @ai-job-print/kiosk verify:home-service-desk\`

Expected: FAIL，提示新导航、hash 和面板骨架未到位；原有真实性断言不得删除。

- [ ] **Step 2: 在首页接入共享导航和 hash 滚动**

导入 \`useLocation\`、\`useEffect\` 和 \`ReferenceServiceNav\`。对 hash 白名单做一次效果处理，不在每次渲染滚动，不硬刷新，也不访问不存在节点。

\`\`\`tsx
const { hash } = useLocation()

useEffect(() => {
  const target = hash ? document.getElementById(hash.slice(1)) : null
  target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}, [hash])
\`\`\`

保留原 \`SERVICE_GROUPS\` 的真实路由、disabled、source 提示和行为。岗位大师必须继续跳转 \`/resume/job-fit\`。

- [ ] **Step 3: 重排服务内容但不复制入口数据**

用首页局部 helper 消费现有 \`SERVICE_GROUPS\`：\`#resume\` 全宽（诊断 / 优化两主入口，四项两两次入口）；\`lf-reference-pair\` 左侧 \`#jobs\`（全部岗位主入口与五项次入口），右侧 \`#job-fairs\`（社会招聘会主入口、校园招聘会与扫码签到次入口）；\`#print-scan\`、\`#interview\`、\`#policy\` 按同一面板继续，随后百宝箱、智慧校园、合规脚注。

每个按钮仍用现有 \`onClick\`、\`itemLaunchable\`、\`itemBadge\` 与 route，不复制路由数组，不改变来源平台行为。

- [ ] **Step 4: 将首页 CSS 限定为参考布局**

移除服务区的胶囊导航、18px/26px 目录大圆角、深蓝大主卡和大阴影。保留 Hero、身份卡、继续办理、百宝箱、智慧校园。首页 CSS 只能补充内容特有 icon / 描述，不能重定义共享五原语。

- [ ] **Step 5: 运行首页回归并提交**

Run: \`pnpm --filter @ai-job-print/kiosk verify:home-service-desk && pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui && pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint\`

Expected: PASS，且结构次序仍为 \`IdentityPanel → ContinuePanel → ReferenceServiceNav\`。

\`\`\`bash
git add apps/kiosk/src/pages/home/HomePage.tsx \\
  apps/kiosk/src/pages/home/home-service-desk.css \\
  apps/kiosk/src/pages/home/styles/home-services.css \\
  apps/kiosk/src/pages/home/styles/home-responsive.css \\
  apps/kiosk/scripts/verify-home-service-desk.mjs
git commit -m "feat(kiosk): align home services with 4188 layout"
\`\`\`

### Task 3: 将 AI 助手从工作台侧栏改为同一服务面板

**Files:**

- Modify: \`apps/kiosk/src/pages/assistant/AssistantPage.tsx\`
- Modify: \`apps/kiosk/src/pages/assistant/assistant-inkpaper.css\`
- Modify: \`apps/kiosk/src/pages/assistant/assistant-lightflow-shell.css\`
- Modify: \`apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css\`
- Modify: \`apps/kiosk/src/pages/assistant/assistant-lightflow-content.css\`
- Modify: \`apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs\`

- [ ] **Step 1: 先把 AI 静态守卫收紧为新骨架**

保留 \`chatWithAssistant\`、路由白名单、TRTC 懒加载 / 挂断、模式切换、消息发送、虚拟键盘、错误提示与“仅供参考”。新增共享导航 / 五原语断言，拒绝可见 \`a-hero\`、\`assistant-workbench\`、\`assistant-service-catalog\`。

\`\`\`js
expectIncludes(page, '<ReferenceServiceNav />', 'AI 助手渲染共享导航')
expectAbsent(page, 'assistant-service-catalog', 'AI 助手不再使用右侧服务栏')
expectAbsent(page, 'a-hero assistant-service-intro', 'AI 助手不再使用营销 Hero')
expectIncludes(page, 'chatWithAssistant', '保留真实 AI 对话请求')
expectIncludes(page, 'LazyCallPanel', '保留 TRTC 懒加载通话面板')
\`\`\`

Run: \`pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career\`

Expected: FAIL，且现有 AI 真实性合同仍全绿。

- [ ] **Step 2: 在不改对话状态机的前提下替换 JSX 骨架**

移除可见营销 Hero 和“左工作台 + 右侧栏”。状态、effect、\`sendMessage\`、\`callActive\`、\`keyboardOpen\`、\`LazyCallPanel\` 不迁移逻辑。新序列：共享导航 → 全宽当前会话 → 模式主入口 → 聊天面板 → 快捷任务次入口 → FAQ 次入口 → 结果去向说明 → 原合规说明与键盘。

\`\`\`tsx
<ReferenceServiceNav />
<section className="lf-reference-panel" aria-label="当前会话">
  <div className="lf-reference-group-head">{/* 会话说明 */}</div>
  <div className="lf-reference-pair">{/* 文字 / 语音模式按钮 */}</div>
  <section className="assistant-chat-panel" aria-live="polite">{/* 原消息列表与输入框 */}</section>
</section>
\`\`\`

模式按钮仍调用 \`setCallActive\` / \`inputRef.current?.focus()\`；快捷任务仍 \`navigate(task.route)\`；FAQ 仍 \`sendMessage(q)\`。

- [ ] **Step 3: 清理旧壳层视觉，保留可用状态样式**

移除或替换旧 \`a-hero\`、\`assistant-service-desk\`、\`assistant-workbench\`、\`assistant-service-catalog\` 规则。聊天气泡、输入区、加载态、通话面板、键盘和 reduced-motion 都留在 \`.kassist.kassist-lightflow\` 作用域，业务专有样式不移入共享 CSS。

- [ ] **Step 4: 运行 AI 回归并提交**

Run: \`pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career && pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard && pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint\`

Expected: PASS；无可见 AI助手标题、无营销 Hero、无右栏，TRTC 仍由环境开关控制。

\`\`\`bash
git add apps/kiosk/src/pages/assistant/AssistantPage.tsx \\
  apps/kiosk/src/pages/assistant/assistant-inkpaper.css \\
  apps/kiosk/src/pages/assistant/assistant-lightflow-shell.css \\
  apps/kiosk/src/pages/assistant/assistant-lightflow-chat.css \\
  apps/kiosk/src/pages/assistant/assistant-lightflow-content.css \\
  apps/kiosk/scripts/verify-lightflow-k2a-ai-career.mjs
git commit -m "feat(kiosk): align assistant with 4188 layout"
\`\`\`

### Task 4: 将“我的”入口页改为同一目录式功能排版

**Files:**

- Modify: \`apps/kiosk/src/pages/profile/ProfilePage.tsx\`
- Modify: \`apps/kiosk/src/pages/profile/profileEntries.ts\`
- Modify: \`apps/kiosk/src/pages/profile/components/ProfileHeader.tsx\`
- Modify: \`apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx\`
- Modify: \`apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx\`
- Modify: \`apps/kiosk/src/pages/profile/profile-inkpaper.css\`
- Create: \`apps/kiosk/src/pages/profile/profile-lightflow-shell.css\`
- Create: \`apps/kiosk/src/pages/profile/profile-lightflow-directory.css\`
- Create: \`apps/kiosk/src/pages/profile/profile-lightflow-state.css\`
- Modify: \`apps/kiosk/scripts/verify-lightflow-profile-entry.mjs\`
- Modify: \`apps/kiosk/scripts/verify-profile-inkpaper-home.mjs\`

- [ ] **Step 1: 先把两条 Profile 守卫改成目标合同并确认 RED**

\`verify:lightflow-profile-entry\` 断言共享导航 / 五原语 / 无可见“我的”标题 / \`/me/*\` 路由不变。 \`verify:profile-inkpaper-home\` 读取聚合 CSS 与三份分片，逐份拒绝全局 selector，并断言旧 \`p-hero + sec-head\` 不再是入口页骨架。

\`\`\`js
const profileCssFiles = [
  'src/pages/profile/profile-inkpaper.css',
  'src/pages/profile/profile-lightflow-shell.css',
  'src/pages/profile/profile-lightflow-directory.css',
  'src/pages/profile/profile-lightflow-state.css',
]
for (const path of profileCssFiles) {
  expectAbsent(read(path), /(^|\\n)\\s*(html|body|:root)\\b/, \`\${path} 不污染全局\`)
  expectAbsent(read(path), /\\.me-inkdetail/, \`\${path} 不触碰 /me 明细样式\`)
}
\`\`\`

逐条保留 27 个 \`label + route/tag\` 断言，尤其两个不同 route 的“权益活动”和三个建设中入口。Run: \`pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry && pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home\`。Expected: FAIL，只因结构和 CSS 分片未到位。

- [ ] **Step 2: 固定目录区和 27 条真实入口**

不复制 route 数据，只重组 \`SECTIONS\`：

1. 我的资产：我的简历为主入口，其余五项次入口；
2. 常用服务：AI 简历服务为主入口，其余七项次入口；
3. 来源与活动：浏览、外部跳转、凭证、两个权益活动、两种套餐、政策；
4. 账户与支持：消息、设置、身份切换、帮助、反馈；
5. 本次服务记录：仅在已有真实会话记录时渲染，保留删除、继续和打印回调。

每项保持既有 \`route\`、\`tag\`、登录门槛和建设中状态。不得把身份切换改为多角色，不得把套餐或活动改成支付入口。

- [ ] **Step 3: 保留 ProfileHeader 真实数据，替换视觉骨架**

\`ProfileHeader\` 继续消费登录、退出、设置、通知、统计与 \`reserveBannerSpace\`，根容器改为 \`lf-reference-panel\` / \`lf-reference-group-head\`，不再输出旧 \`p-hero\`。 \`ProfilePage\` 顺序为共享导航、身份面板、待办、toast、目录、会话记录。

\`\`\`tsx
<ReferenceServiceNav />
<ProfileHeader /* 现有真实 props 原样传入 */ />
<div className="lf-reference-pair">
  <ProfileEntrySection section={assetSection} onTap={handleEntryTap} />
  <ProfileEntrySection section={serviceSection} onTap={handleEntryTap} />
</div>
\`\`\`

- [ ] **Step 4: 将 969 行 Profile CSS 变为本地聚合入口并拆分**

\`profile-inkpaper.css\` 只保留三个 import，其余规则分别移动至壳层、目录、状态；每文件少于 300 行，以 \`.kprofile.kprofile-lightflow\` 开头。不改 \`me-detail-inkpaper.css\`。入口卡只能组合共享原语与 Profile 专有 icon / toast / session record 规则，不能恢复纸纹、米色、墨青或大型投影。

\`\`\`css
@import './profile-lightflow-shell.css';
@import './profile-lightflow-directory.css';
@import './profile-lightflow-state.css';
\`\`\`

- [ ] **Step 5: 运行 Profile 回归并提交**

Run: \`pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry && pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home && pnpm --filter @ai-job-print/kiosk verify:profile-commercial-first-batch && pnpm --filter @ai-job-print/kiosk typecheck && pnpm --filter @ai-job-print/kiosk lint\`

Expected: PASS；27 条入口恰好一次、\`/me/*\` 文件无变更、游客不显示伪造资产。

\`\`\`bash
git add apps/kiosk/src/pages/profile/ProfilePage.tsx \\
  apps/kiosk/src/pages/profile/profileEntries.ts \\
  apps/kiosk/src/pages/profile/components/ProfileHeader.tsx \\
  apps/kiosk/src/pages/profile/components/ProfileEntrySection.tsx \\
  apps/kiosk/src/pages/profile/components/ProfileSessionRecords.tsx \\
  apps/kiosk/src/pages/profile/profile-inkpaper.css \\
  apps/kiosk/src/pages/profile/profile-lightflow-shell.css \\
  apps/kiosk/src/pages/profile/profile-lightflow-directory.css \\
  apps/kiosk/src/pages/profile/profile-lightflow-state.css \\
  apps/kiosk/scripts/verify-lightflow-profile-entry.mjs \\
  apps/kiosk/scripts/verify-profile-inkpaper-home.mjs
git commit -m "feat(kiosk): align profile with 4188 layout"
\`\`\`

### Task 5: 集成静态合同、CI 和最终验收

**Files:**

- Modify: \`apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs\`
- Modify: \`apps/kiosk/package.json\`
- Modify: \`.github/workflows/ci.yml\`
- Modify: \`docs/progress/current-progress.md\`
- Modify: \`docs/progress/next-tasks.md\`
- Modify: \`docs/superpowers/plans/2026-07-14-qingxu-lightflow-4188-layout-parity.md\`

- [ ] **Step 1: 让跨页守卫转绿并覆盖 SPA 合同**

检查六标签顺序、\`navigate({ pathname: '/', hash })\`、首页 \`scrollIntoView\`、三页五原语、无 Assistant 侧栏、无 Profile \`p-hero\`、首页 Hero / Identity / Continue 保留、390px 回退和禁止全局污染；不得删除旧真实性断言。

Run: \`pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity\`

Expected: PASS。

- [ ] **Step 2: 注册命令并接入 CI**

在 \`apps/kiosk/package.json\` 注册：

\`\`\`json
"verify:lightflow-4188-layout-parity": "node scripts/verify-lightflow-4188-layout-parity.mjs"
\`\`\`

在 \`.github/workflows/ci.yml\` 的 \`LightFlow UI static contracts\` 阶段紧接 K2a 调用新命令；不改触发条件、不增加凭证、不移动 API/数据库 verify。

- [ ] **Step 3: 做完整静态、类型和生产构建验证**

Run:

\`\`\`bash
pnpm --filter @ai-job-print/kiosk verify:home-service-desk
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2a-ai-career
pnpm --filter @ai-job-print/kiosk verify:assistant-trtc-guard
pnpm --filter @ai-job-print/kiosk verify:lightflow-profile-entry
pnpm --filter @ai-job-print/kiosk verify:profile-inkpaper-home
pnpm --filter @ai-job-print/kiosk verify:lightflow-k1-public-entry
pnpm --filter @ai-job-print/kiosk verify:lightflow-k2b-ai-resume
pnpm --filter @ai-job-print/kiosk verify:lightflow-4188-layout-parity
pnpm --filter @ai-job-print/kiosk typecheck
pnpm --filter @ai-job-print/kiosk lint
VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 VITE_USE_TRTC_CALL=true VITE_TERMINAL_ID=KSK-001 pnpm build:kiosk:production
git diff --check
\`\`\`

Expected: 全部 PASS。任一失败先修复，再从失败的最小命令重跑，不跳过。

- [ ] **Step 4: 使用用户当前浏览器做三视口人工验收**

在用户选择的 Firefox / 本地 5174 上核对 \`/\`、\`/assistant\`、\`/profile\` 于 1080×1920、390×844、390×700：点击六分类导航、首页 AI / 岗位 / 招聘会入口、助手文字模式与一条 FAQ、Profile 27 条入口和一个建设中状态。验收记录必须区分浏览器结构证明与未复验的真实登录、TRTC、后端、打印、设备。

- [ ] **Step 5: 双模型审查、文档收口和候选提交**

并行运行 Antigravity 前端审查与 Claude 审查，输入最终 \`git diff origin/main...HEAD\`；任何 Critical 必须修复并重新审查。进度文档要明确本批只完成本地候选、静态/构建和浏览器结构验收，不宣称上线或真机完成。

\`\`\`bash
git add apps/kiosk/scripts/verify-lightflow-4188-layout-parity.mjs \\
  apps/kiosk/package.json .github/workflows/ci.yml \\
  docs/progress/current-progress.md docs/progress/next-tasks.md \\
  docs/superpowers/plans/2026-07-14-qingxu-lightflow-4188-layout-parity.md
git commit -m "test(kiosk): verify 4188 layout parity"
\`\`\`

## 最终交付标准

- 三页的功能目录结构、六分类导航、主/次入口和两列工作面板与 4188 参考一致；不是只换色。
- 首页锁定内容和全部真实业务能力不变；AI 会话与 Profile 数据/入口不丢失。
- 八条 Kiosk 静态合同、类型检查、lint、生产构建、\`git diff --check\` 全部通过。
- 浏览器验收、双模型审查结果、未完成的真实服务 / 真机边界均在最终汇报中分层说明。
