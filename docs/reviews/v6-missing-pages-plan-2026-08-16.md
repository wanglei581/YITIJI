# V6 缺页盘点与补页规划（2026-08-16）

> **来由**：产品所有者 2026-08-16 提出「V6 这里面页面可能并不全面……需要针对缺少这些对应关系的功能或者页面进行一个规划和补充」。本文把 V6 原型里「流程声明了却到不了 / 生产有能力原型没画 / 画了却没人能进 / 原型与生产切分对不上」的缺口全部盘出来，并给出补页方案。
>
> **本文只做只读调研与规划。不改任何原型、不改任何生产代码、不碰 `docs/progress/`。**

## 0. 核实基准与方法

| 项 | 取值 |
|---|---|
| 生产基准 | `origin/main` @ `6caedd6dcc396c080a2044f87d3d9d882f99c453`（`git fetch origin main` 于 2026-08-16 执行） |
| V6 原型基准（含 `09b`） | 分支 `worktree-agent-a902db0eb20f99655` @ `b14d87aba3e6f2edd9989c87b22a9e8ab762049e` |
| 原型在 main 上的基准 | `origin/main:docs/design/kiosk-ai-os-v3-2026-08/`（46 业务页 + 3 个 retired 首页变体 + 脚手架） |

**方法**（仓库有 22+ 个 worktree，所有「存在 / 缺失」结论一律取只读快照，不以任何工作区检出为准）：

1. `git archive origin/main docs/design/kiosk-ai-os-v3-2026-08/ | tar -x -C <snap>`；`git archive b14d87aba …` 取含 `09b` 的一份。
2. 机械解析全部 53 个 HTML：`.screen[data-stage]`、`[data-at]`、`.rstep[data-go]`、`[data-go]`、`href`、`data-href`、`?<param>=`，做差集与入站图。
3. `git show origin/main:apps/kiosk/src/routes/index.tsx`（318 行 / 105 条 `path:`）做生产侧对照。
4. 关键结论用浏览器真渲染复核（本机 `python3 -m http.server` 起静态服务，逐页加载并读 DOM）。

**复用而不重做的既有结论**：`docs/reviews/ai-capability-wiring-matrix-2026-08-16.md`（AI 能力 × 页面矩阵，773 行）、`docs/reviews/console-c0-fact-freeze-2026-08-16.md` §2.2（P01–P46 → 路由映射）、`docs/reviews/kiosk-control-integrity-audit-2026-08-16.md`（705 个 onClick）、`origin/main:docs/design/kiosk-ai-os-v3-2026-08/wiring-map.md`（712 行，功能 ↔ 接口）、同目录 `dead-buttons-2026-08-11.md`（99 条实测死按钮）。本文不重复它们的条目。

---

## 0A. 三条必须先纠正的事实（本任务的前提被证伪了两条）

立项时给到的活证据是：「09b 唯一出口指向 `09-resume-workbench.html?stage=s5`，而 09 与 09b 都没有 `data-stage="s5"`，s5 是流程声明了却从未绘制的一页」。**逐条核实后，这个判断是错的。**

**① `data-stage` 不是「本页有哪些阶段」，它只是默认阶段。**

`scripts/stages.js:58-62`：

```js
function validStages () {
  var set = {}
  document.querySelectorAll('[data-at]').forEach(function (el) {
    String(el.getAttribute('data-at') || '').split(/\s+/).forEach(function (v) { if (v) set[v] = 1 })
  })
  return set
}
```

`:94-95` 用 `ok[want]` 校验 `?stage=`。也就是说**一页支持哪些阶段，判据是 `[data-at]` 的并集，不是 `.screen` 上的 `data-stage`**。`.screen[data-stage="s1"]` 只表示「裸开这一页时停在 s1」。按 `data-stage` 判「有没有 s5」，等于拿默认值当全集。

**② 09 的 s5「版本与导出」早就画好了，而且完整。**

`09-resume-workbench.html`（`b14d87aba`）里 `data-at` 含 `s5` 的块有 9 处：`:815`（v2 纸样预览）、`:1194`（版本列表 v2 / v1 + 「切换版本不销毁任何一版」）、`:1214`（「拿去做什么」四个出口）、`:1274` `:1281`（常驻两卡）、`:1335`（页脚四态提示）、`:1347`（继续优化）、`:1363` `:1364`（动作条主按钮，default/first/ai-down 与 device-off 分岔）。

浏览器实测 `09-resume-workbench.html?stage=s5`：`data-stage=s5`、`data-stage-fallback=null`（没有回落）、8 个 `[data-at]` 块可见，内容依次为「个人简历_v2.pdf 已采纳 3 处 · 原件 v1 保留」「版本 可随时回退 / v2 采纳 3 处改写 · 当前 / v1 你上传的原件 · 不被覆盖」「拿去做什么：带去打印 · 存进我的简历 · 导出 PDF · 发到我手机」「v2 已生成，v1 原件保留不被覆盖」。

两条独立旁证：
- 同目录 `dead-buttons-2026-08-11.md:26-28` 有三条实测记录标着 `09-resume-workbench  s5`（翻页 / v1 原件 / 四个出口）——2026-08-11 的回归台真的走到过 s5 并逐个按过。
- `origin/main:docs/design/kiosk-ai-os-v3-2026-08/wiring-map.md:190-191` 以「`09` s5 导出 PDF」「`09` s5『带去打印』」立条对接后端。

**③ 真正缺的是生产侧的能力，不是原型的页。**

`origin/main:apps/kiosk/src/routes/index.tsx:239` 有 `/resume/export` → `ResumeExportPage`，但该文件全 96 行**没有任何 props、没有 taskId、不读任何路由参数**，恒定渲染「暂无真实输出物 / 当前流程尚未生成可导出的真实文件」，两个动作按钮硬编码 `disabled`。`wiring-map.md:190` 早已写明：「从 `parse + optimize` 出来的简历**没有对应的导出端点**——09 s5『导出 PDF · 存进我的文档』目前拿不到文件」，`:459` 登记为待建能力 B9。

**结论**：把 09 rail 第 5 步与 09b 唯一出口按「本稿尚未实现」置灰，是**按错误判据做的回归补正**，它把一条能走通的路堵死了。这是本次盘点的第一个 P0，处置见 G-01。

---

## 1. 缺口总表

| ID | 类 | 缺口 | 严重度 | 补法 |
|---|---|---|---|---|
| G-01 | 1 | 09 / 09b 第 5 步「版本与导出」被误判为未实现并置灰，实际已完整实现 | **P0** | 改指向（撤销置灰） |
| G-02 | 3 | 生产 `/resume/export` 是恒空壳，原型 s5 四个出口在生产侧无落点 | **P0** | 补功能（生产侧），原型不动 |
| G-03 | 3 | 37 声明「面试技巧」「往期训练报告」两页「还没建」，二者在 main 已是真实页面 | P1 | 补页（原型）+ 改指向 |
| G-04 | 1 | 17「入场签到」是死按钮，原型无签到页/阶段，生产有 `/job-fairs/checkin` | P1 | 补页（原型新增阶段或独立页） |
| G-05 | 5 | 「账号设置」原型是 23 的页内浮层，生产是 541 行独立页 `/me/settings` + `/me/privacy-requests`；原型只画删除、没画数据导出 | P1 | 补页（原型） |
| G-09 | 2 | 跨页跳转带的上下文参数大面积不被目标页消费（链是活的，送过去的东西丢了）；反向有一个参数无人发送 | P1 | 改指向 / 补入口 |
| G-06 | 5 | 「帮助」原型是 `help.js` 全站浮层（37 页挂载），生产是独立页 `/help`（228 行，7 个入口） | P2 | 明确分工，不补页 |
| G-07 | 4 | 40 / 41 两页唯一入口是 04 状态图谱页，真实流程里到不了 | P2 | 改指向 |
| G-08 | 5 | 45 一页承担生产 4 条路由；`/job-fairs/:id/companies/:companyId` 原型无对应 | P2 | 不补页，登记 1:N 映射 |
| G-10 | 4 | 02 待机屏零入站；三个 retired 首页仍留在交付目录并被引用 | P2 | 补入口 + 明确下线 |
| G-11 | 5 | 生产 `/resume/self-assessment/history` 是独立路由，原型是 28 的 s4 阶段且 `?view=history` 无人读 | P2 | 改指向 |

**分类小计**：类 1（声明了步骤没有页/阶段）2 · 类 2（死链 / 死上下文）1 · 类 3（生产有能力原型没画）2 · 类 4（孤儿页）2 · 类 5（原型与生产切分不一致）4，共 **11 个缺口**。

**严重度分布**：P0 = 2（G-01、G-02） · P1 = 4（G-03、G-04、G-05、G-09） · P2 = 5（G-06、G-07、G-08、G-10、G-11）。

**另有 4 项查过但确认不是缺口**，列在 §4，避免下一轮重复排查。

---

## 2. 逐个缺口

### G-01 · 09 / 09b 第 5 步被误判为未实现并置灰 —— P0 · 改指向

**缺口描述**：简历流程第 5 步「版本与导出」在原型里是完整实现的（证据见 §0A ②），但 2026-08-16 的一次回归补正按错误判据（拿 `.screen[data-stage]` 当阶段全集）认定它「从未实现」，把两处入口一起灰掉：

- `09-resume-workbench.html:386-387`：rail 第 5 步由 `<button data-go="s5">` 改成
  `<button type="button" class="rstep rstep--skip" aria-disabled="true" title="本稿尚未实现「版本与导出」，先完成第 4 步逐条优化">`；
  `:379-385` 的注释写着「本页与 09b 都没有 `data-stage="s5"`，s5 从未实现过」。
- `09b-resume-optimize.html:181-182`：rail 第 5 步同样处理。
- `09b-resume-optimize.html:326-336`：**本页唯一的出口**「生成 v2（未决定项保留原文）」由
  `<a href="09-resume-workbench.html?stage=s5">` 改成 `<button aria-disabled="true" aria-describedby="v2-blocked-why">`，并追加一段「『版本与导出』页本稿尚未绘制」的说明。

**后果**：用户在 09b 逐条采纳完全部 AI 改写建议后，唯一的前进按钮是灰的，rail 上第 4 步是当前站、第 5 步不可点——**流程在最后一步断头，而断的那一步其实是通的**。这比原来的问题更重：原来的判断认为按下去是空屏，实测按下去是一屏完整的版本与导出。

**严重度**：P0。挡住用户完成任务，且没有旁路（09b 的其余出口只能回退到 s3 诊断结论）。

**补法：改指向（撤销置灰）**。不补页——页已经在了，补第二个「版本与导出」就是重复入口。具体：

1. `09-resume-workbench.html:386-387` 恢复为 `<button class="rstep" data-go="s5">`。
2. `09b-resume-optimize.html:181-182` 恢复为 `<a class="rstep" href="09-resume-workbench.html?stage=s5">`（跨页必须用 `<a>`，理由已写在 09b:170-172 的注释里，那条注释是对的）。
3. `09b-resume-optimize.html:326-336` 恢复主出口 `<a href="09-resume-workbench.html?stage=s5">`，删掉 `#v2-blocked-why` 说明段。
4. **把两处注释里的错误判据改正**：写清「`data-stage` 是默认阶段；一页支持哪些阶段看 `[data-at]` 并集，判据在 `scripts/stages.js:58-62`」。不改正的话，下一个代理会按同一个错判再灰一次。
5. `ai-down` / `first` 两态的灰按钮（`09b:337`「改写不可用」）**保留** —— 那一条是 AI 唯一产出源不可用时的正确处置（类型②），与本缺口无关。

**保留的合理内核**：置灰用 `aria-disabled` 而非原生 `disabled`、并写明原因，做法是对的；错的只是「为什么灰」。这个写法应该原样搬到 G-02 的生产侧（那里用的是原生 `disabled`）。

---

### G-02 · 生产 `/resume/export` 是恒空壳 —— P0 · 补功能（生产侧）

**缺口描述**：`origin/main:apps/kiosk/src/routes/index.tsx:239` 挂了 `/resume/export` → `ResumeExportPage`。该组件（`apps/kiosk/src/pages/resume/ResumeExportPage.tsx`，96 行）不接受任何 props、不读路由参数、不发任何请求，恒定渲染「暂无真实输出物 / 当前流程尚未生成可导出的真实文件」，「保存到我的简历」「打印」两个按钮写死 `disabled`。也就是说**无论用户前面做完了什么，这一页都是空的**。

后端侧 `wiring-map.md:190` 已定性：`POST /resume/generate/export` 只接受「访谈式生成」的 `GeneratedResume` 结构，从 `parse + optimize` 出来的简历没有对应的导出端点；`:193` 另记「发到我手机」的本机→手机下行通道（`takeaway-sessions`）全站缺失，10+ 处出口在等它；`:459` 把这条登记为 B9。

**严重度**：P0。简历链是 AI 求职操作系统的主干闭环，最终产物拿不走等于整条链白做。原型 09 s5 的四个出口（带去打印 / 存进我的简历 / 导出 PDF / 发到我手机）在生产侧一个都没有落点。

**补法：补功能，不补页**。原型 09 s5 已经把这一页该长什么样定死了，生产照着接即可：

- 后端：让 `POST /resume/generate/export` 接受 optimize 产物，或新增 `POST /resume/records/:taskId/export`（`wiring-map.md:459` B9 已给两条路）。
- 后端：`POST /takeaway-sessions {fileId}` 下行取件通道（`wiring-map.md:451` B1，票据放 URL fragment、TTL ≤10 分钟、单次有效）。
- 前端：`/resume/export` 必须接 `taskId`，按真实产物渲染版本列表与四个出口。
- **两个 `disabled` 按钮同时整改为 `aria-disabled` + 可读原因**（现在是原生 `disabled`，掉出 tab 顺序、读屏跳过，用户读不到「为什么不能点」，与本项目 §9 口径冲突）。

**不伪造能力的底线**：在导出端点接通之前，这一页可以继续显示空态，但**不得**显示「已保存 / 已导出 / 已发送」。现有文案「此页面不会虚构文件、保存结果或打印任务」是对的，保留。

---

### G-03 · 37 声明两页「还没建」，而 main 上它们已经是真实页面 —— P1 · 补页 + 改指向

**缺口描述**：`37-interview-hub.html` 有三处「建设中」声明：

| 位置 | 声明 |
|---|---|
| `:332-341` | `dcard--soon` `id="c-tips"`「面试技巧」，hint 写「**面试技巧页还没建**，面试练习页里没有这段内容」 |
| `:427-428` | `dmore-go--soon`「往期训练报告 · 建设中」「往期报告页还没建」 |
| `:419` | `dmore-go--soon`「面试训练记录 · 建设中」 |
| `:272` | aibar 复述：「**面试技巧**与**往期训练报告**两个页面还没建」 |
| `:219` | 降级文案复述：「技巧与往期报告页还没建」 |

对照 `origin/main`：

- `apps/kiosk/src/routes/index.tsx:115` `/interview/tips` → `InterviewTipsPage`（285 行：6 项准备清单、高频问题卡「考察什么 / 结构 / 常见错误 / 提示」四段式、STAR 完整说明、自我介绍结构、底部进模拟面试；注释明写「无任何『保过/通过率』类承诺文案」）。
- `apps/kiosk/src/routes/index.tsx:116` `/interview/reports` → `InterviewReportsPage`（180 行，未登录时引导过身份门）。
- 两者的生产入口都在：`apps/kiosk/src/pages/home/serviceGroups.ts:107-108`、`apps/kiosk/src/pages/interview/InterviewServiceHubPage.tsx:86,141`。

**这是 §0A 同一个失败模式的第二例**：原型里的「还没建」是对**原型自身**的陈述，被读成对**产品**的陈述，于是真实存在的能力在设计稿里被标成不可用。

**严重度**：P1。功能不可用但有旁路（37 内的模拟面试与自我评估两张卡是真链）。

**补法：补页（原型）+ 改指向**。

- 「面试技巧」→ 补 P37a（详见 §3-D）。补完后 `:332-341` 的灰卡改成真链。
- 「往期训练报告」→ 补 P37b（详见 §3-E）。补完后 `:427-428` 改真链。
- 「面试训练记录」（`:419`）→ **不补页**，理由见 §4。改指向 `43-my-records.html?stage=ai`。
- `:219` `:272` 两处降级文案随之改写。

---

### G-04 · 17「入场签到」是死按钮，原型没有签到落点 —— P1 · 补页

**缺口描述**：`17-fair-desk.html:532-542` 的 `.checkin` 块：

```html
<!-- 2026-08-09 零落点补齐：入场签到（线上 /job-fairs/checkin） -->
<div class="checkin">
  …<span class="checkin-t">已经在现场？先签到再逛</span>
  <span class="checkin-s">扫码或凭手机号签到，领现场资料 · 不是投递</span>
  <button class="btn btn--lg btn--quiet" style="flex:0 0 auto">…入场签到</button>
</div>
```

按钮**没有 `href`、没有 `data-go`、没有任何监听**。浏览器实测（`17-fair-desk.html?stage=s1`，真按一次）：`body.outerHTML` 长度、`location.href`、`data-stage` 三项全部零变化。它也**不在** `dead-buttons-2026-08-11.md` 的 99 条名单里，属于此前未被登记的死控件。

同时 `36-fairs-hub.html:291` 与 `:330-341` 两个入口把「扫码签到」送到 `17-fair-desk.html?stage=s1&view=checkin`，并且 36 自己的注释（`:333`）已经写明「`?view=checkin` 目前不被消费，进去不会自动滚到签到」。

生产侧 `origin/main:apps/kiosk/src/routes/index.tsx:269` 有 `/job-fairs/checkin` → `JobFairCheckinPage`（218 行），首页 `serviceGroups.ts` 也有 `/job-fairs/checkin` 直达入口。

**严重度**：P1。原型给了承诺（「先签到再逛」）却没有兑现处，但用户仍可到现场找主办方；且生产已有页面，属原型缺页。

**补法：补页**（P17b，详见 §3-C）。也可以退而求其次做成 17 内的一个新阶段（`data-at="s1b"`），但签到有独立的失败态（码过期 / 手机号未登记 / 主办方系统不通）和独立的合规声明（「不是投递」），塞回 s1 会让本来就密的场次屏更挤——按「页面拥挤首选拆页」应独立成页。

---

### G-05 · 账号设置：原型一个浮层 vs 生产两个页 —— P1 · 补页

**缺口描述**：

- 原型：`23-me.html:758-761` 是一张「账号设置」卡，副文「登录方式 · 文件保存期限 · 隐私与删除 · 无障碍」；点开是**页内浮层** `:819-898`。浮层里隐私与删除只有一个动作：`:883`「删除已存的简历文件」。全文 **0 处**「导出数据 / 数据导出 / 改绑 / 换绑」。
- 生产：`routes/index.tsx:178` `/me/settings` → `MySettingsPage`（**541 行**）；`:179` `/me/privacy-requests` → `MyPrivacyRequestsPage`。入口在 `apps/kiosk/src/pages/profile/profileEntries.ts:46`、`ProfilePage.tsx:139`。
- `wiring-map.md:412-413` 已登记：**个人数据导出整条链后端已具备**（`GET/POST /me/data-requests`、`POST /me/data-requests/:id/download-authorizations`、`GET /member/data-exports/:id/content`，含 step-up 二次验证、一次性票据放 URL fragment），「**23 只画了删除，没画导出**」；改绑手机 / 导出数据都必须过 `POST /member/auth/step-up/sms-code` + `/verify`。

**严重度**：P1。用户的法定数据权利（导出）在设计稿里没有入口；后端已经建好没人用。

**补法：补页**（P23b，详见 §3-B）。一个 541 行的生产页 + 一个独立隐私请求页塞进一个浮层，是明确的职责过载。拆出来之后 23 首屏少一层浮层、账号域的每一件事各占一行，符合「加页要让用户每一屏要做的事更少、更清楚」。

---

### G-09 · 跨页上下文参数大面积不被消费 —— P1 · 改指向 / 补入口

**缺口描述**：全站链接**没有一条死链**（见 §4），但**送过去的上下文大面积被丢弃**。机械核实：整个原型里真正读 URL 参数的只有 11 个页面 + 2 个共享脚本。

读参数的一侧（实测 `URLSearchParams(...).get('…')` 出现位置）：

| 页 | 消费的参数 |
|---|---|
| `03-identity-gate` | `from` `returnTo` `returnStage` `stage` |
| `05-phone-relay` | `dir` `from` `kind` `title` `artifactId` `stage` |
| `06-print-workbench` | `stage` `from` `kind` `title` `pages` `copies` `source` `back` |
| `07` / `12` / `18` | `from` |
| `09-resume-workbench` | `from` `src` |
| `11-jobfit-compare` | `from` `stage` |
| `23-me` | `from` `view` |
| `42-my-assets` | `orderId` |
| `43-my-records` | `activityId` |
| `scripts/stages.js` | `stage` |
| `scripts/stage.js` | `state` `theme` `pay` `job` `capture` |

发出去但目标页**不读**的（按影响排序）：

| 发送方 → 目标 | 丢掉的参数 | 后果 | 严重度 |
|---|---|---|---|
| `15-companies.html:692`、`14-job-detail.html:362` 等 7 处 → `11-jobfit-compare` | `jobId` `jobTitle` `need` `resumeVer` | 从企业页/岗位详情点「按岗位比对」，进去不知道比哪个岗位——而 A5 能力的**必需输入**就是 1 个目标岗位（`ai-capability-spec.md` A5） | **P1** |
| `38-policy-hub.html:276`、`43-my-records.html:899` 等 → `21-policy` | `cat` `policyId` `view` | 从政策域首屏选了分类进去，分类没带上 | P2 |
| `34-jobs-hub.html:272` 等 → `13-jobs-desk` | `jobType` `region` `dir` | 首屏筛选条件不生效 | P2 |
| `43-my-records.html:624` → `14-job-detail`、`:1047` → `15-companies`、`:820` → `44` | `jobId` `companyId` | 从记录点回原岗位/原企业，落到列表首条 | P2 |
| `37-interview-hub.html:263,344`、`36`、`22` 等 → `20` / `28` / `17` / `22` | `view` | 「只看题目」「翻往期记录」「扫码签到」等定语全部失效（36 自己已注明） | P2 |
| `06-print-workbench.html:2148` → `08-file-tools` | `tool` | 从打印台跳文件加工台不落到指定工具 | P2 |
| `32-resume-hub.html:317` → `09`、`33:418` → `09` | `intent` `need` `templateId` | 版式选择带不进简历流程（`wiring-map.md:202` 已登记：09 后端也不消费 `templateId`，真正能吃它的只有导出端点） | P2 |
| `42-my-assets.html:612` → `09b` | `artifactId` `from` | 09b 全文 0 处读参数 | P2 |

反向缺口：**`43-my-records.html:1946` 读 `activityId`**（`?stage=trace&activityId=A-…` 落到哪一条足迹要看得出来，`:939` 有对应的定位条 DOM），**但全站没有任何一页发送这个参数**——这条深链高亮功能建好了却没有入口。生产侧对应 `routes/index.tsx:172` `me/activity/:id` → `MyActivityDetailPage`。

**严重度**：P1（`11` 的 `jobId` 一条），其余 P2。

**补法：改指向 / 补入口，不补页**。

- P1 一条：`11-jobfit-compare` 增加对 `jobId` / `jobTitle` 的消费（原型里至少要把标题回填到「目标岗位」槽位），否则 A5 的输入门在页面上是空的。
- 反向一条：**补入口**——在 43 的足迹列表每行加一个指向 `43-my-records.html?stage=trace&activityId=…` 的定位链接（自链，不新增页），把已建好的高亮用起来；生产侧对应 `me/activity/:id`。
- 其余：接线时逐条决定「消费它」还是「不要发它」。**发一个没人读的参数，比不发更糟**——它让下一个人以为上下文传下去了。建议在原型页尾契约里补一句：出站链接只允许带目标页声明消费的参数。

---

### G-06 · 帮助：原型浮层 vs 生产独立页 —— P2 · 明确分工，不补页

**缺口描述**：原型把「帮助」做成全站共享浮层 `scripts/help.js`（37 个 HTML 挂载）。该文件头注释写明设计取舍：「294 次点击实测里 254 次界面零变化；其中『需要帮助』出现在 19 个页面、全部无反应——而它是全站唯一的兜底出口」，「只做『怎么找到人』的指引。绝不显示『已提交工单』『已通知运维』」。

生产是独立页 `/help` → `HelpCenterPage`（228 行），7 个入口：`profileEntries.ts:47`、`ErrorOfflinePage.tsx:82`、`PrintDonePage.tsx:191,229,338`、`ScanStartPage.tsx:166`。后端 `GET /kiosk/help` 是空壳桩，恒返回 `{data:[]}`（`wiring-map.md:385`、`:482` B32）。

**严重度**：P2。两边都能用，只是形态不同。

**补法：不补页，明确分工**。理由：原型再补一个帮助页，全站就会有两个帮助入口（浮层 + 页），正是要避免的重复入口。建议口径写死为——

- **浮层 = 兜底**：任何一屏卡住时按「需要帮助」，只讲「怎么找到人」（服务台位置、客服电话按站点配置下发，不编号码）。这条必须留在每一页。
- **页 = 内容**：`/help` 承载使用说明与服务边界这类可阅读内容，从「我的」与完成页进入。
- 后端 `GET /kiosk/help` 在补出内容模型之前，`/help` 用本地内容并注明来源，**不得**接那个空壳桩（接了就是永远空白页）。

---

### G-07 · 40 / 41 只有 04 一个入口，真实流程里到不了 —— P2 · 改指向

**缺口描述**：入站图实测：

- `40-session-safety.html` ← 仅 `04-system-states.html:801`
- `41-fulfillment-states.html` ← 仅 `04-system-states.html:838`

而 04 是**状态图谱页**（六个系统态的陈列），不是用户路径上的一站。这意味着：会话安全六态（超时警告 / 锁屏 / 接管 / 结束清空 / 恢复 / 遗留物）和履约异常八处境（支付失败 / 待支付 / 退款中 / 退款完成 / 退款失败 / 缺纸 / 认领 / 错件）在原型里**从真实流程走不到**——`06-print-workbench` 全页不链 41。

生产侧对照：`/print/pickup-claim`（= 41 的 claim）入口在 `apps/kiosk/src/pages/print-scan/PrintScanHomePage.tsx:60,65`，也就是原型的 **P39 打印域首屏**，不是 P06。

**严重度**：P2。这两页本身是完整的（40 六态、41 八态都有内容），只是评审时得从 04 绕进去；不影响原型交付的完整性，影响的是「谁在什么时候会看到它」这条设计说明。

**补法：改指向，不补页**。

- `06` s5 收银失败 / s6 出纸异常的分支各链到 `41-fulfillment-states.html?stage=<对应处境>`。
- `39-print-hub` 加一条「凭码取件」→ `41?stage=claim`（与生产 `PrintScanHomePage:60` 对齐）。
- `40` 的 idle-warn / locked 由会话钟触发，属系统事件，保持 04 入口即可，但要在 04 页首写明「本页是状态图谱，不是用户路径」。

---

### G-08 · 45 一页 = 生产 4 条路由 —— P2 · 不补页，登记 1:N 映射

**缺口描述**：`45-fair-onsite.html` 的 4 个阶段 `booth / map / materials / stats` 对应生产 4 条路由：`routes/index.tsx:272` `/job-fairs/:id/companies`、`:274` `/map`、`:275` `/materials`、`:277` `/stats`，外加 `:276` `/visit-plan`（45 的 `map` 阶段里 `:552-634` 的「逛展顺序」就是 `FairVisitPlanPage`，303 行，后端能力 B4 `POST /job-fairs/:fairId/visit-plan/:taskId`）。

生产另有 `:273` `/job-fairs/:id/companies/:companyId` → `FairCompanyDetailPage`，**原型无对应阶段**。

**严重度**：P2。

**补法：不补页，登记映射**。45 用阶段切分是刻意的密度决策（现场用户站在机器前，切阶段比跳页快），不应为了对齐路由把它拆成 4 页。要做的是在 `wiring-map` / C0 映射表里明确写成 1:N，**接线时不要按原型阶段数去建路由，也不要按生产路由数去拆原型**。`FairCompanyDetailPage` 那一条按 `17-fair-desk.html:1118` 的注释（「现场签到状态 + 展位岗位清单」）挂到 45 `booth` 阶段的行级详情，不新增页。

---

### G-10 · 02 零入站；三个 retired 首页仍在交付目录 —— P2 · 补入口 + 明确下线

**缺口描述**：

- `02-standby.html`（待机宣传屏）**零入站**。它自己链出到 `01-home-v6.html`，但没有任何一页能进去。真机上它由无操作超时触发，不需要用户入口——但**评审时没法从任何地方看到它**。
- `pages.json` 的 `"retired": ["01-home.html","01-home-v4.html","01-home-v5.html"]` 已把三个旧首页移出交付集，但**文件仍在交付目录**，且 `themes.html` 与 `compare.html` 仍在引用（`01-home.html` ← `themes.html`）。机械解析时它们会被当成正式页统计。
- `index.html` / `verify.html` 是脚手架，零入站属正常。

**严重度**：P2。

**补法**：

- 02 → **补入口**：`index.html` 总览里加一条「待机屏（真机由无操作超时进入）」，或在 `04-system-states` 里加一站。不新增业务页。
- 三个 retired 首页 → **明确下线**：移到 `archive/` 子目录，或在文件头加 retired 横幅并从 `themes.html` / `compare.html` 的清单里摘掉。留在原地会持续制造「V6 有 4 个首页」的误读。

---

### G-11 · 自我评估历史：生产独立路由 vs 原型阶段 —— P2 · 改指向

**缺口描述**：生产 `routes/index.tsx:111` `/resume/self-assessment/history` 是独立页；原型是 `28-self-assessment.html` 的 s4 阶段。`37-interview-hub.html:344` 链的是 `28-self-assessment.html?stage=s4&view=history`——`stage=s4` 有效（28 的阶段集是 `s1 s2 s3 s4`），`view=history` 无人读（G-09 同一类）。

**严重度**：P2。链是活的，落点语义也对，只是多带了一个没人读的参数。

**补法：改指向**——去掉 `&view=history`，或让 28 消费它。与 G-08 同理，**不为了对齐路由把 28 的 s4 拆成独立页**。

---

## 3. 建议补的页清单

按优先级排序。所有补页都必须先满足两条前提：**入口从现有页面来，不新开第二个同义入口**；**返回路径明确，不靠浏览器后退**（一体机没有后退键）。

### A · 不需要补的页（先说清楚，避免误补）

| 曾被认为缺 | 实际 | 处置 |
|---|---|---|
| 09「版本与导出」（s5） | **已完整实现**，`?stage=s5` 实测可达 | 撤销置灰（G-01），**不得新增第二个导出页** |
| P30 岗位匹配 | C0 §2.2 已裁定是 P11 的升格别名 | 不新增文件 / 入口 / 模型 |
| 帮助中心（原型侧） | `help.js` 浮层已覆盖 37 页且是全站兜底出口 | 不补（G-06） |
| 面试训练记录（37:419） | 43「练习记录」已承载 | 不补（§4） |

### B · P23b「账号设置与隐私」（P1，第一优先）

- **职责一句话**：把账号、文件保留期限、隐私与删除、个人数据导出、无障碍这五件事各自一行地摊开，让用户一屏之内知道「本机存了我什么、存多久、我能拿走什么、我能删什么」。
- **入口从哪来**：`23-me.html:758-761`「账号设置」卡改为跳页（现在是开浮层 `:819-898`）。**不新增首页入口**。
- **返回到哪去**：`23-me.html`。动作条返回键写「返回 · 我的」。
- **页面上必须有**：
  1. 登录方式与会话钟（真实值：`23:556` 的「登录 15:02 · 无操作满 N 分钟自动清空退出」口径要与 P40 / P04 一致，站点配置下发，不写死）。
  2. 文件保留期限表（简历 / 文档 / 订单 / 自我评估 24 小时 / 合同 2 小时，来源同 `23:841-877`；到期即物理删，留删除日志且日志不含文件内容）。
  3. 隐私与删除：删除已存简历文件（确认弹层防肩窥，不回显文件名全称，沿用 `23:902` 的做法）。
  4. **个人数据导出**（新增，后端已具备）：申请 → step-up 短信二次验证 → 一次性票据下载。对应 `POST /me/data-requests`、`POST /member/auth/step-up/sms-code`+`/verify`、`GET /member/data-exports/:id/content`（`wiring-map.md:412-413`）。
  5. 退出登录并清空本机会话。
  6. 无障碍（字号 / 对比度），本地态即可。
- **真实数据来源**：`GET /me/*` 会员域；保留期限来自站点配置；导出链见上。**没有接通前不显示「已导出 / 已提交」。**
- **AI 在其中的角色**：**无**。与 `ai-capability-spec.md` §2 的「P03 身份门」「P40 会话安全六态」同类——身份、隐私、删除是安全判定，模型判断有害。这一页**刻意不接 AI**，并在页面上写明这一点（这本身是对用户的一条承诺）。
- **AI 不可用时怎么办**：不适用（本页不依赖 AI，`ai-down` 态与 `default` 态同版同文）。
- **文件预算**：1 个 HTML，≤ 700 行（对照生产 `MySettingsPage.tsx` 541 行 + `MyPrivacyRequestsPage`）。

### C · P17b「入场签到」（P1）

- **职责一句话**：到场用户凭主办方的码或手机号完成签到、领取现场资料，**只做到场登记，不做投递**。
- **入口从哪来**：`17-fair-desk.html:539` 现在那颗死按钮；`36-fairs-hub.html:291,340`「扫码签到」两处（改成直链本页，不再送到 17 s1）。
- **返回到哪去**：`17-fair-desk.html?stage=s1`（本场次页）。
- **页面上必须有**：
  1. 来源三字段：主办方（`source_org`）、同步时间、外部 ID（`CLAUDE.md` §10）。
  2. 两种签到方式：扫主办方的码 / 凭手机号；各自的失败态（码过期、手机号未登记、主办方系统不通）都要能单独看到，**不合并成一个「签到失败」**。
  3. 合规声明：沿用 `17:537` 的「扫码或凭手机号签到，领现场资料 · **不是投递**」。按钮文案走白名单（`CLAUDE.md` §2），禁「一键 / 立即 / 平台投递」。
  4. 签到成功后的去处：现场资料打印（→ `06?stage=s3&from=P17B&kind=fair-material`）、展位导览（→ `45?stage=map`）。
  5. **不伪造**：主办方系统不通时显示「本机没有收到主办方的签到回执」，**不显示「已签到」**，并给「到入口处人工签到」的替代路径。
- **真实数据来源**：`/job-fairs/:id`、`/job-fairs/checkin`（生产 `JobFairCheckinPage` 218 行已在）。
- **AI 在其中的角色**：**加速器，不是前置条件**（类型①）。签到成功后可给一条「按你的方向，这 5 个展位值得先去」（A12，复用 45 `map` 的逛展顺序能力，E3 标注）。
- **AI 不可用时怎么办**：签到本身**完全不受影响**（纯事实登记）；顺序建议区显示「排序不可用，按展区编号顺序给，不猜先后」（与 `45:589` 同一口径）。
- **文件预算**：1 个 HTML，≤ 450 行。

### D · P37a「面试技巧」（P1）

- **职责一句话**：面试前的准备清单、高频问题的**回答结构**（不是标准答案）、STAR 与自我介绍的写法。
- **入口从哪来**：`37-interview-hub.html:332-341` 现在那张灰卡。
- **返回到哪去**：`37-interview-hub.html`。
- **页面上必须有**：
  1. 准备清单（背景调研 / 岗位匹配 / 基础演练 / 形象着装 / 面试材料 / 面试安排），可勾选，**本地态**——不写「已完成」到任何地方。
  2. 高频问题四段式：考察什么 / 回答结构 / 常见错误 / 提示（照生产 `InterviewTipsPage.tsx:33+` 的结构，那是已经写好的内容）。
  3. STAR 完整说明（不截断）+ 自我介绍结构。
  4. 证据级别：这些是通用准备方法，标 **E2**（来源方/系统事实），**不标 E3**——它不是模型判断。
  5. 底部去处：开始一场模拟面试（→ `20?stage=s1`）、打印这份清单（→ `06?stage=s3&from=P37A&kind=material`）。
  6. **红线**：无「保过 / 通过率 / 录用概率 / 百分比匹配」任何表述（`stage.js` 的量化红线自查会拦）。
- **真实数据来源**：静态内容（生产已有 285 行成稿）。后端若要做成可运营内容，`wiring-map.md:372` 建议复用 toolbox item 或新建 `GET /kiosk/interview-tips`。
- **AI 在其中的角色**：**加速器**（类型①）。可选一条「按你的目标岗位挑出该重点准备的 3 项」，标 E3 + 「仅供参考」。
- **AI 不可用时怎么办**：整页照常——清单、问题、STAR 都是静态内容，只撤下那条排序建议，并写「未结合你的情况」。这是最标准的类型①降级。
- **文件预算**：1 个 HTML，≤ 500 行。

### E · P37b「往期训练报告」（P1）

- **职责一句话**：列出**本人**历次模拟面试的报告，可回看、可打印、可带走。
- **入口从哪来**：`37-interview-hub.html:427-428` 现在那条灰行；`20-interview-pod.html` s4 复盘页的「看历次」；`43-my-records.html?stage=ai`。三处指向同一页，不新建同义卡。
- **返回到哪去**：来源页（`?from=` 回跳，且**必须真的消费 `from`**，别再犯 G-09）。
- **页面上必须有**：
  1. 真实条数与真实空态。**未登录**时明写「本次会话做的练习留不下」（沿用 `37:351` 的口径），并给身份门入口 `03?returnTo=…`。
  2. 每条：时间、面试官类型、岗位方向、难度、时长、是否有复盘单。
  3. 出口：回看单场（→ `20?stage=s4`）、打印复盘单（→ `06`）、发到我手机（等 `takeaway-sessions`，未接通前置灰 + 写明原因）。
  4. **不伪造**：没有真实报告时显示 0 条，不摆样例。
- **真实数据来源**：`GET /me/mock-interviews`（已在 main，`EndUserAuthGuard`）、`GET /mock-interviews/:id/report`、`POST /:id/report/print`。
- **AI 在其中的角色**：**无**（列表本身是记录）。报告内容由 D2 生成，已在别处。
- **AI 不可用时怎么办**：列表与已有报告**照常可看可打印**（类型①）。只有「再练一场」这个动作会受 `mock_interview` 功能位影响——那颗按钮按类型②处置：`aria-disabled` + 「组卷服务暂不可用，已有报告不受影响」。
- **文件预算**：1 个 HTML，≤ 400 行。

### 补页总预算

4 页，合计 ≤ 2050 行 HTML。外加 G-01 / G-07 / G-09 / G-10 四组改指向的小改动（预估 ≤ 150 行改动，分布在 09、09b、06、39、11、43、36、17、index、pages.json）。**不新增任何后端模型、不新增任何一级导航入口。**

---

## 4. 建议不补而下线的

| 项 | 理由 |
|---|---|
| **「面试训练记录」独立页**（`37-interview-hub.html:419` 声明「建设中」） | main 上只有 `GET /me/mock-interviews` 端点，没有独立路由；原型侧 `43-my-records.html` 的「练习记录」与 `42-my-assets` 已经承载了「我的记录」这件事。再开一页就是第三个同义入口。**改成指向 `43-my-records.html?stage=ai` 的真链，或直接撤卡。** |
| **`01-home.html` / `01-home-v4.html` / `01-home-v5.html`** | `pages.json` 的 `retired` 字段已明确「已定全站统一 V6 首页」。但文件仍在交付目录、仍被 `themes.html` / `compare.html` 引用，机械统计时会被当成正式页。**移入 archive 子目录或加 retired 横幅并从两处清单摘掉。** |
| **P30 独立页** | C0 §2.2：P30 是 P11 的升格别名，「**不是缺页**，不得新增第二文件 / 入口 / 模型」。 |
| **原型侧独立「帮助中心」页** | `help.js` 浮层已挂载 37 页且是全站唯一兜底出口。补页会造出第二个帮助入口。见 G-06 的分工口径。 |
| **把 45 拆成 4 页 / 把 28 s4 拆成独立页** | 纯粹为了对齐生产路由数而拆，多点一次却没换来更清楚，属堆砌。生产路由与原型阶段的 1:N 映射登记在 §G-08 / §G-11 即可。 |
| **P06 阶段轨里第二个 s5** | 不是缺陷。`stages.js:19-27` 只数**当前可见**的 `.rstep`，两个 `s5` 是「免费单跳过收银」的同站变体，刻意做的。 |

### 查过但确认不是缺口（避免下一轮重复排查）

1. **全站 0 条死页面链接**。机械扫描报出的 5 条全是误报：`06:3400`、`24:1075`、`compare.html:51`、`index.html:141` 是 JS 模板字符串里的 `href="' + x + '"`；`index.html:62 → README.md` 的目标文件真实存在（只是不是 `.html`）。
2. **全站 0 条死 `?stage=` 链接**。所有跨页 `?stage=` 的目标值都在目标页的 `[data-at]` 并集里。
3. **全站 0 条指向不存在阶段的 `data-go`**（含阶段轨 `.rstep`）。
4. **`37-interview-hub.html` 的 `data-at="s2"` 是幽灵**——它只出现在 `:358` 的一段注释里，不是真实 DOM，不构成孤立阶段。
5. **`data-href` 卡片都有页内绑定**：`01-home-v6.html` 的 21 个 `data-href` 由本页 `:934-940` 的内联脚本处理；`33-resume-templates.html` 用 `data-href0` + `:549-556` 重算 href。共享的 `linkage.js:104` 只管 `[data-href][role="button"]`，两页都满足。

---

## 5. 未验证

如实列出没读到、没跑到、或判不准的部分。**下列各项在被复核之前不得当成结论使用。**

1. **没有逐屏渲染全部 46 页**。只机械解析了全部 HTML，并对 `09-resume-workbench.html?stage=s5` 与 `17-fair-desk.html?stage=s1`（入场签到按钮）做了真渲染 + 真点击。其余页的**运行时**行为（尤其是页内内联脚本绑定的控件）未逐个验证，可能还有类似 G-04 的、不在 `dead-buttons-2026-08-11.md` 名单里的死控件。
2. **生产侧只核到路由与源码，没有跑起 kiosk 应用**。`/interview/tips`、`/interview/reports`、`/job-fairs/checkin`、`/me/settings`、`/help` 这几页我确认了**文件存在、行数、关键内容片段与入口引用**，但它们是否接了真实数据、在真机上是否可用，未验证。G-03 的结论只支撑「原型说『还没建』是错的」，不支撑「它们已经可用」。
3. **`?view=` / `?cat=` / `?jobId=` 等参数在生产侧是否被消费，未核**。G-09 的全部结论只针对原型。生产侧 React 页面的 `useSearchParams` 消费面需要单独扫一遍。
4. **`v6-ux-density-audit-2026-08-16.md` 与 `kiosk-control-integrity-audit-2026-08-16.md` 只读了结论层**，未把它们的逐条发现并进本文。两文若有与本文重叠的条目，以它们为准。
5. **`09b` 所在分支在本次调研过程中前进了**：`a19d145f0` → `b14d87aba`（另一个代理正在同一目录作业）。本文所有原型结论以 `b14d87aba` 为准；该分支若继续前进，G-01 的行号需要复核。
6. **`19-smart-campus` / `46-campus-service` 的缺口未独立复核**。C0 §2.2 把它们标为 `deferred`（`SmartCampusGuard` 默认 `enabled=false`、服务端 fail-closed 待补），本文沿用该结论，没有自己验。
7. **`02-standby` 的真机触发链未验**。它零入站是否会影响真机待机（`/screensaver` 由无操作超时进入），需要按 `docs/device/` 的待机屏方案核，本文只登记了「评审时看不到」。
8. **未评估补页对现有回归门禁的影响**。新增 4 页要重跑 `tools/make-pages.sh` 更新 `pages.json`（该文件自注「全量回归前必须重跑，否则新增页会被静默漏测」），并确认 `stage.js` 的九项自查 + `audit-plus.js` 在新页上通过。本文没有跑这些脚本。
