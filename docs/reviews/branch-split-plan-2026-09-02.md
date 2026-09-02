# `claude/project-readiness-review-959ffe` 分支拆分清单（2026-09-02）

本文只做一件事：把当前分支相对 `origin/main` 的 **29 个提交 / 298 个改动文件** 拆成可以逐个合入的聚焦 PR，
并逐条说明每个 PR 能让哪条 batch-scope 门禁转绿。

依据 CLAUDE.md §8「治理分支启动规则」：默认从干净 `main` 新建独立分支，从本分支**选择性提取**经过复核的提交与文件；
不复活本分支继续开发。

> **本文档的取证口径**：所有「红/绿」结论都是在本 worktree 用命令实跑得到的，工作区干净（`git status` 为空）。
> 没跑过的一律标注「未验证」，不用「应该」「大概」填空。本文只读，未做任何 git 变更、未改任何代码文件。

---

## 一、结论摘要

1. **红的 batch-scope 门禁是 5 条，不是 3 条。** 实测名单见 §3。任务描述里的「三条」少算了两条
   （`verify:profile-feedback-inkpaper`、`verify:profile-resumes-notifications-inkpaper`）。
2. 另有 2 条同类（同样对 `origin/main...HEAD` 做 allowlist 断言）的守卫**当前是绿的**，
   拆分时不能把它们改红：`verify:profile-inkpaper-home`、`verify:profile-commercial-first-batch`。
3. `verify:fusion-w4`、`verify:fusion-shell`、`verify:kiosk-visual-unity`、`verify:kiosk-runtime-error-boundary`
   **实跑全绿**，确认不是红的。其中 `verify:fusion-w4` 的范围守卫读的是 `git diff HEAD`（工作区），
   **不是** `origin/main...HEAD`，所以它对已提交内容根本不触发——它不是 batch-scope 门禁（见 §3.3）。
4. 拆成下面 17 个 PR 后，**4 条红门禁全部转绿**。
5. 剩下 1 条 —— `verify:lightflow-profile-entry` —— **拆分本身解决不了**。
   它是无条件门禁，其 `/me/*` allowlist 从来没有包含 `MyPrintOrdersPage.tsx`、`MyFeedbackPage.tsx`、`printOrders/**`，
   所以任何触碰这三者的 PR 都会红。这需要一次**人工裁决**，两个选项见 §6。
6. 必须**拆开**的提交有 6 个（`e8a468fca` 横跨 4 个主题最严重），必须**丢弃**的有 1 个（`1bd544ee5` 是空提交）。

---

## 二、事实核验：29 个提交

按时间正序（`git log --oneline --reverse origin/main..HEAD`）。「主题」列对应 §4 的 PR 编号。

| # | sha | 标题 | 文件数 | 主题 |
|---|-----|------|-------|------|
| 1 | `6d74c2f17` | fix(graph): 补齐 lazy 路由与多控制器解析 | 9 | P1 |
| 2 | `23464350f` | feat(kiosk): 取件码页接入虚拟数字键盘 | 5 | **P3 + P2** |
| 3 | `2f92deb44` | docs(delivery): 建立 kiosk-redesign-r1 交付治理包 | 25 | P2 |
| 4 | `2d9f73c1b` | docs(design): kiosk-redesign-2026-08 入库（51 页上线口径原型） | 84 | P2 |
| 5 | `85741b5a5` | docs(delivery): 关闭 BL-04（51 页原型已入库） | 1 | P2 |
| 6 | `f2a0b1cc5` | docs(review): 四条主链路字段四层核对，确证 4 处缺口 | 1 | P2 |
| 7 | `1135e251d` | feat(kiosk): 建立青序流光设计地基 + 可复用路由截图链路 | 7 | P3 |
| 8 | `859163498` | docs(design): 对齐 51 页原型的接口声明，更正两处误判 | 5 | P2 |
| 9 | `f9d1890ea` | fix(contract): 外露 duplex；更正字段审计里两条误判 | 6 | **P5 + P13 + P2** |
| 10 | `e8a468fca` | feat(kiosk): 取件码页迁移到青序流光 + duplex 收尾 | 19 | **P3 + P5 + P6 + P8** |
| 11 | `8492b02f7` | feat(kiosk): 地基加余量吸收，消除定高屏底部空白 | 5 | **P3 + P4** |
| 12 | `d73abd98c` | fix(print): 按奔图开放打印 API V1.0 官方文档对齐取值 | 2 | P7 |
| 13 | `a72bcdbde` | feat(ai): 简历报告加内容结构与问题证据 | 4 | P8 |
| 14 | `0858ec475` | docs: 清理过期文档，补 51 页施工台账与文档清理台账 | 67 | P2 |
| 15 | `6a850d74e` | fix(kiosk): 打印订单显示优惠额与退款额 | 1 | P6 |
| 16 | `afdbc1df9` | docs(progress): 记录分支拆分要求、6 项待裁决与真机验证清单 | 1 | P2 |
| 17 | `b65645b05` | docs: 清理 65 份过期文档；统一彩色口径 | 7 | **P2 + P7** |
| 18 | `fbc5bd1a2` | docs(device): Q1 从「彩色取值是多少」改为「协议里有没有彩色」 | 1 | P7 |
| 19 | `35cd4f843` | docs(device): 记录彩色与自动双面真机验证通过 | 5 | P7 |
| 20 | `456cd668d` | fix(kiosk): 「我的」9 页给游客免登录出口，单块焦点态改居中 | 13 | **P15 + P16 + P17 + P6 + P2** |
| 21 | `ae972b364` | fix(orgs): 新建机构写入显式 pending，不再留 null | 3 | **P12 + P2** |
| 22 | `14e1b342c` | fix(kiosk): 操作条一体机视口补吸底；修伪造「已保存」；地基裸色令牌化 | 9 | **P3 + P4 + P14 + P2** |
| 23 | `1bd544ee5` | docs: 补记 14e1b342c 里未在信息中说明的岗位字段改动 | **0** | **丢弃** |
| 24 | `ee65ed9e3` | fix(partner): 驳回原因回传给机构；侧栏按能力投影 | 15 | P11 |
| 25 | `230e3d28c` | feat(admin): 终端用户停用/恢复 | 16 | **P10 + P9** |
| 26 | `c79100812` | feat(ai): 配置变更补审计；日志端点开服务端筛选 | 5 | P9 |
| 27 | `36d646e48` | fix(gates): 壳层遮蔽断言改为判据，修复 isQxRoute 触发的两条误红 | 4 | P3 |
| 28 | `d4cb2efc1` | fix(kiosk): 修复无设计稿页面体检查出的四个真实缺陷 | 10 | **P13 + P3** |
| 29 | `1e568fb3a` | feat(jobs): 岗位详情来源四要素缺失时停发外跳与扫码 | 4 | P14 |

**加粗 = 该提交横跨多个主题，必须拆开**（详见 §5）。

---

## 三、事实核验：batch-scope 门禁

### 3.1 找法与判据

在 `apps/kiosk/scripts/` 与 `services/api/scripts/` 下搜 `changedFiles` 与 `origin/main...HEAD`，
命中 8 个脚本。逐条实跑（`node scripts/<name>.mjs`，node 22.23.2）。

### 3.2 实测结果

| 门禁 | 状态 | 接入 CI | diff base | 红的原因 |
|------|------|--------|-----------|---------|
| `verify:lightflow-profile-entry` | **RED** | ci.yml:385 | `origin/main...HEAD` | 3 个 `/me/*` 文件不在 allowlist |
| `verify:profile-feedback-inkpaper` | **RED** | ci.yml:386 | `origin/main...HEAD` | 38 个禁止范围文件 |
| `verify:profile-resumes-notifications-inkpaper` | **RED** | ci.yml:387 | `origin/main...HEAD` | 32 个禁止范围文件 |
| `verify:profile-documents-inkpaper` | **RED** | ci.yml:390 | `origin/main...HEAD` | ~250 个越界文件 |
| `verify:profile-print-orders-inkpaper` | **RED** | ci.yml:391 | `origin/main...HEAD` | ~250 个越界文件 |
| `verify:profile-inkpaper-home` | GREEN | 是 | `origin/main...HEAD` | 其 allowlist 已覆盖本分支全部 `/me` 文件 |
| `verify:profile-commercial-first-batch` | GREEN | 是 | `origin/main...HEAD` | 委托给 `verify-fusion-w5`（绿） |
| `verify:fusion-w4` | GREEN | 是 | **`git diff HEAD`** | 见 3.3 |

同时按任务要求复核了「应该是绿的」四条，实跑确认**全部 GREEN**：
`verify:fusion-w4`、`verify:fusion-shell`、`verify:kiosk-visual-unity`、`verify:kiosk-runtime-error-boundary`
（另外顺手跑了 `verify:fusion-w2`、`verify:fusion-w5`，也绿）。

**全量扫描**：把 `apps/kiosk/scripts/verify-*.mjs` 全部跑了一遍，红的共 7 条 —— 上面 5 条，加：

- `verify-prod-build-config`：红是因为本 worktree 没有 `dist/` 构建产物、也没有 `.env.local`。
  **环境问题，与分支范围无关**（CI 里先 build 再跑）。
- `verify-jobfairs-terminal-priority`：**未在 `package.json` 注册、未接入 CI 的孤儿脚本**，
  它断言的 `JobFairsPage.tsx` 不在本分支 298 文件内。**与本分支无关**，红是既有状态。

### 3.3 `verify:fusion-w4` 不是 batch-scope 门禁

它的 `changedFiles()`（`apps/kiosk/scripts/verify-fusion-w4.mjs:216-229`）读的是
`git diff --name-only HEAD` + `git ls-files --others`，即**只看工作区未提交内容**，
注释写明是刻意的（"Scope this guard to the current integration worktree"）。
工作区干净时它看到 0 个文件，范围断言恒真。CI 上检出分支后工作区同样干净，
所以**它对已提交的 PR 内容永远不触发**。`d4cb2efc1` 往它 allowlist 里加的 5 个文件对 CI 是空操作。

### 3.4 五条红门禁的精确判据

这一节是 §4 里每个「转绿」判断的依据。

**G-LF `verify:lightflow-profile-entry`（无条件，每个 PR 都查）**
- 违规定义：diff 里任何 `apps/kiosk/src/pages/profile/me/**` 文件不在 `allowedMeChanges`（17 项）内。
- allowlist 含：`MeListShell` / `MySettingsPage` / `MyPrivacyRequestsPage` / `MyActivityPage` / `MyBenefitsPage` /
  `MyResumesPage` / `MyNotificationsPage` / `MyAiRecordsPage` / `MyDocumentsPage` / `MyFavoritesPage` +
  `me-detail-inkpaper.css` / `activityPresentation.ts` / `styles/me-*.css`。
- **不含**：`MyFeedbackPage.tsx`、`MyPrintOrdersPage.tsx`、`printOrders/**`。
- 本分支实测报的就是这 3 个文件。

**G-DOC `verify:profile-documents-inkpaper`（条件触发）**
- 触发：diff 含 `MyDocumentsPage.tsx`。
- 触发后：**全部**改动文件必须 ∈ allowlist ∪ 三个附加集合。`/me` 侧只允许
  `MyDocumentsPage` / `MyPrintOrdersPage` / `me-detail-inkpaper.css` / `printOrders/**`。
  **不含 `MeListShell.tsx`。**

**G-PO `verify:profile-print-orders-inkpaper`（条件触发）**
- 触发：diff 含 `MyPrintOrdersPage.tsx` 或 `printOrders/**`。
- 触发后：**全部**改动文件必须 ∈ 23 项 allowlist。含 `MyPrintOrdersPage` / `printOrders/OrderPaymentSummary` /
  `printOrders/PickupCodePanel` / `me-detail-inkpaper.css` / 6 个兄弟守卫脚本 / `package.json` / `ci.yml` /
  `docs/progress/{current-progress,next-tasks}.md`。
  **不含 `MeListShell.tsx`，不含 `packages/shared/**`，不含 `services/api/src/member-print-orders/**`。**

**G-FB `verify:profile-feedback-inkpaper`（条件触发）**
- 触发：diff 含 `MyFeedbackPage.tsx` 或 `feedback/**`。
- 触发后禁止：8 个具名 `/me` 页（`MyAiRecords` / `MyActivity` / `MyFavorites` / `MyBenefits` / `MySettings` /
  `MyResumes` / `MyNotifications` / `ProfilePage`）、`pages/(assistant|campus|companies|help)/**`、
  `services/**`、`packages/shared/**`、`apps/terminal-agent/**`、任何含 `prisma` 的路径。
  例外是 12 项支付 allowlist。
- `MeListShell` / `MyDocumentsPage` / `MyPrintOrdersPage` / `docs/**` 不在禁止列表内。

**G-RN `verify:profile-resumes-notifications-inkpaper`（条件触发）**
- 触发：diff 含 `MyResumesPage.tsx` 或 `MyNotificationsPage.tsx`。
- 触发后禁止：`services/**`、`packages/shared/**`、`apps/terminal-agent/**`、含 `prisma` 的路径（同样 12 项支付例外）。
- 全部 kiosk 页面与 `docs/**` 都不受限。

### 3.5 一条可以拿来省事的性质（单调性）

上述 5 条守卫的范围检查都是「对改动文件集合做过滤，非空即红」，且触发条件是「集合里出现某文件」。
因此：**任何在全分支（298 文件）上已经绿的范围守卫，在本分支的任意文件子集 PR 上仍然绿**
——要么不触发（跳过=通过），要么触发但违规集合更小。

⚠️ 这条性质**只覆盖范围守卫**，不覆盖门禁里读文件内容的静态断言。内容断言可能因为「相关文件被拆到另一个 PR」
而失败。本文已识别的这类耦合列在 §5 与 §7 的风险列。

---

## 四、拆分清单：17 个 PR

文件归属用脚本按路径规则机械分派并核对总数：**297 / 298 覆盖**，
唯一需要按 hunk 拆的是 `packages/shared/src/types/job.ts`（见 §5）。

---

### P1 — 项目图谱解析器修复

**交付闭环**：`pnpm graph` 能正确解析 lazy 路由与一文件多控制器，图谱不再少算 21 条 kiosk 路由。

- **提交**：`6d74c2f17`
- **文件（9）**：`scripts/project-graph/{backend,build,frontend}.mjs` + `docs/graph/{README,api,data-model,gates,routes}.md` + `docs/graph/graph.json`
- **转绿门禁**：无（不触发任何 batch-scope 守卫）；G-LF 因无 `/me` 文件而绿。
- **依赖**：无。
- **风险**：`docs/graph/*` 是 `scripts/generate-project-graph.mjs` 的产物。后续每个 PR 合完都会让产物过期。
  建议只在本 PR 带解析器修复 + 一次产物快照，并在全部 PR 合完后补一次 `pnpm graph` 重跑（见 §7 最后一行）。

---

### P2 — 51 页原型入库 + 交付治理包 + 文档清理与台账

**交付闭环**：把「产品功能定义」（51 页原型）纳入版本控制，建立 kiosk-redesign-r1 交付包与文档清理/施工台账。纯文档，零运行时影响。

- **提交**：`2d9f73c1b`、`2f92deb44`、`85741b5a5`、`859163498`、`0858ec475`、`f2a0b1cc5`、`afdbc1df9`
  + `b65645b05` 的文档部分 + `23464350f` 的 `docs/README.md` 部分
  + `456cd668d` / `ae972b364` / `14e1b342c` / `f9d1890ea` 各自的 `docs/reviews/*` 部分
- **文件（186）**：`docs/**` 下除 `docs/graph/**`（→P1）、`docs/device/pantum-api-design.md` 与
  `docs/delivery/.../EV-013-*`（→P7）、`docs/reviews/page-audit-no-design-2026-09-02.md`（→P13）之外的全部。
- **转绿门禁**：无直接转绿项；但把 186 个文件从其它 PR 的 diff 里搬走，是 G-DOC / G-PO 能转绿的**必要条件**
  （它们对**全部**改动文件做 allowlist 检查，`docs/design/**` 一份都不在里面）。
- **依赖**：无。**建议第一批合**，因为它一次性削掉 62% 的 diff。
- **风险**：
  - `docs/delivery/kiosk-redesign-r1/evidence-ledger.csv` 被 `2f92deb44`（建表）与 `35cd4f843`（EV-013 行）两次修改，
    **EV-013 那一行要留给 P7**。
  - `docs/reviews/field-gap-audit-2026-09-02.md` 由 `f2a0b1cc5` 建立、`f9d1890ea` 更正了其中**两条错误结论**
    （「onsiteServices/admissionMethod 是死字段」错、「publishedAt 落库不外露」错）。
    **建议把两次内容压成一份已更正的文档再入库**，不要先合入错版本再改。
  - 无 typecheck 风险。

---

### P3 — 青序流光设计地基 + 取件码页迁移 + 壳层门禁判据化

**交付闭环**：建立新版 51 页前端的唯一视觉真值（tokens / shell / primitives），完成第一块样板页
`/print/pickup-claim` 的整页迁移与虚拟数字键盘，并把三条壳层门禁从「逐字匹配」改成「判据」以容纳 `isQxRoute`。

- **提交**：`1135e251d`、`36d646e48`、`23464350f`（代码部分）、`e8a468fca`（kiosk 部分）、
  `8492b02f7`（qingxu / pickup 部分）、`14e1b342c`（令牌化 + 视觉门禁部分）、
  `d4cb2efc1`（`verify-kiosk-visual-unity.mjs` 部分）
- **文件（21）**：
  ```
  .claude/launch.json
  scripts/dev/shot-route.sh
  apps/kiosk/src/styles/qingxu/{index,tokens,shell,primitives}.css
  apps/kiosk/src/components/qingxu/QxPageFrame.tsx
  apps/kiosk/src/components/kiosk-numpad/{KioskNumpad.tsx,kiosk-numpad.css}
  apps/kiosk/src/layouts/KioskRoot.tsx
  apps/kiosk/src/pages/home/HomePage.tsx
  apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx
  apps/kiosk/src/pages/print/print-prototype.css
  apps/kiosk/src/pages/print/styles/{pickup-claim-qx,print-pickup-claim}.css
  apps/kiosk/scripts/lib/shell-chrome-contract.mjs
  apps/kiosk/scripts/tests/shell-chrome-contract.test.mjs
  apps/kiosk/scripts/verify-fusion-shell.mjs
  apps/kiosk/scripts/verify-fusion-w2-print-scan.mjs
  apps/kiosk/scripts/verify-kiosk-runtime-error-boundary.mjs
  apps/kiosk/scripts/verify-kiosk-visual-unity.mjs
  ```
- **转绿门禁**：无（不触发四条条件守卫；G-LF 因无 `/me` 文件而绿）。
- **依赖**：无。但**内部不可再拆**：
  - `KioskRoot.tsx` 引入 `isQxRoute`，会让 `verify:fusion-shell`、`verify:kiosk-runtime-error-boundary`、
    `verify:kiosk-visual-unity` 三条逐字匹配 `hideHeader={isCampusZone}` 的断言误红。
    修法在 `shell-chrome-contract.mjs`（来自 `36d646e48`）+ 三个门禁的调用点
    （其中 `verify-kiosk-visual-unity.mjs` 的调用点来自 `d4cb2efc1`）。**四者必须同 PR。**
  - `verify-fusion-w2-print-scan.mjs` 的两条断言随取件码页改名更新（`k-btn`→`qx-btn`、样式入口改名），
    必须与 `PrintPickupClaimPage.tsx` 同 PR。
  - `tokens.css` 会触发 `verify:kiosk-visual-unity` 的裸 hex 检查，其「token 定义文件除外」的实现
    来自 `14e1b342c`，必须同 PR。
- **风险**：
  - 文件多、耦合紧，是 17 个 PR 里最需要人工复看的一个。
  - `8492b02f7` 里的 `PrintProgressPage.tsx` **不属于本 PR**（见 P4）。
  - `14e1b342c` 里的 `JobDetailSections.tsx` **不属于本 PR**（见 P14）。
  - typecheck：自洽，无外部依赖。

---

### P4 — 打印链路可达性与诚实性（page-audit-print 三项）

**交付闭环**：主操作条在一体机视口吸底（此前 `/print/preview` 的「确认参数」落在首屏外 1001px）；
消除三处编造默认值（把「未记录」讲成「单面 / 黑白」、把缺失 duplex 当双面导致张数少算一半）；
修图片转 PDF 页同屏自相矛盾的「已保存」。

- **提交**：`14e1b342c`（action-bar + ConvertImagesPage 部分）、`8492b02f7`（`PrintProgressPage.tsx` 部分）
- **文件（3）**：
  ```
  packages/ui/src/styles/fusion-youth.css
  apps/kiosk/src/pages/print-scan/ConvertImagesPage.tsx
  apps/kiosk/src/pages/print/PrintProgressPage.tsx
  ```
- **转绿门禁**：无（不触发条件守卫）。注意 G-FB/G-RN 禁的是 `packages/shared/**`，`packages/ui/**` 不在禁令内。
- **依赖**：无。
- **风险**：
  - ⚠️ **提交信息与内容错位**：`6a850d74e` 的信息大段描述 `PrintProgressPage.tsx` 的三处编造默认值，
    但那些改动实际在**更早**的 `8492b02f7` 里，`6a850d74e` 自己只改了 `OrderPaymentSummary.tsx`。
    拆分时按**文件**分，不要按提交信息分。
  - `fusion-youth.css` 的 sticky 影响 23 个使用 `.ui-kiosk-action-bar` 的页面，单独合入需要回归实看。

---

### P5 — duplex 契约外露（后端 + 共享类型）

**交付闭环**：用户选了双面、按双面计价、参数落进 `PrintTask.paramsJson`，但
`GET /api/v1/me/print-orders` 不返回它。本 PR 让契约外露 duplex（白名单解析，缺失/非法一律 `null`，
**不回落 `'simplex'`**），并同步收紧另一条创建链路的解析口径。

- **提交**：`f9d1890ea`（代码部分）、`e8a468fca`（duplex 后端部分）
- **文件（5）**：
  ```
  packages/shared/src/types/memberPrintOrders.ts
  services/api/scripts/verify-member-print-orders.ts
  services/api/src/member-print-orders/member-print-orders.service.ts
  services/api/src/member-print-orders/member-print-orders.types.ts
  services/api/src/member-print-orders/member-print-order-create.service.ts
  ```
- **转绿门禁**：无（无 `/me` 文件 → G-PO / G-DOC 不触发）。
- **依赖**：无。**必须先于 P6**（P6 的 `MyPrintOrdersPage` 读契约里的 `duplex` 字段）。
- **风险**：
  - `verify-member-print-orders.ts` 第 5 项是「默认拒绝的响应键白名单」，新增 `duplex` 键属于一次
    **外露决定**，审查记录已写在白名单旁边——单独成 PR 反而让这次决定更容易被复核。
  - 该门禁需要隔离库运行，PR 上要跑 `services/api` 的 `verify:member-print-orders`。

---

### P6 — 打印订单展示：单双面 + 优惠额 + 退款额

**交付闭环**：「我的 → 打印订单」显示单双面、优惠额与退款额。三者都是「字段通了但没人显示」，
不会报错、用户完全看不见。显示口径：`null` 不渲染；金额 `0` 也不渲染（schema 里两列 `Int @default(0)`，
0 无法与「从未走过核销/退款」区分）。

- **提交**：`6a850d74e`、`e8a468fca`（`MyPrintOrdersPage` metaLine 部分）、`456cd668d`（`MyPrintOrdersPage` 的 `signedOutDescription` 一行）
- **文件（2）**：
  ```
  apps/kiosk/src/pages/profile/me/MyPrintOrdersPage.tsx
  apps/kiosk/src/pages/profile/me/printOrders/OrderPaymentSummary.tsx
  ```
- **转绿门禁**：**`verify:profile-print-orders-inkpaper`（G-PO）转绿** —— 两个文件都在其 23 项 allowlist 内，
  可另加 `docs/progress/{current-progress,next-tasks}.md`（也在 allowlist 内）。
- **依赖**：
  - **P5 必须先合**（`duplex` 字段来自共享契约）。
  - **P15 必须先合**（`signedOutDescription` prop 由 `MeListShell` 提供）。
  - **P0 必须先合**（否则 G-LF 红，见 §6）。
- **风险**：
  - ⚠️ **G-LF 仍红**：`MyPrintOrdersPage.tsx` 与 `printOrders/OrderPaymentSummary.tsx` 都不在
    `verify-lightflow-profile-entry` 的 allowlist 里。见 §6。
  - 不能把 P5 的后端文件塞进来：G-PO 的 allowlist 不含 `packages/shared/**` 与
    `services/api/src/member-print-orders/**`，塞进来立刻红。

---

### P7 — 奔图开放打印 API 取值对齐 + 彩色/双面真机验证记录

**交付闭环**：修三处会被奔图接口直接拒绝的取值（`non_collate`→`non-collate`、`thin`→`tissue`、补默认 `auto_tray`）；
把「协议里有没有彩色」与「本机型子集」两件事分开；登记产品负责人 2026-09-02 的彩色 + 自动双面真机验证结论。

- **提交**：`d73abd98c`、`fbc5bd1a2`、`35cd4f843`、`b65645b05`（`terminal-agent/printer/types.ts` 部分）
- **文件（5）**：
  ```
  packages/shared/src/types/print.ts
  apps/terminal-agent/src/printer/types.ts
  CLAUDE.md
  docs/device/pantum-api-design.md
  docs/delivery/kiosk-redesign-r1/evidence/EV-013-device-color-duplex.txt
  ```
  （外加 `docs/delivery/kiosk-redesign-r1/evidence-ledger.csv` 的 EV-013 一行，其余留 P2）
- **转绿门禁**：无（无 `/me` 文件 → G-FB / G-RN 不触发，其禁 `packages/shared/**` 与 `apps/terminal-agent/**` 的条款不生效）。
- **依赖**：无。
- **风险**：
  - `apps/terminal-agent/src/printer/types.ts` 是 `packages/shared` 的**手抄件**（文件头自写 keep in sync），
    三处 bug 在两个文件里同时存在。两文件必须同 PR。
  - `CLAUDE.md` 的能力表改动属产品长期口径，需产品负责人确认。
  - 单独跑 `verify:print-parameter-capability`、`verify:print-param-suggestion`、`verify:print-color-duplex-capability`。

---

### P8 — AI 简历报告：内容结构与问题证据 + 手抄契约漂移门禁

**交付闭环**：报告页主视觉从六条分数条换成「内容结构 + 问题证据」；证据用引文回配（服务端算 `lineIndex`），
不使用字符 offset；新增 `verify-ai-contract-mirror.mjs` 守住 `ai-provider.interface.ts` 与
`packages/shared/types/ai.ts` 的手抄一致性。

- **提交**：`e8a468fca`（AI 部分）、`a72bcdbde`
- **文件（8）**：
  ```
  packages/shared/src/types/ai.ts
  services/api/src/ai/interfaces/ai-provider.interface.ts
  services/api/src/ai/providers/mock.provider.ts
  services/api/src/ai/resume/llm-resume-evidence.ts
  services/api/src/ai/resume/llm-resume.service.ts
  services/api/scripts/verify-ai-contract-mirror.mjs
  services/api/scripts/verify-real-resume-diagnosis.ts
  services/api/package.json
  ```
- **转绿门禁**：无。
- **依赖**：无。
- **风险**：
  - 🚨 **本 PR 含需产品负责人签字的一项**：简历原文摘录（遮盖后、≤3.4KB、随 TTL 清理）现在会落进
    `AiResumeResult.payloadJson`，此前该列一个字原文都不存。这是**数据留存范围的实质变化**，
    合规上必须先签字再合。
  - `packages/shared/src/types/ai.ts` 被 6 条 kiosk 门禁读取（提交信息记载），合入后需回归。
  - `verify-ai-contract-mirror` 是新门禁，同 PR 里还要改 `package.json` 注册。

---

### P9 — AI 配置变更审计 + 日志端点服务端筛选（含 Admin 前端）

**交付闭环**：AI 配置（vendor / model / apiKey / enabled）变更此前零审计，本 PR 在 controller 落审计
（apiKey 明文/密文/长度/前缀/哈希一律不进 payload，只记动作枚举）；`GET /admin/ai/logs` 开
`operation/status/时间/分页` 服务端筛选，前端删掉客户端过滤——此前低频能力会显示为空而实际有调用。

- **提交**：`c79100812`、`230e3d28c`（AI 日志前端部分）
- **文件（10）**：
  ```
  services/api/src/ai/ai-log.service.ts
  services/api/src/ai/ai.controller.ts
  services/api/src/ai/llm/ai-config-audit.ts
  services/api/src/ai/llm/ai-config.controller.ts
  services/api/src/ai/llm/llm-config.service.ts
  apps/admin/src/routes/ai-services/index.tsx
  apps/admin/src/services/api/adminAiHttpAdapter.ts
  apps/admin/src/services/api/adminAiMockAdapter.ts
  apps/admin/src/services/api/aiUsage.ts
  apps/admin/src/services/api/types.ts
  ```
- **转绿门禁**：无。
- **依赖**：无。
- **风险**：
  - ⚠️ `apps/admin/src/services/api/types.ts` 是从 `230e3d28c`（一个讲「用户停用/恢复」的提交）里拆出来的。
    已逐行核对该文件在 `230e3d28c` 里的 **21 行全部是 AI 日志相关**（`AdminAiLogsQuery` + `AdminAiLogsResult`），
    与 admin-users 无关。**整文件归本 PR，不需要 hunk 级拆分。**
  - `ai-services/index.tsx` 已 785 行，逼近 CLAUDE.md §8 的 800 行线，下次动前先拆。
  - 提交信息自记待办：两个审计动作名以裸字符串登场，需同改 `audit.types.ts` 与 `shared/types/audit.ts` 两份手抄副本。

---

### P10 — Admin 终端用户停用 / 恢复

**交付闭环**：`EndUser.enabled/status/statusChangedAt` 三列在执行、admin 页也渲染「已停用」徽章，
但**全仓没有任何端点能把 enabled 置 false** —— 运营方没有办法封禁滥用账号。
本 PR 补 `POST /admin/users/:id/{disable,restore}`（reason 必填、CAS 挡 closing/anonymized、审计在事务内、幂等）。

- **提交**：`230e3d28c`（admin-users 部分）
- **文件（11）**：
  ```
  services/api/src/admin-users/admin-users.controller.ts
  services/api/src/admin-users/admin-users.service.ts
  services/api/src/admin-users/admin-users.types.ts
  services/api/src/admin-users/dto/change-admin-user-status.dto.ts
  services/api/scripts/verify-admin-users.ts
  packages/shared/src/types/adminUsers.ts
  apps/admin/scripts/verify-admin-users-ui.mjs
  apps/admin/src/routes/users/index.tsx
  apps/admin/src/routes/users/UserStatusDialog.tsx
  apps/admin/src/routes/users/userPresentation.ts
  apps/admin/src/services/api/adminUsers.ts
  ```
- **转绿门禁**：无。
- **依赖**：无（与 P9 共用同一个原始提交，但文件不重叠）。
- **风险**：
  - 本 PR **放宽了两条只读门禁**（`verify-admin-users` 从「禁一切写方法」改为「写方法恰为 disable/restore」）。
    提交信息给了三条文档出处论证「后置≠禁令」，并做了三次故障注入。
    单独成 PR 后这次边界变更更容易被独立复核——**这正是该拆出来的理由**。
  - 提交信息自记：未做浏览器实看（需真实 API + 登录态）。

---

### P11 — Partner：驳回原因回传 + 侧栏按能力投影 + 规则收敛成一份

**交付闭环**：岗位与招聘会的 `rejectReason` 此前不回传给机构（政策与企业的 DTO 有），机构被驳回只能猜；
侧栏 12 项对五类机构完全一样，招聘会主办方填完整张岗位表保存时才 403；
两处重复的机构类型判断收敛到 `PARTNER_CAPABILITY_MATRIX` 一份。

- **提交**：`ee65ed9e3`
- **文件（15）**：`apps/partner/**` 共 10 个 + `services/api/src/{jobs/jobs-shared.ts,jobs/partner-capabilities.ts,policies/policies.service.ts,smart-campus/smart-campus.service.ts}`
  + **`packages/shared/src/types/job.ts` 的 `PartnerDataSourceCapabilities` hunk**（见 §5）。
- **转绿门禁**：无。
- **依赖**：无。与 P13 争抢 `packages/shared/src/types/job.ts`，两个 hunk 互不相邻，后合的一方 rebase 即可。
- **风险**：
  - typecheck：`apps/partner` 的 `capabilities.ts` 依赖 `job.ts` 新增的两个布尔字段，**hunk 必须同 PR**。
  - 隐藏 vs 禁用的判据（按「服务端拒不拒读」而非按审美）是一次产品决策，已写在提交信息里，值得单独复核。

---

### P12 — 新建机构写入显式 `pending`

**交付闭环**：`createOrg` 不写 `contentTrustStatus`（`String?`），而内容发布闸门要求 `=== 'active'` 且 fail-closed
——**每一个新建的合作机构，内容一律发不出去**，且 partner 端对该字段零引用，机构侧完全看不到原因。

- **提交**：`ae972b364`（代码部分）
- **文件（1）**：`services/api/src/orgs/admin-orgs.service.ts`
- **转绿门禁**：无。
- **依赖**：无。
- **风险**：极低。改的是表达（`null`→`'pending'`），**不放宽任何闸门**（`'pending'` 与 `null` 一样被拒）。
  提交信息记录了改前确认「全仓 `contentTrustStatus === null` 类判断 0 处」。
  跑 `verify:admin-orgs`（隔离库）+ `verify:backend-p0-contracts`。

---

### P13 — 招聘会企业数据诚实性（无设计稿页面体检四缺陷）

**交付闭环**：适配层硬造 `checkinStatus:'pending'`（接口 payload 里根本没这个字段）被渲染成「未签到」chip；
`coerceScale` 把来源的 `'>2000'` 兜底成 `'medium'`，8 家真实超两千人的企业全被标成「中型企业」；
`.campus-proto` 上 `--kp-*` 令牌全部未定义导致对比度 1.06:1 的幽灵字；顶栏 `__brand-copy` 基础层漏样式。

- **提交**：`d4cb2efc1`（除 `verify-kiosk-visual-unity.mjs` 外）、`f9d1890ea`（`job.ts` 的 `ExternalJobFair` 注释 hunk）
- **文件（9 + 1 hunk）**：
  ```
  apps/kiosk/src/pages/job-fairs/FairCompaniesPage.tsx
  apps/kiosk/src/pages/job-fairs/components/FairCompanyDetailSections.tsx
  apps/kiosk/src/pages/styles/campus-policy-fusion.css
  apps/kiosk/src/services/api/httpAdapter.ts
  apps/kiosk/src/types/fair.ts
  packages/shared/src/types/fairDto.ts
  packages/ui/src/styles/kiosk-shell.css
  apps/kiosk/scripts/verify-fusion-w4.mjs
  docs/reviews/page-audit-no-design-2026-09-02.md
  + packages/shared/src/types/job.ts 的 ExternalJobFair 死字段注释 hunk
  ```
- **转绿门禁**：无。
- **依赖**：无。
- **风险**：
  - `verify-kiosk-visual-unity.mjs` 的改动**已移到 P3**（它 import 了 `36d646e48` 新建的
    `scripts/lib/shell-chrome-contract.mjs`，留在本 PR 会 import 失败）。
  - ⚠️ **未隔离实测**：本 PR 单独合入后 `verify:kiosk-visual-unity` 是否仍绿没有验证。
    低风险依据：本 PR 新增的 CSS 行里裸 hex 计数为 **0**（实测 `grep -c` = 0），
    而该门禁的主要断言是「新增页面 CSS 不得出现裸 hex」。
  - `verify-fusion-w4.mjs` 的 allowlist 增补对 CI 是空操作（§3.3），保留只为文档意义。

---

### P14 — 岗位详情：五个「通了但没人显示」的字段 + 来源四要素缺失时停发外跳

**交付闭环**：岗位详情渲染 `educationRequirement` 等五个已通但零渲染点的字段（空值整块不渲染）；
修 `.jf-content` 的静默裁切（加字段前就已裁掉 123px，加完裁到 400px）；
来源四要素（来源机构 / 同步时间 / 外部ID / 外部链接）缺失时停发「去来源平台投递」与扫码。

- **提交**：`1e568fb3a`、`14e1b342c`（`JobDetailSections.tsx` 部分）
- **文件（4）**：
  ```
  apps/kiosk/src/pages/jobs/JobDetailPage.tsx
  apps/kiosk/src/pages/jobs/components/JobDetailSections.tsx
  apps/kiosk/src/pages/jobs/components/JobResultsSection.tsx
  apps/kiosk/src/pages/jobs/utils/sourceTrust.ts
  ```
- **转绿门禁**：无。
- **依赖**：无。
- **风险**：
  - ⚠️ `JobDetailSections.tsx` 的一半改动是 `14e1b342c` 用 `git add -A apps/kiosk` **误扫进去的**
    （提交信息完全没提，`1bd544ee5` 事后补记）。拆分时**必须按文件搬到本 PR**，
    否则 P3 会带一个和它无关的岗位页改动。
  - 本 PR 直接触碰 CLAUDE.md §10 的合规展示（来源四要素、按钮文案白名单），需逐条对照合规边界复核。
  - `1e568fb3a` 的提交信息记录了两条**尚未处理**的事实：新稿 `27-browse-detail` 自身缺「福利待遇」与
    「技能」展示区块（迁移不但修不了还会延续）；`validThrough` 过期的整套 `?state=expired` 状态未实现。

---

### P15 — 「我的」壳层游客免登录出口 + 单块焦点态居中（6 页）

**交付闭环**：`MeListShell` 是 9 个 `/me/*` 页共用的壳，未登录态只给「手机号登录」一个按钮
——游客点进「我的收藏」除了登录无路可走，**而打印扫描与岗位浏览本来就不需要登录**（CLAUDE.md §9A）。
本 PR 加两个免登录出口 + `signedOutDescription` 槽，并把「单块焦点态」四态改居中（实测消除 1065px 死白）。

- **提交**：`456cd668d`（`MeListShell` + 6 页部分）
- **文件（7）**：
  ```
  apps/kiosk/src/pages/profile/me/MeListShell.tsx
  apps/kiosk/src/pages/profile/me/MyActivityPage.tsx
  apps/kiosk/src/pages/profile/me/MyAiRecordsPage.tsx
  apps/kiosk/src/pages/profile/me/MyBenefitsPage.tsx
  apps/kiosk/src/pages/profile/me/MyFavoritesPage.tsx
  apps/kiosk/src/pages/profile/me/MyNotificationsPage.tsx
  apps/kiosk/src/pages/profile/me/MyResumesPage.tsx
  ```
- **转绿门禁**：**`verify:profile-resumes-notifications-inkpaper`（G-RN）转绿**
  —— 触发（含 `MyResumesPage`/`MyNotificationsPage`），但禁止集合（`services/**`、`packages/shared/**`、
  `apps/terminal-agent/**`、`prisma`）在本 PR 里为空。
  G-LF 也绿：这 7 个文件全部在其 allowlist 内。
- **依赖**：无。**必须先于 P16、P17、P6**（三者都要用 `signedOutDescription` prop）。
- **风险**：
  - **本 PR 不能带 `MyDocumentsPage` / `MyFeedbackPage` / `MyPrintOrdersPage`**：
    带上 `MyDocumentsPage` 会触发 G-DOC（其 allowlist 不含 `MeListShell` 与另外 6 页）→ 红；
    带上另两个会触发 G-FB / G-PO 且撞 G-LF → 红。
    这就是原来「一处壳修 9 页」在本仓门禁模型下必须拆成 4 个 PR 的原因。
  - 本 PR 不含 `services/**` 与 `packages/shared/**`，否则 G-RN 立刻红。

---

### P16 — 「我的文档」页游客说明槽

**交付闭环**：`MyDocumentsPage` 补一行 `signedOutDescription`，说明「这一页存的是什么」。

- **提交**：`456cd668d`（`MyDocumentsPage.tsx` 部分）
- **文件（1）**：`apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
- **转绿门禁**：**`verify:profile-documents-inkpaper`（G-DOC）转绿** —— 触发，且唯一改动文件在其 allowlist 内。
  G-LF 也绿（`MyDocumentsPage` 在其 allowlist 内）。
- **依赖**：**P15 必须先合**（prop 由 `MeListShell` 提供，否则 typecheck 失败）。
- **风险**：单独看只有一行，但**任何附加文件都会让 G-DOC 红**（它检查**全部**改动文件）。
  连 `docs/progress/current-progress.md` 都要确认在 allowlist 里再加（该文件在 allowlist 内，可加）。

---

### P17 — 「意见反馈」页游客说明槽

**交付闭环**：`MyFeedbackPage` 补一行 `signedOutDescription`（原型 40 画了免登录反馈入口，运行时没有）。

- **提交**：`456cd668d`（`MyFeedbackPage.tsx` 部分）
- **文件（1）**：`apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx`
- **转绿门禁**：**`verify:profile-feedback-inkpaper`（G-FB）转绿** —— 触发，但禁止集合为空
  （`MyFeedbackPage` 自身不在它自己的禁止列表里）。
- **依赖**：**P15 必须先合**；**P0 必须先合**（否则 G-LF 红）。
- **风险**：⚠️ **G-LF 仍红**，`MyFeedbackPage.tsx` 不在其 allowlist 内。见 §6。

---

## 五、必须拆开的提交

| 提交 | 横跨主题数 | 怎么拆 |
|------|-----------|--------|
| `e8a468fca` | **4** | 按文件分：kiosk 壳/取件码/门禁 9 文件→P3；`member-print-order*` 3 文件→P5；`MyPrintOrdersPage.tsx`→P6；AI 7 文件（含 `services/api/package.json`）→P8 |
| `456cd668d` | **5** | 按文件分：`MeListShell`+6 页→P15；`MyDocumentsPage`→P16；`MyFeedbackPage`→P17；`MyPrintOrdersPage`→P6；3 份 `docs/reviews/*`→P2 |
| `14e1b342c` | **4** | 按文件分：qingxu 令牌 + `verify-kiosk-visual-unity` + `kiosk-numpad.css`→P3；`fusion-youth.css` + `ConvertImagesPage`→P4；`JobDetailSections.tsx`→P14；`page-audit-print-*.md`→P2 |
| `230e3d28c` | 2 | 按文件分：admin-users 11 文件→P10；AI 日志 5 文件（`ai-services/index.tsx`、`adminAiHttpAdapter`、`adminAiMockAdapter`、`aiUsage.ts`、`types.ts`）→P9。已逐行确认 `types.ts` 的 21 行全部是 AI 日志，**不需要 hunk 级拆分** |
| `8492b02f7` | 2 | 按文件分：qingxu 余量吸收 4 文件→P3；`PrintProgressPage.tsx`→P4 |
| `f9d1890ea` | 3 | 按文件分：`memberPrintOrders.ts` + 4 个 member-print-orders 文件→P5；`field-gap-audit` 文档→P2；**`packages/shared/src/types/job.ts` 需按 hunk 拆**→P13 |
| `d4cb2efc1` | 2 | 按文件分：`verify-kiosk-visual-unity.mjs`→P3（它 import P3 里新建的 lib）；其余 9 文件→P13 |
| `ae972b364` | 2 | 按文件分：`admin-orgs.service.ts`→P12；2 份 inventory 文档→P2 |
| `b65645b05` | 2 | 按文件分：`apps/terminal-agent/src/printer/types.ts`→P7；其余 6 份文档→P2 |
| `23464350f` | 2 | 按文件分：4 个代码文件→P3；`docs/README.md`→P2 |

### 唯一需要 hunk 级拆分的文件

`packages/shared/src/types/job.ts` —— 两个提交改的是两个互不相邻的区域：

- `f9d1890ea`：`ExternalJobFair` 的 `tagline` / `onsiteServices` / `admissionMethod` 三字段注释
  （记录「服务端从不赋值、只有 mock 有值」的现状）→ **P13**
- `ee65ed9e3`：`PartnerDataSourceCapabilities` 新增 `canManagePolicies` / `canManageSmartCampus` 两个布尔字段
  → **P11**（`apps/partner/src/services/capabilities.ts` 依赖它，必须同 PR）

两个 hunk 无重叠，`git checkout -p` 或手工分别应用即可；后合的 PR rebase 时不会冲突。

---

## 六、拆分解决不了的一条：`verify:lightflow-profile-entry`

### 事实

- 该门禁**无条件**运行（不像另外四条有触发条件），断言是：
  diff 里任何 `apps/kiosk/src/pages/profile/me/**` 文件必须在 `allowedMeChanges`（17 项）内。
- 该 allowlist **从未包含** `MyFeedbackPage.tsx`、`MyPrintOrdersPage.tsx`、`printOrders/**`。
  查证方式：`git log -S "MyPrintOrdersPage" origin/main -- apps/kiosk/scripts/verify-lightflow-profile-entry.mjs`
  与同样的 `MyFeedbackPage` 查询**均为空**——这两个文件名在该脚本的历史里一次都没出现过。
- `origin/main` 上最后一次改这两个页面的提交（`3a588d09e`、`2028fcd92`）**早于**
  引入 `forbiddenMeChanges` 守卫的 `afc7f4a38`（历史位置 1493 / 1514 vs 1148）。
  所以这条约束**存在但从未被触发过**，本分支是第一个撞上它的。

### 后果

P6 与 P17 无论怎么拆，只要触碰这三个文件，G-LF 就红。这不是拆分技巧能解决的。

### 两个选项（都需要人裁决，不得静默处理）

**选项 A：放弃这两处改动。**
把 `MyPrintOrdersPage` / `MyFeedbackPage` / `OrderPaymentSummary` 的改动从拆分范围里剔除。
代价：丢掉「打印订单显示单双面/优惠额/退款额」和「反馈页游客说明」两项已完成的真实修复。

**选项 B：修正门禁的批次归属（推荐，但必须写明理由并单独成 PR）。**
把这三个路径加入 `allowedMeChanges`。理由不是「为了让 CI 变绿」，而是**批次归属已经变了**：
- `MyPrintOrdersPage` / `printOrders/**` 现在有专属守卫 `verify:profile-print-orders-inkpaper`；
- `MyFeedbackPage` / `feedback/**` 现在有专属守卫 `verify:profile-feedback-inkpaper`；
- 而 `verify-profile-print-orders-inkpaper.mjs` 里已经有断言明文要求
  feedback 与 resumes 两条守卫**不再拦截** printOrders 批次（`expectAbsent(feedbackVerify, ...)`），
  即「专属守卫接管后其它守卫让路」在本仓已经是既定做法。G-LF 是同一个做法里唯一还没跟上的一条。

**选项 B 的执行约束（重要）：**

1. **必须单独成 PR（记为 P0），只改 `apps/kiosk/scripts/verify-lightflow-profile-entry.mjs` 一个文件。**
   原因：G-PO 与 G-DOC 的 allowlist 都**不含**这个脚本路径，把它塞进 P6 或 P16 会让那两条门禁转红。
   而 P0 单独跑时，四条条件守卫都不触发、G-LF 自身 diff 无 `/me` 文件 → 全绿。
2. **只能加 `allowedMeChanges` 条目，绝不能删检查。**
   `verify-profile-inkpaper-home.mjs` 有一条 `delegatesMeBoundary` 断言，要求
   `verify-lightflow-profile-entry.mjs` 里同时保留字符串
   `path.startsWith('apps/kiosk/src/pages/profile/me/')` 与 `forbiddenMeChanges.length === 0`。
   删掉检查会让当前是绿的 `verify:profile-inkpaper-home` 立刻转红。
3. 按 CLAUDE.md §8，这次门禁边界变更要在脚本头部写带日期与出处的记录，并说明放行的是**归属**不是**范围**。

> **本文不替产品做这个选择。** 在裁决前，P6 与 P17 不具备合入条件。

---

## 七、推荐合入顺序

| 序 | PR | 说明 | 前置 | 合完后转绿的门禁 |
|----|----|------|------|------------------|
| 1 | **P2** 文档 / 原型 / 交付包 | 186 文件，零运行时风险；先搬走它 62% 的 diff 就消失了 | — | — |
| 2 | **P1** 图谱解析器 | 工具修复，后续 PR 要靠它查影响面 | — | — |
| 3 | **P7** 奔图取值 + 真机验证 | 独立；含 `CLAUDE.md` 能力表，早合早统一口径 | — | — |
| 4 | **P8** AI 简历报告 | 🚨 **需先拿到数据留存签字** | 签字 | — |
| 5 | **P9** AI 配置审计 + 日志筛选 | 独立后端 + admin 前端 | — | — |
| 6 | **P10** Admin 用户停用/恢复 | 独立；含门禁边界变更，单独复核 | — | — |
| 7 | **P11** Partner 驳回原因 + 能力投影 | 含 `job.ts` partner hunk | — | — |
| 8 | **P12** 机构写显式 pending | 1 文件 | — | — |
| 9 | **P13** 招聘会企业数据诚实性 | 含 `job.ts` fair hunk | — | — |
| 10 | **P14** 岗位详情字段 + 来源四要素 | 合规相关，单独复核 | — | — |
| 11 | **P3** 青序流光地基 + 取件码页 | 21 文件、门禁判据化，本批最重 | — | — |
| 12 | **P4** 打印链路可达性与诚实性 | 影响 23 个用 action-bar 的页面，需回归实看 | — | — |
| 13 | **P5** duplex 契约（后端） | — | — | — |
| 14 | **P15** 「我的」壳层游客出口（6 页） | — | — | ✅ **G-RN** |
| 15 | **P16** 我的文档页 | 1 行 | P15 | ✅ **G-DOC** |
| 16 | **P0** `lightflow-profile-entry` 归属裁决 | ⚠️ **需产品负责人裁决**（§6） | 裁决 | — |
| 17 | **P6** 打印订单展示 | 2 文件 | P5、P15、P0 | ✅ **G-PO**（+ G-LF，若走选项 B） |
| 18 | **P17** 意见反馈页 | 1 行 | P15、P0 | ✅ **G-FB**（+ G-LF，若走选项 B） |
| 19 | *(收尾)* `pnpm graph` 重跑 | 路由/端点/门禁都变过，产物必须重算 | 全部 | — |

**序 1–13 之间互相独立**，可并行开 PR、按复核完成先后合入；只有 14→15、13+14+16→17、14+16→18 有硬依赖。

---

## 八、建议丢弃或合并的提交

| 提交 | 处理 | 理由 |
|------|------|------|
| `1bd544ee5` | **丢弃** | `git show --name-only` 为**空**——零文件改动的纯过程性提交。它补记的事实（`14e1b342c` 用 `git add -A` 误扫进 `JobDetailSections.tsx`）应写进 P14 的提交信息，不需要一个空提交承载 |
| `85741b5a5` | 合并进 P2 | 1 行 `delivery.yaml`（关 BL-04），与 `2d9f73c1b` 是同一件事的两半 |
| `afdbc1df9` | 重写后并入 P2 | 它记录的「按主题拆成 7 个聚焦 PR」已被本文（17 个 PR）取代，直接合入会留下过期方案 |
| `fbc5bd1a2` | 合并进 P7 | 1 行 `pantum-api-design.md`，与 `35cd4f843` / `b65645b05` 讲的是同一个彩色口径 |
| `f2a0b1cc5` + `f9d1890ea` 的文档 hunk | **压成一份**再入 P2 | `f2a0b1cc5` 里有两条被 `f9d1890ea` 证伪的结论（「onsiteServices/admissionMethod 是死字段」、「publishedAt 落库不外露」）。先合错版本再合更正，等于往 main 里放一份已知错误的审计文档 |

另外两条**不是丢弃、但要在拆分时改提交信息**的：

- `6a850d74e` 的信息大段描述 `PrintProgressPage.tsx` 的三处编造默认值，那些改动实际在 `8492b02f7` 里。
  拆分按文件走（→P4），提交信息要重写。
- `14e1b342c` 的信息没提 `JobDetailSections.tsx`（60 行）。拆到 P14 后信息要如实写。

---

## 九、未验证事项（明确留白，不用推断填空）

1. **未验证**：每个拆分后 PR 端到端跑全部相关门禁的结果。
   本文的「转绿」判断是**集合成员判断**——把 PR 的文件清单逐个对照门禁 allowlist / 禁止模式算出来的，
   已在 §3.4 给出精确判据。它不覆盖门禁里读文件内容的静态断言。
   已识别的内容耦合已写进各 PR 的「依赖」与「风险」栏（P3 内部四处、P6→P5、P16/P17→P15）。
2. **未验证**：P13 单独合入后 `verify:kiosk-visual-unity` 是否仍绿。
   低风险依据是实测「本 PR 新增 CSS 行的裸 hex 计数 = 0」，但没有隔离跑过。
3. **未验证**：任何 PR 的 typecheck / lint / build。本文只做静态归属分析，未执行构建。
4. **未验证**：`services/api/scripts/` 下的门禁现状。
   本文全量扫的是 `apps/kiosk/scripts/verify-*.mjs`（81 个）；api 侧门禁需要隔离数据库，未跑。
   `services/api/scripts/`（以及 `apps/{admin,partner,terminal-agent}/scripts/`）下**没有**使用
   `changedFiles()` 或 `origin/main...HEAD` 的脚本——这一条是查过的（`grep -rln` 命中为空；
   全文搜 `origin/main` 只命中 `verify-redis-degradation-truth.ts` 与 `verify-error-observability.ts`
   的注释里各一处基线 sha 引用，不是 diff 逻辑）。所以 **batch-scope 门禁全部集中在 `apps/kiosk/scripts/`**。
5. **未验证**：`verify:lightflow-profile-entry` 在干净 `origin/main` 上是否绿。
   推理依据是「diff 为空 → `forbiddenMeChanges` 为空 → 该断言通过」，且它在 CI 里长期存在；
   但没有真的检出 main 跑过（本次任务只读，不做 checkout）。
6. **本文未做**任何 `git rebase` / `cherry-pick` / `reset` / 建分支 / 改代码。
   `git stash` 栈未触碰。工作区在开始与结束时均为干净状态。

---

*生成于 2026-09-02，基于 `claude/project-readiness-review-959ffe` @ `1e568fb3a`，diff base `origin/main`。*
