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

1. ~~**P0｜Partner 导入绕过强制重审**~~ ✅ **已修复（2026-08-01）**。原问题：`jobs-partner.service.ts` 的 `importJobs` / `importJobsFromWebhook` / `importFairs` 与 `jobs-excel.service.ts` 的 `confirmExcelImport`（job + jobFair 两支）共五处 upsert 的 `update` 分支均未重置 `reviewStatus`/`publishStatus`，而 Kiosk 只按 `approved`+`published` 过滤 —— 一条**已发布**岗位再次导入会改写标题／公司／描述／`sourceUrl` 后**继续公开且无需再审**，与 `compliance-boundary.md:132`、`role-boundary.md:116` 的「导入/编辑一律回到 pending」矛盾。修复：五处 `update` 分支统一补 `reviewStatus: 'pending', publishStatus: 'draft'`（退回待审、已发布记录下架），并同步清空 `rejectReason` / `reviewedBy` / `reviewedAt` 三项审核元数据（对齐 `jobs-partner.service.ts` 既有 Partner 编辑路径的写法），避免出现「当前 pending 却仍显示上次审核人/时间/拒绝原因」的脏状态。新增静态门禁 `services/api/scripts/verify-import-review-reset.mjs`（`pnpm verify:import-review-reset`，已进 `ci.yml`），**31 个汇总检查项**：5 处 Partner/Excel 必须重置且必须清空元数据（每处内部再比对 5 个字段）+ 2 处 `job-sync.service.ts` 自动拉取**必须不出现无条件重置**的反向断言 + 24 个常驻对抗自测用例（全内存合成夹具、不读不写真实文件）。检查项数与站点集合均为**登记值硬编码**（`EXPECTED_SITES` / `EXPECTED_SELFTEST_CASES`），实际值不符即失败 —— 否则「断言静默消失」不会产生任何失败，只会让总数变小。**`job-sync.service.ts` 未改，但这不是「已经正确」** —— 该处不做**无条件**重置是必要的（否则 `job-sync.scheduler.ts:19` 每 30 分钟一次的 Cron 会把当批同步到的已审岗位全部退回待审、压垮审核队列；具体条数取决于存量，仓库内无实测数字），但它**完全没有变更检测**，因此留下下方第 2 项 P0 缺口；反向断言的作用是把这个缺口**冻结**住（防止有人为统一风格改成无条件重置），断言输出文本已写明「这是已登记 P0 缺口冻结态，不代表当前实现无问题」，并指引实施正解时改断言而非绕过或删除。

   **门禁能力边界（不要外推，本段是本门禁唯一权威口径）**：这是**TypeScript AST 级**静态检查（2026-08-01 由词法版重写而来，见下方「实现变更」）。它只覆盖上述 5 处已登记 upsert，**看不见** `update` / `updateMany` / 招聘会子资源等其它写路径（见第 2 项的溢出面）—— 这条边界不因升级 AST 而改变。**不要把它描述成「已证明安全」**：AST 消除的是「解析层被骗」，不是「语义层已证明」；对象字面量之外的动态构造（运行时拼 `data`、把 `update` 整体从别处传入）依旧超出静态可判定范围，脚本对这些形态的处理是**显式抛错**而非放行。准确表述是「已针对下列失效形态各写了断言，且每条断言都经退化验证证明非空转」。已挡住并固化的形态：
   - **漏改类**（exit 1）：删一项重置/元数据字段 → 精确定位到 `importJobs() · job.upsert @L157`；把一处 `.jobFair.upsert(` 改写成其它调用 → 块数不符登记值（防「删掉一处后剩余块仍全过」）；重置值写成表达式而非字面量（`rejectReason: nullFlag`）；**键全在但值写错**（`reviewStatus:'approved'` / `publishStatus:'published'`）—— 此形态原先无用例覆盖，是退化验证自身查出的测试盲区，非 codex 提出。
   - **伪装类**（exit 1）：字符串诱饵冒充字段赋值；把 5 个重置字段搬进嵌套子对象（`meta: {…}`，对 Prisma 无效）；嵌套 `update` 抢占顶层位置；字段名前缀伪装（`xreviewStatus:` 不算 `reviewStatus:`）。
   - **静态不可判定类**（显式抛错 fail-closed，不放行）：目标文件缺失；`update:` 改为常量引用（无字面量可解析）；计算属性名 `['upd'+'ate']:`（键名运行时才定）；重复 `update` 键（JS 语义后者覆盖前者，静态取哪个都可能错）；**upsert 实参第一层的 `update` 位于展开之前**（展开可整体替换 `update`，取不到可信值）；**无法静态归属的 `upsert` 调用**（`prisma[key].upsert` / `getModel().upsert` —— 取不到模型名，第 6 轮修，此前是 `return null` 静默跳过，库存核对也抓不到凭空多出的隐形站点）；**源文件本身有语法错误**（`parseDiagnostics` 非空 → AST 不可信，直接失败而非按空结果放行）；第 7 轮新增：**括号/call/apply/bind/动态下标**对已追踪模型的 upsert 间接调用一律 fail-closed（原先静默跳过，已实测复现 exit 0）。
   - **展开运算符按方向分治**（第 6 轮 + 第 7 轮修正）：
     - **正向断言（checkMustReset）**：JS 对象字面量语义是后写的键覆盖先前的展开，故「五项重置全部位于最后一个展开之后」静态可判定为安全，应放行；位于展开之前或之间则可能被覆写回 `approved`+`published`，判为缺失。原实现对展开一律抛错，但错误提示写的是「请放到展开之后」—— 照做仍然失败，这种「指一条走不通的路」的门禁会逼人绕过它。
     - **反向断言（checkMustNotReset）**：第 6 轮原实现对展开前的写入「按存在处理」（`hasKey` 位置无关）—— 但 `hasKey` 只能看到**显式写出的属性**，`spread-carried` 键（`update: { ...RESET }` 里的字段）对它完全不可见，导致反向断言被展开注入绕过（exit 0，已实测复现）。第 7 轮（2026-08-01）改为：**update 块第一层含任何展开一律 fail-closed**（`b.props.lastSpreadIdx >= 0`），静态无法证明展开对象不携带 `reviewStatus`/`publishStatus`。job-sync.service.ts 的 3 个注册 update 块均无第一层展开（已逐行核实），线上零误报。用例 M/M′ 钉住（spread 变量 + 内联对象展开各一条）。
   - **容差**（不误报）：`as const` / `satisfies` / 括号 / 非空断言包装的字面量正常放行（`reviewStatus: 'pending' as const` 判为通过）。
   - **反向断言**：2 处 `job-sync.service.ts` 的 update 块**出现 `reviewStatus` / `publishStatus` 任一键**（任意形态的赋值都算，非仅字面量）→ exit 1（缺口冻结，见第 2 项）。判据是「键在不在」而非「值等不等于 `'pending'`」——第 6 轮修正，原字面量判据可被三种普通写法绕过，见下方。

   **实现变更（2026-08-01，同日内第二次修）**：原词法版存在两个已复现的实缺陷，故整体重写为 AST：①**P0 fail-open** —— `selfTest()` 若返回非预期形态（如 `return 1`），解构出 `undefined` 使 `totalFail` 变 `NaN`，`NaN > 0` 为假，于是门禁**先打印真实失败行、再打印 `ALL PASS` 并 exit 0**（已端到端复现）。现已加返回值形态守卫 + 最终计数 `Number.isInteger` 守卫，任一异常按失败处理。②词法器把 `return /}/` 的正则字面量当除法读，导致块提取提前截断而放行。AST 版（`ts.createSourceFile` + `parseDiagnostics` + `ObjectLiteralExpression` 遍历）从构造上消灭正则、计算属性名、重复键、实参级展开四类绕过，行数由 681 降至 593，且零新增依赖（`typescript@5.9.3` 本就是 devDependency）。**教训记录**：词法路线在三轮对抗中累计被绕过 7 次以上，是路线选择错误而非补丁不足 —— 同类问题不要再用正则加固。

   **第 6 轮修正（2026-08-01，codex 复审 AST 版后）**：AST 化解决了解析层，却在**判定层**留下三类同源缺陷，均已实测复现后修复。现 832 行。
   - **反向断言被三种普通写法绕过**（最严重）：原实现沿用正向的 `isStr('pending')` 判据，于是 `reviewStatus: PENDING_STATUS`（identifier）、`reviewStatus,`（shorthand）、`` reviewStatus: `pending` ``（模板串）都不是 `StringLiteral` 节点 → 判为「重置缺席」→ 静默放行。三种均已在真实 `job-sync.service.ts` 上复现门禁 exit 0，即上文所称的「冻结 P0 缺口」实际**什么也没冻结**。根因是**方向不对称**没被识别：正向（必须重置）要严格，只有确切字面量算数；反向（不得无条件重置）要宽松，任何形态的赋值都算。同一个判据用在两个方向，必然废掉其中一个。已改为「键存在即失败」，四条常驻用例（K′/K″/K‴/K⁗）钉住。
   - **计数 fail-open 两例，与上文①同类**：`selfTest` 返回 `leaked: -1` 会**抵消**真实站点的失败数（实测：植入一处真实失败后仍打印「24 PASS 0 FAIL」并 exit 0）；返回 `total: 0` 则让断言凭空消失而不产生任何失败（实测打印「总计 7 项 ✅ 7 PASS」exit 0）。已加计数越界守卫 + 登记值比对 + 最终 `totalPass + totalFail === EXPECTED_TOTAL` 校验。另经退化测试自查发现第三例：`total: cases.length` 报的是**意图**而非实际执行数，把循环源换成空数组时 34 条用例全部不跑而计数不变 → 已改为在循环末尾累加 `executed`，只有真正跑完判定才计数。
   - **库存核对只比数量**：`importFairs` 的模型从 `jobFair` 改成别的，数量不变 → 通不出失败。已改为**站点集合**（`函数名·模型`）与登记值做差集，分别报「缺失（写入点被删/改名/换模型，门禁失去覆盖）」与「多出（新增未登记写入点）」。
   - **自测的失败归属未真正校验**：原先只确认「提取结果里存在该 site」，而存在不等于就是它失败的。两个 checker 现返回结构化 `failures`，用例据此断言失败 site 归属与**确切的缺失字段集合**（`wantMissing`）。这条不只是严谨性：K⁗ 若只写单键，把另一键的 `hasKey` 降级成 `trustedValue` 仍会因剩下那键报失败 → 变异逃逸；钉住键集合后才抓得到（已实测）。

   **第 7 轮修正（2026-08-01，codex 复审 Round 6 AST 版后的 High 报告）**：codex 复审发现两个 High 级绕过，均已实测复现（exit 0）后修复。用例数 24→34（+10），门禁总计 41 项（7 站点 + 34 自测）。
   - **High 1｜spread-carried 键绕过反向断言**：`checkMustNotReset` 使用 `hasKey` 判断 `reviewStatus`/`publishStatus` 是否存在。`hasKey` 只能看到**显式写出**的属性键，对 `update: { ...RESET }` 形态里展开对象携带的键**完全不可见** —— 探针实测确认 `hasKey(reviewStatus)=false` 且 exit 0。修复：update 块第一层含任何展开时一律 fail-closed（`b.props.lastSpreadIdx >= 0`），静态无法证明展开对象不携带审核字段。job-sync.service.ts 的 3 个注册 update 块均无第一层展开（逐行核实），线上零误报。新增用例 M（spread 变量）和 M′（内联对象展开）钉住两种形态。K⁗ 的断言从 `wantMissing: ['reviewStatus','publishStatus']` 改为 `wantSpreadFail: true`（spread guard 比 `hasKey` 先触发，K⁗ 仍覆盖「显式键 + spread 共存」这一独特场景）。
   - **High 2｜callee 未 unwrap 导致三种间接调用被静默跳过**：`upsertModelOf` 直接对 `call.expression` 调用 `memberName`，未先剥掉类型层包装（`as`、`()`、`!` 等），三种形态各以不同机制绕过：①`(this.prisma.job.upsert)(...)` —— `ParenthesizedExpression`，`memberName` 返回 null，整个调用被 `return null` 静默跳过；②`this.prisma.job.upsert.call(this.prisma.job, {...})` —— `memberName` 返回 `'call'` ≠ `'upsert'`，同样 `return null`；③`this.prisma.job['up'+'sert'](...)` —— 动态下标，`memberName` 返回 null，`return null`。三种形态全部实测复现 exit 0。修复：`upsertModelOf` 先对 `call.expression` 调用 `unwrap()`，再用专门分支对 `.call/.apply/.bind`（throw）和动态下标（throw，仅限已追踪模型）fail-closed，其余正常分析。新增用例 N/O/P 三条分别钉住三种形态；新增 Q/Q′/Q″/Q‴/Q⁴ 五条单字段缺失回归用例。

   **第 8 轮修正（2026-08-02，codex 复审 Round 7 后的 H-1 报告）**：codex 复审发现一个 High 级绕过 + 一个 Medium 级覆盖缺口 + 两处 Low 级注释错误，全部修复。用例数 34→37（+3），门禁总计 44 项（7 站点 + 37 自测）。
   - **H-1｜ElementAccess 字符串字面量下标绕过**：`upsertModelOf` 的 ElementAccess 分支只处理**动态**下标（`!ts.isStringLiteralLike(subscript)`），字符串字面量下标（如 `upsert['call'](ctx, {...})`）通过 `isStringLiteralLike` 检查后 fallthrough 到后续 `memberName(callee)` —— 取到 `'call'` ≠ `'upsert'` → `return null`（fail-open）。与 Round 7 High 2 的 PropertyAccess `.call` 绕过**同源**：二者都是「方法名不是 upsert，跳过」，只是 AST 节点类型不同。修复：字符串字面量下标先判 `subText ∈ {call,apply,bind}`，若内部 `memberName === 'upsert'` 则 throw（与 PropertyAccess 分支等效）；`subText === 'upsert'` 继续 fallthrough；其他字符串 `return null`。已注明设计边界（H-2）：alias 形态 `const repo = this.prisma.job; repo.upsert(...)` 仍返回 null，属 inventory-based 门禁的已知边界（alias 须手动新增 `EXPECTED_SITES`，否则库存核对失败）。
   - **M-1｜PropertyAccess `.apply`/`.bind` 无覆盖**：Round 7 High 2 修复后，PropertyAccess 分支已拦截 `.call`/`.apply`/`.bind`，但自测用例只有 O（`.call`），没有 O′（`.apply`）和 O″（`.bind`）—— 分支已实现，覆盖有盲点。新增 O′/O″ 补齐 PropertyAccess 路径；新增 O‴ 钉住 H-1 修复的 `['call']` ElementAccess 路径（此为真实新功能覆盖，无对应退化项）。
   - **L-2a｜注释计数错误**：`checkMustNotReset` 注释称「job-sync.service.ts 的 **3 个**注册 update 块」，实为 **2 个**（`upsertJobs·job` + `upsertFairs·jobFair`，`EXPECTED_SITES` 可核）。
   - **L-2b｜错误消息误导修复路径**：spread fail-closed 的报错提示「或拆分不含审核字段的展开到独立变量」—— 实际上把展开拆到独立变量后再展开**同样触发**此门禁（门禁检测的是 `update` 块第一层是否含 `SpreadAssignment`，与展开来源无关）。改为「拆到独立变量后再展开仍会触发此门禁，须彻底消除展开」，防止维护者按错误指引绕一圈再来。

   **第 9 轮修正（2026-08-02，codex 复审 Round 8 后的 H-1 + M-1 报告）**：codex 复审发现 2 项 High 级绕过 + 1 项 Medium 级覆盖缺口，全部修复。用例数 37→41（+4），门禁总计 48 项（7 站点 + 41 自测）。
   - **H-1 延续①｜ElementAccess subscript 未 unwrap（括号包裹字面量绕过）**：Round 8 的 ElementAccess 分支在判断 `isStringLiteralLike` 前未先 `unwrap(callee.argumentExpression)`，使 `upsert[('call')](...)` 中的 `('call')` 停在 ParenthesizedExpression 节点 → `isStringLiteralLike` 在 Paren 节点失败 → fallthrough 到动态分支 → `dynOwner=...upsert`、`dynModel='upsert'` → return null（fail-open）。与 Round 8 H-1 **同源**（字符串字面量下标走 PropertyAccess/ElementAccess 绕过），仅外层 AST 包装不同。修复：`const subscript = unwrap(callee.argumentExpression)`，统一在进入 `isStringLiteralLike` 前先剥包装。新增用例 **O⁴** 钉住。
   - **M-1 延续｜ElementAccess `['apply']`/`['bind']` 无专属用例**：O‴ 已钉住 `['call']` 路径，但 `['apply']` 和 `['bind']` 走同一 ElementAccess 字面量分支，缺专属用例 —— 分支已实现，退化时无侦测点。新增 **O⁵**（`upsert['apply'](…)` → throw）和 **O⁶**（`upsert['bind'](…)` → throw）补全。
   - **H-1 延续②｜动态下标施加在 upsert 自身（fail-open）**：`upsert['ca'+'ll'](...)` 中 subscript 为 BinaryExpression（动态），`dynOwner=…upsert`、`dynModel='upsert'`，Round 8 动态分支仅判 `dynModel ∈ {job,jobFair}` → `upsert` 漏过，return null（fail-open）。修复：追加 `if (dynModel === 'upsert') { throw ... }`，将 upsert 自身作为间接调用宿主一并拦截。新增用例 **O⁷** 钉住。已知剩余边界（JSDoc 存档）：`upsert['call']['call'](...)` 多级链式形态 —— `memberName(upsert['call'])` 返回 `'call'` ≠ `'upsert'` → return null，属递归下探缺失；生产代码不出现此形态，递归代价不合比例，记录为 documented limit。

   **第 10 轮修正（2026-08-02，codex 复审 Round 9 后的 M-1 + M-2 报告，含 Round 10 自发现缺陷）**：codex 复审报告 M-1（`ExpressionWithTypeArguments` 未被 `unwrap()` 识别）和 M-2（`job[('upsert')]` 无专属用例），以及 Round 10 开发中自发现 `memberName()` 未 unwrap 下标（实为 fail-open，非 codex 所报的"已正确检测"）。全部修复。用例数 41→45（+4），门禁总计 52 项（7 站点 + 45 自测）。
   - **M-1｜EWA 未被 unwrap 剥除（fail-open）**：`(this.prisma.job.upsert<any>)({...})` 在 TypeScript 5.x 产生 `CallExpression → ParenthesizedExpression → ExpressionWithTypeArguments`；`unwrap()` 循环未处理 EWA 节点，停在 EWA 上 → `memberName(EWA)` 返回 null → `upsertModelOf` return null（fail-open）。经 `ts.createSourceFile` 实测确认 AST 节点类型。修复：在 `unwrap()` 追加 `else if (ts.isExpressionWithTypeArguments?.(n)) n = n.expression`。新增用例 **Q⁵**（含完整 reset，正向放行）与 **Q⁶**（缺 `reviewStatus`，检出缺失）钉住。
   - **Round 10 自发现｜memberName() 未 unwrap 下标（fail-open，高于 codex M-2 预估严重度）**：codex M-2 认为 `job[('upsert')]` 已被正确检测、仅缺用例 —— 实测 Q⁷ 初始运行为 FAIL（期望 pass，实际 0 块），证明 codex 报告有误，真实情况是 fail-open。根因：`memberName()` 对 `ElementAccessExpression` 直接取 `node.argumentExpression`，未先 `unwrap`；`job[('upsert')]` 中 `argumentExpression` 是 `ParenthesizedExpression('upsert')`，不满足 `isStringLiteralLike` → 返回 null → line-341 `memberName(callee) !== 'upsert'` → return null（fail-open）。修复：`memberName()` 内改为 `const a = node.argumentExpression != null ? unwrap(node.argumentExpression) : null`，统一先剥包装再检字面量。新增用例 **Q⁷**（含完整 reset，正向放行）与 **Q⁸**（缺 `publishStatus`，检出缺失）钉住。

   **第 11 轮修正（2026-08-02，Plan B：Low fix + documented limits）**：用例数 45→48（+3），门禁总计 55 项（7 站点 + 48 自测）。
   - **Low｜owner 未 unwrap（fail-open）**：`(this.prisma.job).upsert(...)` 中 `callee = PropertyAccessExpression('.upsert')`，`callee.expression = ParenthesizedExpression(PropertyAccess('this.prisma.job'))`；旧代码直接取 `callee.expression` 作 `owner` → `memberName(owner)` 对 Paren 节点返回 null（不是 PAE/EAE）→ `owner.text` 也无 `.text` → `model = null` → fail-open（`throw`）。事实上 `(this.prisma.job).upsert` 是合法的生产写法（e.g. 析构或临时引用）。修复：`const rawOwner = callee.expression`（仅 PAE/EAE 时）；`const owner = rawOwner ? unwrap(rawOwner) : null`，统一先剥包装再取模型名。新增用例 **R₁**（正向放行）与 **R₂**（缺 `rejectReason`，检出缺失）钉住。
   - **Medium / documented limits（不修复）**：以下三种形态门禁不可见，已在 JSDoc 和此处双重登记：
     - ① **逗号运算符**：`(0, this.prisma.job.upsert)(...)` —— callee 经 `unwrap` 后仍是 `BinaryExpression`，非 PAE/EAE，`memberName` 返回 null → `upsertModelOf` return null → 门禁不可见。用例 **R₃** 证明（`wantBlocks:0 + expect:'pass'`）。
     - ② **条件表达式**：`(cond ? prisma.job.upsert : noop)(...)` —— callee 是 `ConditionalExpression`，同理不可见。无专属用例（形态明确，codex 可随时补）。
     - ③ **Reflect.apply**：`Reflect.apply(prisma.job.upsert, ctx, [{...}])` —— upsert 作为参数传递，门禁不扫函数参数，不可见。无专属用例（同上）。
     以上三种形态在当前三个注册文件中均无此写法；生产代码若引入须同步审查。

   **退化验证**（证明断言不是空转，逐一单独破坏后复原）：第 5 轮 9 项、第 6 轮扩到 **16 项**、第 7 轮扩到 **26 项（16+10）全部被抓到**，且每项都能指认是哪条自测用例抓到的。第 6 轮覆盖：正向判据放宽成「是字符串字面量就算」、反向断言退回 `isStr`、反向断言的 `hasKey` 被误改成 `trustedValue`（两个键各一例）、`trustedValue` 去掉位置判断、`leaked` 返回负数、`total: 0`、循环一条不跑、跑一半 break、站点集合少登记一处、站点换模型、checker 不回传 `failures`、第一层判定被改成递归（嵌套重置被误判有效）、语法错误不再 fail-closed、无法归属的 `upsert` 退回静默跳过、字符串下标不再识别。第 7 轮新增 10 项：callee 不 unwrap（括号绕过）、不检测 `.call`、`.call` 改 return null、不检测动态下标、动态下标改 return null、禁用 spread fail-closed guard、guard 不 push failure、guard fail++ 改 pass++、REQUIRED 删 reviewStatus、REQUIRED 删 publishStatus。**第 8 轮未新增退化项**（O′/O″ 走既有 PropertyAccess 分支已验证；O‴ 的 H-1 新分支以自测用例本身为证，等效于 1 项内置退化验证；L-2 为注释修正）。**第 9 轮未新增退化项**（O⁴/O⁷ 的两处 H-1 延续修复各以对应自测用例为内置证据；O⁵/O⁶ 补全 ElementAccess 覆盖的 M-1 延续，无需额外退化脚本）。**第 10 轮未新增退化项**（Q⁵/Q⁶ 的 EWA 修复和 Q⁷/Q⁸ 的 `memberName` 修复均以对应自测用例为内置证据；Q⁷ 初始为 FAIL 本身即证明修复前 fail-open 可被侦测，相当于内置退化验证）。**第 11 轮未新增退化项**（R₁/R₂ 的 owner-unwrap 修复以对应自测用例为内置证据；R₃ 的 `wantBlocks:0` 断言在有人"修复"该限制时会立即失败，相当于内置防退化锚点）。**退化脚本用后即删**，因为它就地改写受 CI 依赖的门禁源码，留在树里风险大于收益（脚本内有 SHA-256 还原校验，但那只保证单次运行的还原）。**方法论硬规则**（本轮踩坑两次得出）：任何「破坏代码看门禁是否报警」的验证，必须先断言待替换文本**确实存在**（`assert needle in src`），否则「没报警」在「守卫空转」和「替换从未生效」之间不可区分 —— 本轮先后有 2 次因 heredoc 反斜杠转义吞掉替换串而误报「守卫是空转」。故退化脚本一律写成**文件**执行，不用 heredoc 内联。

   **仍未实现**：codex 建议的 service 级运行时测试（mock Prisma、断言实际传给 `upsert()` 的实参里确实带 `pending`/`draft`）**尚未立项** —— 静态检查读的是源码文本，运行时测试验的是实际调用行为，二者不可互相替代。
2. **P0｜审核控制不随内容变更重新生效**（**2026-08-01 新登记，仍待立项**）。第 1 项修的是 Partner **主动推送**通道；本项是 API **自动拉取**通道的同类缺口，两者独立。完整链条（均已逐行取证）：
   - `services/api/src/job-sync/job-sync.scheduler.ts:19` —— `@Cron('0 */30 * * * *')`，每 30 分钟触发一次（不是每晚）；
   - `services/api/src/job-sync/job-sync.service.ts:174-176` 起 `enqueueDueSources()` —— 查询 `{ enabled: true, accessMode: 'api' }`，再按 `SYNC_FREQ_THRESHOLD_MS[s.syncFreq]` 与 `lastSyncAt` 筛出**到期**源入队（并非每次全量拉取，但到期后行为等价）；
   - 同文件 `:478-494`（`upsertJobs`）—— `update` 分支改写 `sourceUrl` / `title` / `company` / `city` / `salary` / `description` / `requirements` / `category` / 标签 / 学历 / 经验 / 技能 / 福利 / 薪资区间 / `validThrough` 等**多项关键公开字段**；`:557-565`（`upsertFairs`，upsert 调用在 `:546`）改写 `sourceName` / `sourceUrl` / `title` / `startAt` / `endAt` / `venue` / `city` / `description` / `companyCount`（**不含** `address` / `mapImageUrl` / `coverImageUrl` / 经纬度 / `trafficInfo`）。两处均刻意保留审核发布态，但**只有 `upsertJobs` 在 `:493` 写了注释** `// reviewStatus/publishStatus 不覆写，防绕过审核`；`upsertFairs` 无任何注释说明，属**隐式**约定 —— 后续维护者看不出这是刻意为之，实施正解时容易漏改这一支；
   - `services/api/src/jobs/jobs-kiosk.service.ts:49-50`（岗位列表主过滤）及 `:80`、`:134`、`:190` 等处 —— Kiosk 只按**当前** `reviewStatus:'approved'` + `publishStatus:'published'` 过滤，不校验内容是否与过审时一致。
   
   合成结果：一条已过审岗位，其上游内容（含跳转 `sourceUrl`）在下一次自动同步后被整体替换，仍继续对外公开且不触发重新审核。**这不是「恶意 Partner」问题** —— 任何 API 来源的上游内容漂移都同等绕过审核；`jobs-partner.service.ts:80`（Partner 自建数据源、自填 `endpoint`）与 `:118-120`（Partner 自行开关 `enabled`）只是把触发门槛降到无需管理员参与。
   
   **溢出面（比 Job/JobFair 单行更大，方案设计时必须一并考虑）**：
   - 招聘会子资源另有独立写路径，改动同样不触发退审，且哈希若只覆盖 JobFair 行则完全漏掉：`fair-venue-guide.service.ts:116`、`fair-material.service.ts:179`、`fair-company-zone.service.ts:49` / `:74` / `:109`；
   - `admin-fairs.service.ts:146-196` 管理员直接编辑已发布招聘会，亦无退审；
   - seed 脚本**直接写入** `approved` + `published`，共 **17 个写分支 / 34 处状态赋值**（已逐处核数：`seed.ts` 11 处 `:194`–`:318`、`seed-fairs.ts` 2 处 `:155-156` / `:177-178`、`seed-companies.ts` 4 分支 = 2 个 upsert 各含 create+update，`:75`/`:77` 与 `:87`/`:90`）。另有 `seed.ts:330` 为 `approved` + **`draft`**（注释明写「演示用:已审核但还未发布 — 不应出现在 Kiosk」），是刻意的第 18 个分支，不计入公开面。**其中 `seed-companies.ts:77` / `:90` 是 `update:` 分支** —— 重跑 seed 会把管理员已下架（`unpublished`）的记录**强制改回 `approved+published`**，即 seed 不只是「生成」公开数据，还会**覆盖管理员决策**。而 `docs/device/production-deployment-runbook.md:197-201` 仍把 `db:seed` / `db:seed:fairs` / `db:seed:companies` / `db:seed:venue-guide` 列入部署步骤 —— 需单独确认生产是否执行这些 seed；
   - 对照澄清：`companies.service.ts:447` / `:458` / `:486`（行号已核，此前误记为 436/457/483）三处 `job.updateMany` **只写 `companyProfileId`**，且 `adminLinkJobs` 限定 `...PUBLISHED`（`:440-443`）并写审计（`:449-453`），**不构成展示内容绕过**。但两点必须记住：①它属于**门禁看不见**的 `updateMany` 写路径；②`companyProfileId` 会进入**前台公开 DTO**（`jobs-shared.ts:404`），并直接决定 Kiosk 岗位详情「查看企业」按钮的可用态与副文案（`JobDetailSections.tsx:231`，未关联时置灰显示「来源企业未关联」）和跳转目标（`JobDetailPage.tsx:123` → `/companies/{id}`）。因此它改的是**对外关联关系**，不是纯内部字段 —— 审核敏感字段白名单必须**显式表态**：关联关系变更是否需要重新过审（若纳入，则改关联即退审；若不纳入，需说明为何换一家企业指向不算内容变更）。不做决定就等于默认「不需要」，而这个默认值没有经过评估。

   **不可用的简易判据**：本同步路径每次 update 都会写 `syncTime`（`data:` 非空），Prisma 的 `@updatedAt` 因此必然刷新，即使其余字段值完全相同 —— 故 `updatedAt > reviewedAt` 会在空转同步后误报，不能作为长期判据。（`@updatedAt` 唯一不刷新的情形是 `data:{}` 全空更新，本路径不适用。）
   
   **待批方案（尚未开工，且下列已知设计缺口必须在开工前定完，否则会做出一个假门禁）**：
   - **口径**：不能叫「展示字段哈希」，要定义为**审核敏感字段**白名单 —— `syncTime` 本身就在前台展示（`jobs-shared.ts:399`），若按「展示字段」取哈希则每次同步必变、退审风暴；反之遗漏 `sourceUrl` 则跳转目标可被静默换掉。
   - **规范化**：必须有唯一 canonicalizer 并带版本前缀（如 `job-review:v1`），明确定义 null/空串等价性、日期精度、JSON 键序、URL 归一（大小写/尾斜杠/query 顺序）、Unicode 规范化；否则同一内容在不同环境算出不同哈希。
   - **写入时序**：过审时须在**同一事务**内写哈希，发布时再校验一次，并用 CAS（compare-and-set）防并发 —— 当前 `jobs-admin.service.ts:43` 的审核是「先读后写」，无版本校验。
   - **迁移取舍**：直接把「当前内容」回填为「过审快照」会把**已经漂移**的记录一次性认证为合规，等于用迁移洗白问题；须先跑一次存量漂移排查再决定回填口径（或对无法确证的行标记为需复审）。
   - **覆盖面**：须覆盖上述所有写路径（含 `update` / `updateMany` / 招聘会子资源），不能只拦 `upsert`。
   
   codex 建议的落地顺序（供立项时参考，未采纳为结论）：①短期先做**免迁移**的规范化字段比对 + 事务内退审；②中期上「哈希 + 版本号 + CAS」并覆盖全部写路径；③长期改为不可变内容版本（content revision），审核针对版本而非行。方案获批前，`verify-import-review-reset.mjs` 的两条反向断言即为本缺口的**冻结标记**，改动时按脚本头 ⚠️ 说明同步放开，不得绕过或删除。
3. **P0｜`offline-agencies` 审核/发布/删除全程无审计**（**仍待立项**）。全模块 0 处审计引用；`adminDelete` 先 `offlineJob.deleteMany` 再删机构，同样不写 `AuditLog`。叠加两项既有事实：`audit.service.ts:45` 的 `write()` 设计上「失败只 log 不抛」（审计丢失不阻断业务），且 DB 层无 append-only role。因此凡出现「不可删除、不可篡改」的表述都超出现状 —— 要么补 DB append-only role／防篡改链，要么把文案降级为可验证表述。文件预算 5–8 个。
