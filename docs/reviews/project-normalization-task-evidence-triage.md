# 项目规范化 T4：C 类任务证据筛选报告

> 生成时间：2026-06-21
> 分支：`codex/normalization-evidence-triage`
> 范围：主工作区 `.ccg/tasks/` 任务证据筛选；不提交原始任务包，不移动、不删除主工作区文件。

## 结论

T4 不把 `.ccg/tasks/` 整包纳入仓库。该目录混合了可复用工程证据、会话动作记录、历史截图、patch、本地路径和预生产拓扑信息；直接提交会放大噪声、泄露本机路径或部署结构，并增加二进制体积。

本轮只沉淀三类内容：

- 可复用结论：哪些任务证据值得后续整理成正式文档或执行计划。
- 排除规则：哪些任务目录只作为本地过程记录，不进入 Git。
- 风险规则：哪些内容必须脱敏、只登记指针或另起任务。

## 快照统计

统计来源为主工作区 `.ccg/tasks/`，统计时间为 2026-06-21。

> 注：该统计是报告生成时点快照。后续新增或删除规范化任务记录时，递归目录数和文件总数可能出现轻微漂移；处置规则以本报告结论为准。

| 项目 | 数量 |
| --- | ---: |
| 顶层目录 | 53 |
| 递归目录 | 112 |
| 文件总数 | 186 |
| `task.json` | 108 |
| `review.md` | 26 |
| `requirements.md` | 12 |
| `plan.md` | 4 |
| 图片文件 | 12 |
| patch 文件 | 1 |

## 筛选规则

| 价值档 | 判定标准 | 处置 |
| --- | --- | --- |
| 摘要入库 | 已完成，包含可复用架构、验证、审查、部署或清理结论，且可脱敏表达 | 写入正式报告或后续专项文档，不复制原目录 |
| 脱敏摘要 | 有价值但包含预生产拓扑、绝对路径、工具日志路径或服务配置上下文 | 只写结构和结论，用占位符替代具体主机、路径、密钥和本机目录 |
| 指针登记 | 截图、patch、历史视觉稿、archive 过程证据 | 只登记源目录和结论，不复制二进制或 patch |
| 另起任务 | `in_progress`、高风险、需用户确认、会影响业务闭环或运行时代码 | 转为独立任务、独立分支、独立验证 |
| 不入库 | `ack-*`、`advise-*`、`explain-*`、`write-*`、`list-*`、`summarize-*`、`wait-*`、`choose-*`、`confirm-*` 等会话动作记录 | 不提交原文，只在必要时把最终结论同步到正式文档 |

## 高价值证据清单

| 任务目录 | 状态 | 价值 | 处置 |
| --- | --- | --- | --- |
| `code-slimming-audit-safe-cleanup` | completed | 三方审计形成低风险清理共识，包含删除证据、本地缓存边界和验证建议 | 摘要入库；后续代码瘦身任务可引用结论，不复制原目录 |
| `code-slimming-controlled-round2` | in_progress | 形成第二轮候选矩阵，结论为没有新的可立即删除源码项，多个候选需用户确认 | 另起任务；标注为快照，不作为终态 |
| `productization-closed-loop-audit` | in_progress | 包含页面、按钮、接口、数据、后台承接矩阵，是后续业务闭环迁移的重要输入 | 摘要入库；后续转为正式闭环审计文档时需再次脱敏扫描 |
| `profile-commercial-closure-plan` | in_progress | 对应“我的页商用闭环”首批实施计划，是 P1 渐进式重构第一候选 | 另起业务闭环任务；不在 T4 下结论 |
| `project-directory-restructure-plan` | completed | 双模型只读评审确认当前不做物理目录迁移，只做目录索引和影响清单 | 摘要入库；已与当前治理路线一致 |
| `deploy-baidu-preprod` | in_progress | 预生产部署目标和安全要求，含主机、端口和运行链路事实 | 只做脱敏摘要；不复制主机、端口 URL 或原文 |
| `p0-production-ci-gates` | in_progress | 上线前生产与 CI 门禁补强任务 | 另起生产门禁任务；需结合实际 commit / CI 结果复核 |
| `production-pg-client-build-fix` | in_progress | PostgreSQL Prisma client 生产构建修复相关 | 摘要入库时只引用已合并提交和验证命令 |
| `solidify-kiosk-prod-build-config` | completed | Kiosk 生产构建配置守卫 | 摘要入库；不复制含服务名或工具日志的 review 原文 |
| `campus-fair-visibility-strategy` | completed | 校园招聘会可见范围和前端展示方案 | 已在 T3 抽取设计摘要；后续按招聘会闭环推进 |
| `smart-campus-jobfair-closed-loop-design` | completed | 智慧校园与招聘会三端功能数据闭环设计 | 摘要入库；后续招聘会闭环任务引用 |
| `smart-campus-jobfair-delivery-closure` | completed | 智慧校园与招聘会权限数据闭环上线交付收口 | 摘要入库；需以代码、verify 和 PR 状态复核 |

## 指针登记清单

以下目录含图片、patch 或历史视觉证据。T4 只登记，不复制文件：

| 任务目录 | 内容类型 | 处置 |
| --- | --- | --- |
| `archive/2026-06/campus-screenshot-faithful-redesign` | plan、review、截图、patch | 只登记为历史视觉复盘证据；是否归档到外部材料由 T5 处理 |
| `archive/2026-06/campus-high-fidelity-ui` | plan、review、截图 | 只登记为历史视觉复盘证据；不进入 Git 二进制 |
| `archive/2026-06/start-services-screenshot-docs` | 启动服务与截图整理过程 | 只登记，不复制截图 |

## 不入库清单

以下任务名前缀主要是会话动作或过程提示，不作为正式项目事实来源：

- `ack-*`
- `advise-*`
- `explain-*`
- `write-*`
- `list-*`
- `summarize-*`
- `wait-*`
- `choose-*`
- `confirm-*`

处理规则：

- 不提交原始目录。
- 不迁入 `docs/progress/`。
- 若其中包含有效结论，只把结论写入对应正式文档；聊天式问答、确认语、命令提示本身不入库。

## 敏感与脱敏规则

本轮凭证形态扫描未发现明文 AK、私钥或可直接使用的密钥值。但以下内容仍不得原文入库：

- 预生产主机、端口映射、可直接访问的 URL。
- 本机绝对路径、临时日志路径、file URL。
- 第三方服务配置上下文中的密钥字段名和值。
- 含截图、patch、工具日志的 archive 过程材料。

脱敏写法：

| 原始类型 | 正式文档写法 |
| --- | --- |
| 预生产主机 | `<PREPROD_HOST>` |
| 预生产服务 URL | `<PREPROD_URL>` |
| 本机绝对路径 | `<LOCAL_PATH>` |
| 工具日志路径 | `<TOOL_LOG_PATH>` |
| 第三方密钥字段和值 | `<SECRET_NAME>` / `<SECRET_VALUE>` |

## 后续任务拆分

| 后续任务 | 输入 | 边界 |
| --- | --- | --- |
| T5 外部材料索引 | `docs/business/`、`deliverables/`、`opc-doc/`、历史截图 | 建摘要索引，大文件和二进制先确认外部归档 |
| 我的页商用闭环 | `profile-commercial-closure-plan`、闭环矩阵 | 独立业务分支，明确旧入口、新目录、API、验证和删除条件 |
| 业务闭环审计文档化 | `productization-closed-loop-audit` | 先脱敏，再转正式矩阵文档 |
| 代码瘦身后续轮次 | `code-slimming-controlled-round2` | 用户确认候选后单独任务执行，不能在规范化任务中顺手删 |
| 预生产部署事实收口 | `deploy-baidu-preprod`、生产门禁任务 | 只记录验证结论和脱敏拓扑，不沉淀主机细节或密钥 |

## 双模型分析结论

Claude 结论为 `CHANGES_REQUESTED` 后已处理：

- 不把“服务名关键词命中”误判为明文密钥。
- 真正需要防止入库的是预生产拓扑、本机路径、工具日志路径和 archive 视觉证据。
- `in_progress` 任务必须标注为快照，不可当作终态。

Antigravity 结论为 `APPROVE_PLAN`：

- 同意用集中 triage 文档替代原始 `.ccg/tasks` 入库。
- 同意低价值会话动作记录不入库。
- 建议截图、patch 和预生产部署信息只登记或脱敏摘要。

## 验证口径

提交前必须验证：

- 暂存文件只包含 T4 报告、T4 任务记录和进度文档。
- `apps/`、`services/`、`packages/` 无差异。
- `.ccg/tasks` 原始任务包没有被整包暂存。
- T4 报告不含预生产主机、主工作区本机绝对路径、工具临时日志路径或 file URL。
- 暂存差异不包含图片、patch、PDF、PPT、DOCX、ZIP 等二进制或交付物。

## 结论

T4 的可提交结果是“任务证据筛选清单”，不是“任务证据迁移”。主工作区 `.ccg/tasks/` 仍保持本地原状；是否删除、归档或 ignore 低价值任务目录，需要在用户确认后另起独立清理任务。
