# 项目规范化治理索引

> 最后更新：2026-06-23
> 用途：项目标准化、规范化、简洁化的**薄索引**。本文件只索引既有权威规范并补充治理专项追踪，**不替代** `AGENTS.md` / `CLAUDE.md` / `.ccg/spec/guides/index.md`；与上述文件冲突时，以它们为准。

## 一、治理目标

当前项目不做推倒重写，也不做大规模物理目录迁移。后续治理目标是：

1. 保留已验证的业务能力和生产验收链路。
2. 用统一入口减少多模型、多分支、多文档之间的理解偏差。
3. 用文件预算、规模阈值、审查门禁和验证脚本约束新增工作。
4. 先做可回滚、零行为变化的小步拆分，再处理更大的结构问题。
5. 把项目持续限定为 AI 求职材料与打印服务终端，而不是招聘平台。

## 二、当前不做什么

- 不新增业务入口、同义卡片、重复页面或重复按钮。
- 不开发平台内投递、企业收简历、候选人筛选、面试邀约、Offer 管理等招聘闭环。
- 不把 mock、占位页面、临时脚本包装成生产能力。
- 不整包提交本地任务目录、外部材料、PDF、截图、录屏或缓存。
- 不在未确认影响评估前移动 `apps/`、`services/`、`packages/`。
- 不把上线部署、真机验收、业务开发和大规模重构混在一个分支。

## 三、规范入口（索引）

后续任务先按下表读取既有权威入口，再决定是否需要新增文档。本表只索引，不复制各文件内容：

| 层级 | 入口 | 用途 |
| --- | --- | --- |
| 项目定位 | `AGENTS.md` / `CLAUDE.md` | 总体定位、合规红线、跨模型接力规则 |
| 当前事实 | `docs/progress/current-progress.md` | 当前阶段、已验证结论、仍待验收事项 |
| 任务池 | `docs/progress/next-tasks.md` | 当前执行顺序、P0/P1 优先级 |
| 产品边界 | `docs/product/feature-scope.md` | 三端功能范围、入口稳定规则、业务闭环边界 |
| 合规边界 | `docs/compliance/compliance-boundary.md` | 招聘信息、用户文件、打印接口和开发检查清单 |
| 目录职责 | `docs/project-structure.md` | 正式源码、正式文档、外部材料、本地协作目录职责 |
| 工程规模与反堆砌 | `.ccg/spec/guides/index.md` | 文件规模阈值、功能归位声明、反堆砌规则、删除和迁移规则 |
| 协作模式 | `docs/reviews/project-normalization-codex-claude-collaboration.md` | Codex、Claude、Antigravity 的职责边界和复审要求 |

新增规范前必须先确认上表没有现成落点；能追加到既有规范的，不新增同义文档。

## 四、任务准入

每个后续分支开工前的**任务准入模板（目标 / 非目标 / 功能归位声明 / 文件预算 / 允许修改 / 禁止修改 / 验证 / 回滚）以 `.ccg/spec/guides/index.md` 的“开发前准入”为准**，本文件不重复模板正文。

治理任务在通用准入之外额外要求：

- 中高风险或跨模块任务，开工前补充 Claude + Antigravity 双模型审查结论（见第七节）。
- 两个模型意见冲突时按更保守的安全边界执行；若冲突影响目标、数据结构、合规或部署路径，停止实施，先让用户确认裁决。

## 五、文件规模与超阈值追踪

普通源码的行数阈值与拆分规则**以 `.ccg/spec/guides/index.md` 为准**，本文件不重复阈值表。下面维护治理需要持续盯防的**已知超阈值文件清单**（2026-08-01 用 `wc -l` 全仓实测重建）。

**`.ts/.tsx` 业务代码当前无超阈值文件**，但 `*/src` 下有 **3 个 CSS 超 1000 行**：

| 文件 | 实测行数 | 状态 |
| --- | --- | --- |
| `apps/kiosk/src/pages/styles/jobs-fairs-foundation.css` | 1361 | 跟踪中 |
| `apps/admin/src/routes/login/login.css` | 1039 | 跟踪中 |
| `apps/partner/src/routes/login/login.css` | 1039 | 跟踪中 |

> **口径修正（2026-08-01 复核）**：本段此前写作「业务代码当前无超阈值文件，`apps/`、`services/*/src`、`packages/` 下没有任何文件超过 1000 行」。该结论来自只统计 `.ts/.tsx` 的命令，漏了同在 `*/src` 下的 CSS。CSS 是否套用同一阈值表尚未定论（选择器块与函数的可拆分性不同），故先入表跟踪，不直接判为违规。复核时不要只筛 `.ts/.tsx`：
>
> ```bash
> find apps services packages -type f -path '*/src/*' -exec wc -l {} + | awk '$1 > 1000 && $2 != "total"' | sort -nr
> ```

此前本表列的 4 个 `.ts/.tsx` 文件在 Phase 7 起的整改中已拆完，实测远低于旧记录：

| 文件 | 旧记录 | 2026-08-01 实测 | 结论 |
| --- | --- | --- | --- |
| `services/api/src/jobs/jobs.service.ts` | ~2300 行 | **219 行** | 已拆完，出表 |
| `apps/admin/src/routes/fairs/index.tsx` | ~1350 行 | **207 行** | 已拆完，出表 |
| `apps/admin/src/routes/companies/index.tsx` | ~1050 行 | **192 行** | 已拆完，出表 |
| `apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` | ~520 行 | **254 行** | 已拆完，出表 |

真正超过 1000 行的是 **verify 脚本**（此前本表完全未记录）：

| 文件 | 实测行数 |
| --- | --- |
| `services/api/scripts/verify-scan-tasks.ts` | 1832 |
| `services/api/scripts/verify-print-sign.ts` | 1578 |
| `services/api/scripts/verify-internal-auth-phone.ts` | 1270 |
| `services/api/scripts/verify-materials-processing.ts` | 1209 |
| `services/api/scripts/verify-terminal-device-config.ts` | 1108 |
| `services/api/scripts/verify-payment-real-channels.ts` | 1107 |
| `apps/kiosk/scripts/verify-home-narrow-visual-balance.mjs` | 1092 |

**verify 脚本单列口径**：一个脚本对应一条完整验收链路，机械按行数拆会割裂验收语义、且拆分本身有让门禁静默失效的风险。因此不套用业务代码阈值，改为：

- 一个脚本只覆盖一个验收主题；新增断言优先扩写既有脚本，不要复制出 `-v2` / `-extra` 变体。
- 超过 1500 行才考虑拆分，且必须**按验收阶段**（setup / 断言 / 清理）拆，不按函数拆。
- 拆分后必须确认 `package.json` 的 `verify:*` 目标和 `.github/workflows/ci.yml` 的调用同步更新，拆完复跑该脚本确认断言数不减少。

清单只作治理盯防；新增或消除超阈值文件时同步更新本表，并注明实测方式。

## 六、拆分约定（补充 `.ccg/spec/guides/index.md`，非替代）

大文件治理优先做**零行为变化**拆分，保持路由、文案、埋点、权限、接口参数、错误提示和空态行为不变；要改变行为必须另起业务功能分支。

- 前端按“五件套”优先拆分：`Page.tsx`（路由级编排）、`components/*`（展示/局部业务组件）、`hooks/*`（数据加载、副作用、表单状态）、`services/*`（API 适配与协议转换）、`types.ts` / `utils.ts`（模块内类型与纯函数）。
- 后端先做零行为变化拆分（repository / validator / state machine / service module / verify script），同一分支内不改数据库模型或 API 契约。
- 涉及 PostgreSQL 迁移、对象存储生命周期、用户文件、支付订单、鉴权或管理员操作日志时，默认视为高风险，必须做双模型审查和最小相关 verify。

## 七、门禁与双模型审查

门禁按三档推进，避免一开始就让开发停摆：advisory（仅提醒，不阻塞）→ required evidence（需在计划或审查报告中写明例外原因）→ blocking（CI / verify 失败即阻塞合入）。第一批只建议建立 advisory 门禁（单文件行数、禁用合规文案、大文件/二进制/本地状态、任务准入模板缺项）；advisory 连续稳定且误报低后，再把高价值规则升级为 required evidence 或 blocking。

需要双模型审查的场景：

- 跨模块或超过 30 行 diff。
- 涉及认证、授权、数据库、支付、用户文件、对象存储、生产部署或硬件链路。
- 涉及合规边界、岗位/招聘会/企业展示、用户隐私或管理员访问能力。
- 删除、ignore、迁移、归档或大文件处置。

审查输出按 `Critical / Warning / Info` 汇总：Critical 必须修复或停止；Warning 需明确采纳、暂缓或拒绝理由；Info 作为后续优化记录。**审查结论的留痕位置**：写入 PR 描述（摘要 Critical / Warning / Info 与最终裁决），或沉淀到 `docs/reviews/` 下的正式审查文档；不得只把双模型审查留在聊天记录里。`.ccg/tasks/` 是 AI 工具本地临时状态、**不入库**（`main` CI 有 “no tracked AI tool state” 门禁，见 `CLAUDE.md` §7），**不得作为审查留痕位置**。

## 八、后续建议（非当前待办）

以下为推荐推进顺序，**仅作建议**；实际优先级与当前待办以 `docs/progress/next-tasks.md` 为准。每项独立分支：

1. advisory 文件规模门禁：只提醒，不阻塞，先覆盖已知大文件和新增 diff。
2. ~~advisory 合规文案门禁~~ — **已落地且已是 blocking，本条作废（2026-08-01 核实，同日复核修正数字）**。实测 `apps/*/scripts` + `services/api/scripts` 下有 **49** 个脚本在扫合规禁词，其中 **40** 个已被 `.github/workflows/ci.yml` 调用（失败即阻塞），9 个未进 CI（6 个属尚未上线的百宝箱相关验收、**2** 个为 UI 局部守卫、**1** 个是 API/业务闭环静态守卫 `services/api/scripts/verify-fair-visit-plan.ts`——该脚本门禁的是 controller/service/LLM/PDF 与 `AiResumeResult`/`FileObject` 闭环，不是 UI，此前误并入「UI 局部守卫」）。此处此前写作 46 / 38，为未记录口径的手工统计，已按下述可复现命令重算：

   ```bash
   # 分母：扫合规禁词的脚本数（49）
   grep -rl -E '一键投递|立即投递|平台投递|投递简历|企业收简历|候选人管理|一键报名' \
     apps/*/scripts services/api/scripts \
     --include='*.ts' --include='*.js' --include='*.cjs' --include='*.mjs' | wc -l
   ```

   分子（40）需判定「脚本被 ci.yml 直接引用，或经 `package.json` 的 `verify:*` 目标间接引用」，无单行命令；复核时按此定义逐个核对，并在改动本数字时同步更新判定口径。实测全部 49 个均为 `.ts`（16）或 `.mjs`（33），无 `.js/.cjs`。真实缺口不是「没有门禁」，而是**门禁分散、词表漂移**：`COMPLIANCE_FORBIDDEN_TERMS` 曾零消费者，各脚本自己硬编码词表且互不一致，导致「一键报名」0 个脚本覆盖、「投递简历」仅 13 个脚本覆盖。整改方向见第十节。
3. ~~`services/api/src/jobs/jobs.service.ts` 零行为拆分试点~~ — **前提已消失，本条作废**。该文件实测 219 行，早已拆完（见第五节）。如需拆分试点，改用第五节列出的 verify 脚本，并按该节的 verify 单列口径执行。
4. Admin 招聘会或企业页面五件套拆分试点：先拆展示和 hooks，保留 UI 行为。
5. 把试点经验回写到本索引或 `.ccg/spec/guides/index.md`，再决定是否扩大。

## 九、暂缓事项

以下事项暂缓，除非用户单独确认：物理目录迁移到 `frontend/` / `backend/` / `terminal/`、全局一次性重构、强制 CI blocking 门禁、清理或删除主工作区未跟踪材料、整包迁入外部商业材料 / 历史 PDF / 交付件。

注：`.ccg/tasks/` 等 AI 工具本地状态目录**恒不入库**（由 `main` CI 门禁拦截，见 `CLAUDE.md` §7），不属于“暂缓后可迁入”范围。

## 十、合规禁词门禁的收敛计划（2026-08-01 新增）

现状实测：门禁存在且多数已 blocking，但**分散、词表漂移、覆盖不均**。

| 项 | 实测 |
| --- | --- |
| 扫禁词的脚本数 | 49（`apps/*/scripts` + `services/api/scripts`；`.mjs` 33 + `.ts` 16） |
| 其中已进 `ci.yml`（失败即阻塞） | 40 |
| 未进 CI | 9（6 个百宝箱相关验收、2 个 UI 局部守卫、1 个 API/业务闭环静态守卫） |
| `COMPLIANCE_FORBIDDEN_TERMS` 的代码消费者 | 收敛前 **0**（自称 SSOT 但无人消费）→ 现为 **1**（`scripts/verify-compliance-copy.mjs`，全量扫三端 src） |
| 互不一致的词表版本 | 收敛前 **5** 份（CLAUDE.md §2 / compliance-boundary.md §三 / role-boundary.md §7 / `complianceCopy.ts` / `verify-fusion-w6.mjs`） |
| 复述词表的 md 文档 | 63 |

收敛步骤（按序推进，不要求一次做完）：

1. **已完成**：`complianceCopy.ts` 的 `COMPLIANCE_FORBIDDEN_TERMS` 合并为 7 项，并新增 `COMPLIANCE_FORBIDDEN_TERM_PATTERNS`（覆盖「平台内投递」等变体）。`role-boundary.md` §7 改为引用而非复述。

2. **已完成**：新建 `verify:compliance-copy`（`scripts/verify-compliance-copy.mjs`，已进 `ci.yml` 的 `build-and-verify`），递归扫 `apps/{admin,kiosk,partner}/src` 全量 `.ts` / `.tsx`（不是页面白名单）。实测扫 437 个文件、禁词命中 38 处、豁免 38 处、违规 0 处。补上的正是「一键报名 0 覆盖」这类缺口。

   两个设计结论值得记住，改这个门禁前先读：

   - **判定不是"命中即违规"**。`平台内?投递` 在业务源码命中 33 处，其中 30 处合规（「去来源平台投递」是白名单文案本身，「不参与平台内投递」是边界声明），前缀有 24 种写法。原先设想的「豁免短语白名单」永远补不齐，已改为按语义标记判定，见 `COMPLIANCE_EXEMPTION_MARKERS`（否定式／指向站外，按前向回看窗口）与 `COMPLIANCE_BAN_DECLARATION_MARKERS`（该行是在*禁止*这些词，按整行判定）。
   - **豁免标记一律不用单字**。实测单字「无」会让「无需注册，一键投递到企业」「无门槛投递简历」全部误判为合规，单字「非」会让「非常快，立即投递」误判为合规。这类漏放比误报危险得多，已把这 5 条句式钉进脚本自检用例，改回单字会立刻失败。

3. 门禁用**文本解析**读 SSOT，不是 `import` —— `packages/shared` 只导出裸 TS（无 dist／无 build），根 verify 脚本在纯 `node` 下跑。解析失败一律 fail-closed 退出，不降级为「跳过检查」；禁词项数与正则项数不一致也直接报错（防「加了词忘加变体正则」）。新增禁词只改数组，门禁自动跟随。

4. 既有 49 个脚本的硬编码词表逐步替换，不要求一次改完；本兜底门禁已覆盖用户可见文案，替换属降低维护成本而非补漏。

5. 63 份 md 逐步改为「以 `complianceCopy.ts` 为准」的引用式表述，避免继续漂移。

**已知剩余缺口（未做，需单独立项）**：`services/api/src` 有 7 处运行时守卫各自硬编码禁词正则（`member-feedback` / `member-notifications` / `llm-career-plan` / `llm-job-fit` / `llm-fair-visit-plan` / `job-ai-llm` / `benefit-activities` 等），词表与 SSOT 不一致，「一键报名」在服务端仍无覆盖。本次未纳入：改动跨 7 个 service 文件、涉及 LLM 输出拦截路径，超出本任务文件预算，且需按真实 AI 输出回归验证。

另有 **8 个 `COMPLIANCE_COPY` key 零消费者**（`KIOSK_JOBS_TOP`、`KIOSK_FAIRS_TOP`、`KIOSK_SCAN_HARDWARE_NOTICE`、`KIOSK_CAMPUS_TOP`、`ADMIN_JOB_SOURCES_TOP`、`ADMIN_FILES_TOP`、`ADMIN_AUDIT_TOP`、`PARTNER_DASHBOARD_TOP`，共 15 个 key）。其余 7 个 key 在 Kiosk 有 **11 处引用/渲染表达式，分布于 7 个文件**（此前写「18 处渲染」有误：`rg COMPLIANCE_COPY` 的 18 是 7 个 import 加 11 个成员访问，import 不是渲染。复核用 `rg -n 'COMPLIANCE_COPY\.[A-Z][A-Z0-9_]+' apps -g '*.ts' -g '*.tsx' | wc -l` 得 11、`rg -l ... | wc -l` 得 7）。所以这不是整体死代码，而是「岗位／招聘会页的来源声明」与「三端后台合规提示」两类文案定义了却没渲染。上线前需逐个判定：该渲染的接上，不该保留的删掉——留着等于给后续开发一个「看起来已有声明」的假象。复核命令：

```bash
node -e "const s=require('fs').readFileSync('packages/shared/src/types/complianceCopy.ts','utf8');const b=s.slice(s.indexOf('export const COMPLIANCE_COPY'),s.indexOf('} as const',s.indexOf('export const COMPLIANCE_COPY')));for(const m of b.matchAll(/^ {2}([A-Z][A-Z0-9_]+):/gm))console.log(m[1])"
# 再对每个 key 检索 COMPLIANCE_COPY.<KEY> 在 apps/ 下的引用
```

## 十一、待立项的代码级缺口（2026-08-01 codex 复审查出，均已独立取证）

三项均为**代码问题**，不是文档表述问题。第 1 项已于 2026-08-01 修复并落门禁，第 2、3 项仍待立项：

1. ~~**P0｜Partner 导入绕过强制重审**~~ ✅ **已修复（2026-08-01）**。原问题：`jobs-partner.service.ts` 的 `importJobs` / `importJobsFromWebhook` / `importFairs` 与 `jobs-excel.service.ts` 的 `confirmExcelImport`（job + jobFair 两支）共五处 upsert 的 `update` 分支均未重置 `reviewStatus`/`publishStatus`，而 Kiosk 只按 `approved`+`published` 过滤 —— 一条**已发布**岗位再次导入会改写标题／公司／描述／`sourceUrl` 后**继续公开且无需再审**，与 `compliance-boundary.md:132`、`role-boundary.md:116` 的「导入/编辑一律回到 pending」矛盾。修复：五处 `update` 分支统一补 `reviewStatus: 'pending', publishStatus: 'draft'`（退回待审、已发布记录下架），并同步清空 `rejectReason` / `reviewedBy` / `reviewedAt` 三项审核元数据（对齐 `jobs-partner.service.ts` 既有 Partner 编辑路径的写法），避免出现「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态。新增静态门禁 `services/api/scripts/verify-import-review-reset.mjs`（`pnpm verify:import-review-reset`，已进 `ci.yml`），11 项断言：5 处 Partner/Excel 必须重置且必须清空元数据 + 2 处 `job-sync.service.ts` 自动拉取**必须不出现无条件重置**的反向断言 + 4 个常驻对抗自测用例（全内存、不写盘）。**`job-sync.service.ts` 未改，但这不是「已经正确」** —— 该处不做**无条件**重置是必要的（否则 `job-sync.scheduler.ts:19` 每 30 分钟一次的 Cron 会把当批同步到的已审岗位全部退回待审、压垮审核队列；具体条数取决于存量，仓库内无实测数字），但它**完全没有变更检测**，因此留下下方第 2 项 P0 缺口；反向断言的作用是把这个缺口**冻结**住（防止有人为统一风格改成无条件重置），断言输出文本已写明「这是已登记 P0 缺口冻结态，不代表当前实现无问题」，并指引实施正解时改断言而非绕过或删除。

   **门禁能力边界（不要外推）**：这是**词法级**检查，不是 AST 证明，且只覆盖上述 5 处已登记 upsert；它**看不见** `update` / `updateMany` / 子资源写入等其它写路径（见第 2 项的溢出面）。在此范围内为 fail-closed，已七向验证：①删一项元数据字段 → exit 1 精确定位到 `importJobs() · job.upsert @L157`；②把一处 `.jobFair.upsert(` 改写成其它调用 → 块数 2≠登记值 3 → exit 1（防「删掉一处后剩余块仍全过」）；③目标文件缺失 → exit 1（原先此路径只打印警告后继续，属 fail-open，已修）；④~⑦ 四个对抗用例已固化为脚本内 `selfTest()`，每次 CI 都跑：`update:` 改为常量引用（无字面量块可解析）、含引号的正则字面量（词法器盲区，改为显式抛错并提示升级 AST）、字符串诱饵冒充字段赋值（`description` 里写满 `reviewStatus: 'pending'`）、把 5 个重置字段搬进嵌套子对象（`meta: {…}`，对 Prisma 无效但能骗过整块正则）。反向验证过：把 `topLevelOnly()` 与「仅保留 token 形字符串」两项修复各自退化后，用例 C/D 立即漏判并使门禁 exit 1，说明自测非空转。
2. **P0｜审核控制不随内容变更重新生效**（**2026-08-01 新登记，仍待立项**）。第 1 项修的是 Partner **主动推送**通道；本项是 API **自动拉取**通道的同类缺口，两者独立。完整链条（均已逐行取证）：
   - `services/api/src/job-sync/job-sync.scheduler.ts:19` —— `@Cron('0 */30 * * * *')`，每 30 分钟触发一次（不是每晚）；
   - `services/api/src/job-sync/job-sync.service.ts:174-176` 起 `enqueueDueSources()` —— 查询 `{ enabled: true, accessMode: 'api' }`，再按 `SYNC_FREQ_THRESHOLD_MS[s.syncFreq]` 与 `lastSyncAt` 筛出**到期**源入队（并非每次全量拉取，但到期后行为等价）；
   - 同文件 `:478-494`（`upsertJobs`）—— `update` 分支改写 `sourceUrl` / `title` / `company` / `city` / `salary` / `description` / `requirements` / `category` / 标签 / 学历 / 经验 / 技能 / 福利 / 薪资区间 / `validThrough` 等**多项关键公开字段**；`:557-565`（`upsertFairs`，upsert 调用在 `:546`）改写 `sourceName` / `sourceUrl` / `title` / `startAt` / `endAt` / `venue` / `city` / `description` / `companyCount`（**不含** `address` / `mapImageUrl` / `coverImageUrl` / 经纬度 / `trafficInfo`）。两处末行注释均为 `// reviewStatus/publishStatus 不覆写，防绕过审核`，即刻意保留审核发布态；
   - `services/api/src/jobs/jobs-kiosk.service.ts:49-50`（岗位列表主过滤）及 `:80`、`:134`、`:190` 等处 —— Kiosk 只按**当前** `reviewStatus:'approved'` + `publishStatus:'published'` 过滤，不校验内容是否与过审时一致。
   
   合成结果：一条已过审岗位，其上游内容（含跳转 `sourceUrl`）在下一次自动同步后被整体替换，仍继续对外公开且不触发重新审核。**这不是「恶意 Partner」问题** —— 任何 API 来源的上游内容漂移都同等绕过审核；`jobs-partner.service.ts:80`（Partner 自建数据源、自填 `endpoint`）与 `:118-120`（Partner 自行开关 `enabled`）只是把触发门槛降到无需管理员参与。
   
   **溢出面（比 Job/JobFair 单行更大，方案设计时必须一并考虑）**：
   - 招聘会子资源另有独立写路径，改动同样不触发退审，且哈希若只覆盖 JobFair 行则完全漏掉：`fair-venue-guide.service.ts:116`、`fair-material.service.ts:179`、`fair-company-zone.service.ts:49` / `:74` / `:109`；
   - `admin-fairs.service.ts:146-196` 管理员直接编辑已发布招聘会，亦无退审；
   - `prisma/seed.ts:194`~`:330`、`seed-fairs.ts:155` / `:177`、`seed-companies.ts:75` / `:77` / `:87` / `:90` 等 20+ 处**直接写入** `approved` + `published`，而 `docs/device/production-deployment-runbook.md:197-201` 仍把 `db:seed` / `db:seed:fairs` / `db:seed:companies` / `db:seed:venue-guide` 列入部署步骤 —— 等于绕过审核流生成公开数据，需单独确认生产是否执行这些 seed；
   - 对照澄清：`companies.service.ts:436` / `:457` / `:483` 三处 `job.updateMany` **只写 `companyProfileId`**，且 `adminLinkJobs` 限定 `...PUBLISHED` 并写审计，不构成内容绕过；但它确实属于**门禁看不见**的 `updateMany` 写路径。

   **不可用的简易判据**：本同步路径每次 update 都会写 `syncTime`（`data:` 非空），Prisma 的 `@updatedAt` 因此必然刷新，即使其余字段值完全相同 —— 故 `updatedAt > reviewedAt` 会在空转同步后误报，不能作为长期判据。（`@updatedAt` 唯一不刷新的情形是 `data:{}` 全空更新，本路径不适用。）
   
   **待批方案（尚未开工，且下列已知设计缺口必须在开工前定完，否则会做出一个假门禁）**：
   - **口径**：不能叫「展示字段哈希」，要定义为**审核敏感字段**白名单 —— `syncTime` 本身就在前台展示（`jobs-shared.ts:399`），若按「展示字段」取哈希则每次同步必变、退审风暴；反之遗漏 `sourceUrl` 则跳转目标可被静默换掉。
   - **规范化**：必须有唯一 canonicalizer 并带版本前缀（如 `job-review:v1`），明确定义 null/空串等价性、日期精度、JSON 键序、URL 归一（大小写/尾斜杠/query 顺序）、Unicode 规范化；否则同一内容在不同环境算出不同哈希。
   - **写入时序**：过审时须在**同一事务**内写哈希，发布时再校验一次，并用 CAS（compare-and-set）防并发 —— 当前 `jobs-admin.service.ts:43` 的审核是「先读后写」，无版本校验。
   - **迁移取舍**：直接把「当前内容」回填为「过审快照」会把**已经漂移**的记录一次性认证为合规，等于用迁移洗白问题；须先跑一次存量漂移排查再决定回填口径（或对无法确证的行标记为需复审）。
   - **覆盖面**：须覆盖上述所有写路径（含 `update` / `updateMany` / 招聘会子资源），不能只拦 `upsert`。
   
   codex 建议的落地顺序（供立项时参考，未采纳为结论）：①短期先做**免迁移**的规范化字段比对 + 事务内退审；②中期上「哈希 + 版本号 + CAS」并覆盖全部写路径；③长期改为不可变内容版本（content revision），审核针对版本而非行。方案获批前，`verify-import-review-reset.mjs` 的两条反向断言即为本缺口的**冻结标记**，改动时按脚本头 ⚠️ 说明同步放开，不得绕过或删除。
3. **P0｜`offline-agencies` 审核/发布/删除全程无审计**（**仍待立项**）。全模块 0 处审计引用；`adminDelete` 先 `offlineJob.deleteMany` 再删机构，同样不写 `AuditLog`。叠加两项既有事实：`audit.service.ts:45` 的 `write()` 设计上「失败只 log 不抛」（审计丢失不阻断业务），且 DB 层无 append-only role。因此凡出现「不可删除、不可篡改」的表述都超出现状 —— 要么补 DB append-only role／防篡改链，要么把文案降级为可验证表述。文件预算 5–8 个。
