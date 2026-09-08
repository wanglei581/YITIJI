# 任务包：按青序流光稿把多余的屏合掉

产品负责人 2026-09-08 裁决：一体机操作步数太多，页面之间不统一，
要求把「多余的页面或没有价值的功能」合并掉。

依据文档（已在 main）：
`docs/reviews/kiosk-route-vs-design-page-audit-2026-09-08.md`

核心事实：Kiosk 活路由 79 个，青序流光稿 51 张。稿刻意把「一个流程拆 N 个路由」
画成「一张工作台 + N 个状态」，代码没跟上。

## 绝对禁止改的路径（越界直接判 FAIL）

- `apps/miniapp/**`
- `.github/**`
- 仓库根 `scripts/verify-*`（门禁基础设施）
- `services/api/**` 的部署脚本
- `apps/kiosk/src/pages/resume/**` 与 `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
  （归「简历优化功能完善」会话）

`apps/kiosk/scripts/verify-*` 是页级契约，**可以改但只许同强度替换**：
`git diff origin/main...HEAD -- apps/kiosk/scripts/ | grep -c '^-.*assert\.'` 必须是 **0**。

## 六条硬验收（缺一不合入，和之前每一页一样）

① 按对应稿实现 + 1080×1920 截图对照；主按钮 ≥56px，可点区 ≥48px
② 每个按钮有真实去向或动作，没有死按钮、没有占位
③ 读真实接口，空/错/载三态齐全；不伪造「已完成/已保存/已打印」
④ 该页承诺的产出真的产生
⑤ 按钮文案在合规白名单内（查看岗位/去来源平台投递/扫码投递/查看招聘会/
   去来源平台预约/扫码预约/复制来源链接）
⑥ 路由 E2E 用例 + 该页专属断言进 CI，绿才合

**外加两条本次专属：**

⑦ **合并不许丢能力。** 被合掉的路由上每一个控件、每一个状态、每一条错误提示，
   必须在新页上还能找到。写一张「旧控件 → 新落点」对照表进 PR 描述。
   做不到的那一项，就不要合那一项 —— 宁可少合，不许悄悄砍功能。
⑧ **旧路由必须保留为 `Navigate ... replace` 重定向**，不许直接删。
   参照 `apps/kiosk/src/routes/index.tsx:229` 的 `/print/params` 先例，
   并在旁边写下线理由的注释。收藏夹、二维码、外部链接可能指向旧地址。

## 第一步先查图谱（CLAUDE.md §14，跳过判 FAIL）

对每个要改的文件先跑：
```
node scripts/project-graph-query.mjs file <路径>
node scripts/project-graph-query.mjs route <路由>
```
图谱只是预筛不是权威，`GATE_EXT_PATTERN` 曾漏掉全部 `.ts` 门禁。
图谱没报的门禁**不构成不跑它的理由**。

## 各自的活

### LANE-A：打印台合并（稿 13-print-desk）

把 `/print/material-check`（`PrintMaterialCheckPage.tsx`, 572 行）与
`/print/preview`（`PrintPreviewPage.tsx`, 582 行）合成**一个路由 `/print/desk`**，
两者变成同一页的两个阶段。

稿内证据（`13-print-desk.html` 的 `PILL` 表）：
```
'check-loading' : '第 2 步 / 共 4 步 · 正在检查'
'check-clean'   : '第 2 步 / 共 4 步 · 检查完成'
'check-flagged' : '第 2 步 / 共 4 步 · 3 处待裁决'
'preview'       : '第 3 步 / 共 4 步 · 预览与参数'
```
一个文件里既是第 2 步又是第 3 步。稿写的是**共 4 步**（选文件→检查→预览→确认）。

要求：
- 阶段切换**不产生新的历史条目**，返回键按稿指向「返回选文件」→ `/print/upload`
- 检查未过时不许进入预览阶段（现在是两个路由，可以直接输 URL 跳过检查 —— 顺手堵上）
- `/print/material-check` 与 `/print/preview` 都重定向到 `/print/desk`
- 合并后单文件会超 800 行，按 `.ccg/spec/guides/index.md` 拆子组件，
  别堆成一个 1100 行的文件

### LANE-B：自我探索合并（稿 34-self-assessment）

把 `/resume/self-assessment/{intro,questions,result,history}` 四个路由合成一个
`/resume/self-assessment`，四个阶段变状态。

稿内证据：`34-self-assessment.html` 的状态键是 `intro` / `questions` / `result` /
`review`，**和四个路由段逐字对应**。

注意：`history` 对应稿里的 `review`。四个旧路由全部保留为重定向。

### LANE-C：审计复核（纯推理，不碰仓库）

读 `docs/reviews/kiosk-route-vs-design-page-audit-2026-09-08.md`，
对抗性复核这三件事，只输出结论不改代码：

1. 第 2.6 节「招聘会 7→1」是不是过度推断？稿 28 的 7 个状态
   （index/loading/ready/preview/qr/requested/documents-ready）看起来像是
   **一个子功能的状态机**（材料打印？），而不是 7 个子页。
   如果是，这条要从建议清单里撤下来或大幅缩小。
2. 逐条检查五个合并建议里，有没有哪一个会导致 CLAUDE.md §9A 点名的能力消失，
   或者削弱合规边界（岗位/招聘会只做第三方入口、不做平台内投递）。
3. 有没有我漏掉的合并机会 —— 特别是 79 个活路由里**根本没有对应稿**的那些，
   它们是不是本来就该下线。路由清单在审计文档里没有全列，自己从
   `apps/kiosk/src/routes/index.tsx` 取。

### LANE-D：找无入口的死路由

在 `apps/kiosk/src` 里找**没有任何页面能导航到**的活路由 —— 即没有任何
`navigate('/x')` / `<Link to="/x">` / `data-route="/x"` 指向它。
这类路由用户永远走不到，是纯维护负担。

输出：路由 → 有没有入口 → 若无，建议下线还是补入口。
先别删，先给清单。

## 报告格式

每条按「结论 + 证据（文件:行 或 命令输出）」写。
不要写「应该」「可能」「建议进一步」。做不了的直接说做不了和为什么。

---

# 【2026-09-08 修订】agy 复核后的三条改动，覆盖上面的原文

## 修订一：推翻原第 ⑧ 条「旧路由一律保留为 replace 重定向」

**原要求有害。** 裸的 `<Navigate to="/print/desk" replace />` 会把从
`/print/preview` 深链进来的用户**静默重置到第 1 步**，比直接报错更难排查
——用户以为自己回到了预览，实际参数全没了。

**改成：重定向必须带状态透传。**

```tsx
{ path: 'print/material-check', element: <Navigate to="/print/desk?step=check" replace /> },
{ path: 'print/preview',        element: <Navigate to="/print/desk?step=preview" replace /> },
```

新页读 `?step=` 决定进哪个阶段，读不到才回默认。并且：**能不能进那个阶段仍由
真实前置条件说了算**（检查没过就不许落到 preview，`?step=preview` 也不行）——
URL 是意图，不是授权。

## 修订二：状态必须能从 sessionStorage 复水，不许只活在内存

一体机有看门狗会自动 reload，夜里也有定时刷新。原来两个路由靠 URL 记住走到哪，
合成一页后如果状态只在 React state 里，**一次刷新就跌回第 1 步**——
用户要是已经扫码付过钱，这就是死局。

好消息：**这条现在已经是对的，别改坏它。** `apps/kiosk/src/pages/print/printMaterialSession.ts`
（**冻结文件，一个字节都不许动**）已经把流程状态写进 `sessionStorage`，
有 `readPrintMaterialSession` / `savePrintMaterialSession` / `patchPrintMaterialSession`。

要求：合并后的页**首屏就从 `readPrintMaterialSession()` 复水**，
刷新后回到用户原来所在的阶段。E2E 要有一条断言钉死：
走到 preview 阶段 → `page.reload()` → 仍在 preview 阶段，不是 check。

## 修订三：换人清场必须仍然生效

`apps/kiosk/src/auth/kioskSensitiveSession.ts:33` 会调 `clearPrintMaterialSession()`。
这是**集中式清理**，不依赖路由 unmount ——所以合并路由不会引入隐私残留。

要求：不许把清理逻辑改成挂在组件 unmount 上。合并后仍走
`kioskSensitiveSession`。E2E 断言：触发敏感会话失效 → 新页回到空态，
读不到上一个人的文件名。

## 另：招聘会那条已撤销

原第 2.6 节「招聘会 7→1」经复核是**过度推断**。稿 28 的 7 个状态
（index/loading/ready/preview/qr/requested/documents-ready）是
**「活动资料申领」这一个子功能的事务状态机**，只对应 `/job-fairs/:id/materials`
一条路由，不是 7 个子页。`/map`（展位导览）、`/companies`（参会企业名录）、
`/stats` 是 CLAUDE.md §9A 点名的独立能力，不参与合并。

这条不在你的活里，写在这里是防止你顺手去动招聘会。
