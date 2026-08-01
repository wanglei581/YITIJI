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

**业务代码当前无超阈值文件。** `apps/`、`services/*/src`、`packages/` 下没有任何文件超过 1000 行；此前本表列的 4 个文件在 Phase 7 起的整改中已拆完，实测远低于旧记录：

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
2. ~~advisory 合规文案门禁~~ — **已落地且已是 blocking，本条作废（2026-08-01 核实）**。实测 `apps/*/scripts` + `services/api/scripts` 下有 46 个脚本在扫合规禁词，其中 38 个已被 `.github/workflows/ci.yml` 调用（失败即阻塞）。真实缺口不是「没有门禁」，而是**门禁分散、词表漂移**：`COMPLIANCE_FORBIDDEN_TERMS` 曾零消费者，各脚本自己硬编码词表且互不一致，导致「一键报名」0 个脚本覆盖、「投递简历」仅 13 个脚本覆盖。整改方向见第十节。
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
| 扫禁词的脚本数 | 46（`apps/*/scripts` + `services/api/scripts`） |
| 其中已进 `ci.yml`（失败即阻塞） | 38 |
| `COMPLIANCE_FORBIDDEN_TERMS` 的代码消费者 | 收敛前为 **0**（自称 SSOT 但无人 import） |
| 互不一致的词表版本 | 收敛前 **5** 份（CLAUDE.md §2 / compliance-boundary.md §三 / role-boundary.md §7 / `complianceCopy.ts` / `verify-fusion-w6.mjs`） |
| 复述词表的 md 文档 | 63 |

收敛步骤（按序推进，不要求一次做完）：

1. **已完成**：`complianceCopy.ts` 的 `COMPLIANCE_FORBIDDEN_TERMS` 合并为 7 项，并新增 `COMPLIANCE_FORBIDDEN_TERM_PATTERNS`（覆盖「平台内投递」等变体）与 `COMPLIANCE_ALLOWED_PHRASES`（豁免「去来源平台投递」等合规短语）。`role-boundary.md` §7 改为引用而非复述。
2. 新脚本**必须** import 上述常量，禁止再硬编码词表；既有 46 个脚本逐步替换，不要求一次改完。
3. 新建 `verify:compliance-copy` 作为兜底：递归扫 `apps/*/src` 全量 `.ts` / `.tsx`（不是页面白名单），用 patterns + allowed-phrases 判定，进 CI。这条补的正是「一键报名 0 覆盖」这类缺口。
4. 63 份 md 逐步改为「以 `complianceCopy.ts` 为准」的引用式表述，避免继续漂移。
