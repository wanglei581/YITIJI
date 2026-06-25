# 当前开发进度

> 最后更新：2026-06-25
> 入口用途：只记录当前阶段、已验证结论、待确认边界和下一步任务入口。历史长记录文本已归档到 `docs/progress/archive/2026-06-20-current-progress-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。
> 关联文档：[CLAUDE.md](../../CLAUDE.md) | [feature-scope.md](../product/feature-scope.md) | [project-structure.md](../project-structure.md) | [normalization-truth-audit](../reviews/project-normalization-truth-audit.md)

## 当前阶段

项目进入“上线前收口 + 项目规范化治理 + 渐进式重构准备”阶段。当前不做全量重写，也不在旧结构里继续堆功能；采用现有仓库、干净 worktree、按业务闭环渐进迁移的方式推进。

当前有效原则：

- 一窗口 = 一任务 = 一分支。
- 禁止 `git add .`，所有暂存必须显式列路径。
- `apps/`、`services/`、`packages/` 属运行时代码，规范化任务默认不触碰。
- 删除、ignore、大文件外部归档、主工作区物料迁入前必须先确认并双模型审查。
- 岗位 / 招聘会 / 政策继续只做第三方或官方来源信息入口；项目不是招聘平台。

## 规范化治理已完成

| 日期 | 分支 / 提交 | 结论 |
| --- | --- | --- |
| 2026-06-20 | `codex/project-normalization-p0` / `de212131` | 建立目录治理基线：`docs/project-structure.md`、`.ccg/spec/guides/index.md`、AGENTS/CLAUDE 入口同步。 |
| 2026-06-20 | `codex/project-normalization-p0` / `940e7485` | 输出主工作区分类规则，确认不新建仓库、不整包迁移、不直接清理主工作区。 |
| 2026-06-20 | `codex/project-normalization-p0` / `f54eacd3` | 固化 Codex + Claude + Antigravity 协作模式：Claude 做只读草案，Codex 落盘验证，双模型复审中高风险。 |
| 2026-06-20 | `codex/normalization-truth-audit` / `59d930ad` | 完成 T0 真值对齐，确认 P0 tracked、主工作区 tracked 修改、主工作区 untracked 物料三层并存。 |
| 2026-06-20 | `codex/normalization-progress-rollup` / `b48506a9` | 完成 T1 进度文档收口，短入口替代长流水，历史文本进入 `docs/progress/archive/`。 |
| 2026-06-21 | `codex/normalization-ignore-proposal` / `1549c33c` | 完成 T2 E 类本地工具 ignore 提案，明确先抽取 P0/P1 内容再写 ignore，禁止裸 `.ccg/`。 |
| 2026-06-21 | `codex/normalization-local-tools-landing` / `94cbda92` | 完成 T3 E 类本地工具落地：抽取产品 PRD 和设计摘要，写入根路径锚定 ignore 规则，不删除本地文件。 |
| 2026-06-21 | `codex/normalization-evidence-triage` / `a0a75b08` | 完成 T4 C 类任务证据筛选：只登记高价值摘要、脱敏规则和后续任务，不整包提交 `.ccg/tasks/`。 |
| 2026-06-21 | `codex/normalization-external-materials-index` / `051af3b6` | 完成 T5 D 类外部材料索引：只登记外部材料清单和处置规则，不提交 PDF、OPC 原始输出或交付物。 |
| 2026-06-21 | `codex/profile-commercial-closure-plan` / 计划分支 | 完成首批业务闭环的目标修正和准入设计：我的页商用闭环先拆 `ProfilePage`，再补 `/me/ai-records`，最后接打印订单反馈。 |
| 2026-06-21 | `codex/profile-page-split` / 本分支 | 完成我的页商用闭环 Branch 1：`ProfilePage.tsx` 从 595 行拆到 177 行，入口、路由、文案和行为保持不变。 |
| 2026-06-21 | `codex/profile-me-ai-records-page` / 本分支 | 完成我的页商用闭环 Branch 2：新增 `/me/ai-records` 元数据页，Profile「AI服务记录」入口已从 `/assistant` 修正为 `/me/ai-records`。 |
| 2026-06-21 | `codex/profile-print-feedback-link` / 本分支 | 完成我的页商用闭环 Branch 3：打印订单可跳转关联反馈，提交携带 `relatedPrintTaskId`，并补齐打印订单分页 verify 正路径。 |
| 2026-06-21 | `codex/ai-resume-assets-closure-plan` / 本分支 | 完成下一组业务闭环计划：确认 `/me/resumes` 页面缺失是 AI 简历资产闭环首个真实缺口，先计划和文档修正，不直接改运行时代码。 |
| 2026-06-21 | `codex/me-resumes-page` / 本分支 | 完成 AI 简历资产闭环 Branch 1：新增 `/me/resumes` 本人简历元数据页，Profile「我的简历」入口已从上传页改为本人简历页。 |
| 2026-06-21 | `codex/me-resumes-actions-hardening` / 本分支 | 完成 AI 简历资产闭环 Branch 2：`/me/resumes` 四类动作支持 `taskId + member token` 恢复，岗位匹配回看复用 `getLatestJobFit`，并避免会员任务串用匿名 accessToken。 |
| 2026-06-21 | `codex/my-documents-delete-action` / 本分支 | 完成 AI 简历资产闭环 Branch 3：`/me/documents` 增加本人文档两步确认删除，复用既有 `deleteMyDocument`，并以全局 pending 锁避免查看/删除并发竞态。 |
| 2026-06-21 | `codex/normalization-business-closures-integration` / 本分支 | 完成规范化治理与首批业务闭合集成收口：从干净 `main` 快进集成 18 个已验证提交，完成敏感信息扫描、Kiosk/API 总验证、Claude + Antigravity 双模型最终审查，结论为无 Critical、可交付。 |
| 2026-06-21 | `codex/jobfair-campus-closure-admission` / 本分支 | 完成招聘会 / 校园招聘闭环准入审查：确认 `CampusPage` 已接 `terminalId`、`JobFairsPage` 未接本校优先、`FairCompanyDetailPage` 缺真实二维码和外部跳转记录；后续拆为列表接线、`fair_company` activity target、大页面拆分 3 个独立分支。 |
| 2026-06-21 | `codex/jobfairs-list-terminal-priority` / 本分支 | 完成招聘会 / 校园招聘 Branch 1：`JobFairsPage` 读取 `getTerminalId()` 并透传 `getJobFairs(terminalId ? { terminalId } : undefined)`，列表主入口对齐 `/campus` 的本校优先排序；新增静态防回退验证，Kiosk typecheck/lint 和 API `verify:jobfair-campus-priority` 已通过。 |
| 2026-06-21 | `codex/fair-company-external-activity` / 本分支 | 完成招聘会 / 校园招聘 Branch 2：新增 `fair_company` activity target 且只允许 `external_apply`；服务端仅记录已审核已发布招聘会下的参展企业；`FairCompanyDetailPage` 改为真实来源二维码并记录本人外部入口打开；`/me/activity` 可识别并回跳参展企业详情。 |
| 2026-06-21 | `codex/jobfair-pages-size-split` / 本分支 | 完成招聘会 / 校园招聘 Branch 3：`CampusPage`、`JobFairDetailPage`、`FairCompanyDetailPage` 零行为拆分，主入口文件分别降到 343 / 298 / 197 行；新增并接入 `verify:jobfair-size`，`verify:jobfair-ui` 会先跑尺寸守卫。 |
| 2026-06-21 | `codex/file-retention-policy-service` / 本分支 | 完成用户文件保存期限 Branch 2：`FileObject.expiresAt` 支持长期保存 null 语义；会员本人可设置 3 个月 / 6 个月 / 成果物长期保存；原始文件首批不开放长期，证件和匿名/系统文件保持短期保存；Admin/Kiosk/MemberAssets 已兼容长期保存展示。 |
| 2026-06-21 | `codex/file-retention-kiosk-ui` / 本分支 | 完成用户文件保存期限 Branch 3：Kiosk `/me/documents` 展示当前保存期限和后端允许策略；本人可设置 3 个月 / 6 个月 / 成果物长期保存，6 个月 / 长期保存自动提交 `FILE_RETENTION_CONSENT_VERSION`；保存条款版本收敛到 shared 与 API 本地副本常量，并由防回退脚本比对。 |
| 2026-06-22 | `codex/admin-file-lifecycle-view` / 本分支 | 完成用户文件保存期限 Branch 4：Admin `/files` 复用现有入口展示文件生命周期运营视图；新增 `GET /files/lifecycle-summary` 全库只读统计；展示保存策略、设置来源、同意时间、长期保存、即将到期/待清理；管理员无保存期限修改入口；兼容 COS 绝对签名 URL；页面拆分为容器、表格、统计卡片和元数据映射。 |
| 2026-06-22 | `codex/cos-lifecycle-privacy-acceptance` / 本分支 | 完成用户文件保存期限 Branch 5：补齐 COS 生命周期与隐私文案验收；采集点、帮助中心、隐私政策、Admin 文件横幅统一为短期 / 90 天 / 180 天 / 长期保存口径；新增 `docs/compliance/file-retention-and-cos-lifecycle.md`，明确禁止配置 Bucket 全局过期规则和 `long_term` 防误删人工验收；新增 `verify:legal-retention-copy` 与 `verify:cos-lifecycle-policy` 防回退。 |
| 2026-06-22 | `codex/file-assets-trial-acceptance` / 本分支 | 完成用户文件与简历资产生产/试运营验收证据包：新增 `docs/acceptance/user-file-assets-trial-acceptance.md` 和 `verify:file-assets-trial-acceptance` 静态门禁，明确 PostgreSQL + COS + 会员账号真实验收、删除三态一致、过期清理、`long_term` 防误删和证据脱敏要求；本分支仅代表证据包就绪，非生产/试运营验收完成。 |
| 2026-06-21 | `codex/preprod-deployment-acceptance` / `6b055d6b` | 本轮上线验收线程确认合入 Kiosk `/assistant` TRTC 数字人生产构建防回退守卫，并部署到百度云预生产 `/srv/ai-job-print`；公网 HTTP health 三端返回 `db=postgres`，PM2 `ai-job-print-api` 在线，Kiosk dist 含 `AiAdvisorCall` / `trtc` chunk，服务器端 `verify:assistant-trtc-guard` 通过；真实 COS live put/head/get/签名 URL/delete 通过后已切 `FILE_STORAGE_DRIVER=cos`；新增 30 天自签临时 HTTPS，`kiosk.preprod.local` / `admin.preprod.local` / `partner.preprod.local` 通过 hosts 映射可返回 HTTP/2 200 与 `db=postgres` health；预生产服务器上 `verify:member-assets-c2d` 9 项与 `verify:activity-logs` 13 项通过。该结果仍仅代表预生产代码包、PostgreSQL health、COS、临时 HTTPS 和部分核心 verify 通过，不等于正式域名/HTTPS、腾讯短信、百度 OCR、AI/TRTC/ASR/TTS live、Windows 真机或小范围试运营完成。 |
| 2026-06-21 | `codex/guard-kiosk-trtc-assistant` / 本分支 | 补 AI 助手数字人生产构建防回退：Kiosk production build 默认要求 `VITE_USE_TRTC_CALL=true`，避免 `/assistant` 未启用数字人通话入口后线上静默回落文字助手；如明确纯文字部署，必须显式设置 `VITE_ALLOW_TEXT_ONLY_ASSISTANT=true`。 |
| 2026-06-22 | `codex/file-assets-preprod-integration` / 本分支 | 完成用户文件资产商用闭环栈与预生产验收候选集成：在 `codex/file-assets-trial-acceptance` 基线上合入 `codex/preprod-deployment-acceptance`，形成同时包含文件资产保存期限/证据包、Admin 生命周期视图、COS 生命周期口径、TRTC assistant 生产构建守卫和预生产阶段性记录的统一候选；本分支仅代表代码与文档候选已集成并通过本地静态/类型验证，不等于正式生产部署、真实文件资产试运营验收或 Windows 真机验收完成。 |
| 2026-06-22 | `codex/file-assets-preprod-execution` / 本分支 | 完成用户文件与简历资产预生产真实验收执行计划和 Gate 0 本地静态门禁：新增预生产执行记录模板，明确 Gate 1 只读预检、Gate 2 候选部署、Gate 3 自动命令、Gate 4 浏览器账号验收的许可边界、证据要求、停止条件和回滚方式；Claude + Antigravity 双模型审查无 Critical，Gate 0 `verify:file-assets-trial-acceptance` 与 `git diff --check` 通过。该结果仅代表执行计划和本地静态门禁通过，不等于预生产已执行、正式生产上线、试运营完成或 Windows 真机验收完成。 |
| 2026-06-22 | `codex/file-assets-preprod-gate1-readonly` / 本分支 | 完成用户文件与简历资产预生产 Gate 1 只读预检：`<PREPROD_HOST>` 主机可登录，PM2 `ai-job-print-api` online，本机与公网 health 均返回 `db=postgres`；但 `/srv/ai-job-print` 是 `local-git-archive` 展开目录而非 Git 仓库，`DEPLOY_SOURCE.txt` 自报当前部署源 commit 为 `6b055d6b`，不是当时目标候选 `9146fa1c`，且实际运行代码一致性需 Gate 2 重新部署时核验。按计划停止在 Gate 1，未执行部署、重启、迁移、COS live、账号或文件操作；后续 Gate 2 目标候选已刷新为 `2187f6a7`。 |
| 2026-06-22 | `codex/file-assets-preprod-gate2-plan` / 本分支 | 完成用户文件与简历资产预生产 Gate 2 候选部署刷新方案：根据 Gate 1 发现的 `local-git-archive` 服务器形态，将早期 Git checkout 流程修正为本地 `git archive` 生成候选包、上传 `/srv`、展开候选目录、保留运行时和前端构建时 env 文件、生成 Prisma client、构建 API/Kiosk/Admin、备份 PostgreSQL、执行候选所需 additive migrations、原子重命名当前目录为回滚目录、提升候选目录、重启既有 PM2 并复验 health/API dist hash 的执行方案；本分支仅记录方案与待确认边界，未上传归档包、未替换目录、未重启 PM2、未迁移数据库、未写业务数据或 COS；后续目标候选已刷新为 `2187f6a7`。 |
| 2026-06-22 | `codex/file-assets-gate3-gate4-evidence-plan` / 本分支 | 补齐用户文件与简历资产 Gate 3/Gate 4 证据执行模板：新增自动命令日志编号 G3-01 至 G3-08、浏览器/账号验收证据 G4-01 至 G4-10、统一脱敏规则、PostgreSQL 查询摘要模板和停止条件；该分支仅准备执行证据结构，未执行 COS live、账号登录、DB 查询、浏览器验收或任何远程写操作。 |
| 2026-06-22 | `codex/file-assets-commercial-closure-audit` / 本分支 | 完成用户文件与简历资产商用闭环完成度审计矩阵：逐项区分数据模型、账号资产 API、Kiosk 文件管理、Admin 生命周期、COS/隐私合规、Gate 2/3/4、正式生产和 Windows 真机的“代码/文档候选已具备”与“待预生产/待真实验收”状态；本分支仅做本地审计文档，不执行预生产部署、COS live、DB 查询、账号验收或任何远程写操作。 |
| 2026-06-22 | `codex/file-assets-gate2-approval-package` / 本分支 | 补齐用户文件与简历资产预生产 Gate 2 执行审批包：把候选刷新前必须确认的目标、非目标、远端允许修改内容、禁止事项、前置确认、验证证据、停止条件、回滚方式和用户确认口径集中到短入口；本分支仅做本地审批文档，不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-local-artifact-check` / 本分支 | 完成用户文件与简历资产 Gate 2 本地候选包预检：确认完整归档会带入 `docs/`、`.ccg/` 和历史非运行时资料，已将 Gate 2 计划修正为裁剪运行时归档，只包含 workspace 构建所需路径并排除示例 env、文档、任务记录和本地工具状态；本分支仅生成本地 `/tmp` 预检产物，不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-runtime-build-check` / 本分支 | 完成用户文件与简历资产 Gate 2 裁剪包本地构建预检：在 `/tmp` 解压裁剪候选包并完成 `pnpm install --frozen-lockfile`、Prisma client 生成、API build、Kiosk production build、Admin production build；预检发现并修正 Gate 2 计划中的前端生产构建变量缺口，Kiosk/Admin build 必须显式 `VITE_API_MODE=http` 与 `VITE_API_BASE_URL=/api/v1`，Kiosk 还必须 `VITE_USE_TRTC_CALL=true`；本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate3-activity-log-evidence` / 本分支 | 补齐用户文件与简历资产 Gate 3 AuditLog 命令证据链：将 `verify:audit-logs` 纳入 G3-09，静态门禁同步检查 Gate 3/Gate 4 模板包含 AuditLog 命令证据，并检查文件保存期限变更、删除和过期清理审计写入点；本分支不连接预生产、不写 DB/COS/账号、不执行 Gate 3/Gate 4。 |
| 2026-06-22 | `codex/file-assets-gate3-command-guard` / 本分支 | 补齐用户文件与简历资产 Gate 3 命令清单防回退：`verify:file-assets-trial-acceptance` 会从 Gate 3/Gate 4 runbook 提取远端 `verify:*` 命令，检查顺序与预期一致，并确认每条命令存在于 `services/api/package.json`；本分支不连接预生产、不写 DB/COS/账号、不执行 Gate 3/Gate 4。 |
| 2026-06-22 | `codex/file-assets-gate2-candidate-refresh` / 本分支 | 完成用户文件与简历资产 Gate 2 候选刷新本地预检：后续 Gate 2 建议目标候选从 `9146fa1c` 刷新为包含后续门禁修正的 `9a702981`；在 `/tmp` 重新生成裁剪运行时归档并完成 install、Prisma 双 client、API/Kiosk/Admin build，API dist hash 与旧候选一致；本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-candidate-guard` / 本分支 | 补齐用户文件与简历资产 Gate 2 候选一致性防回退：`verify:file-assets-trial-acceptance` 会检查操作型 Gate 2 refresh plan、审批包、执行记录、Gate 3/Gate 4 runbook、构建预检和进度入口均指向 `9a702981`，并禁止旧候选 `9146fa1c` 的操作型归档/目录/DEPLOY_SOURCE marker 回流；旧 execution plan 和旧本地归档预检命令均已标记为历史记录、已废弃、勿执行；本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-approval-guard` / 本分支 | 补齐用户文件与简历资产 Gate 2 审批确认口径防回退：`verify:file-assets-trial-acceptance` 会检查审批包保留 `APPROVAL REQUIRED，尚未执行` 状态、机读确认块、用户明确确认前不得执行远端操作、同意范围、不同意范围、Gate 3/Gate 4 另行确认和 Gate 2 不等于试运营或商用闭环完成；本分支只做本地门禁和文档收口，不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate3-doc-verify-scope` / 本分支 | 修正用户文件与简历资产 Gate 3 文档静态门禁执行范围：`verify:file-assets-trial-acceptance` 依赖完整仓库 `docs/`，已明确为 Gate 0 本地/仓库侧静态门禁，不再列入预生产裁剪运行时包内的 Gate 3 远端命令清单；本分支不把 `docs/` 或 `.ccg/` 加回运行时归档，不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-integration-static-gate-scope` / 本分支 | 修正用户文件资产历史集成计划的静态门禁口径：`verify:file-assets-trial-acceptance` 在集成计划中拆出为 Gate 0 本地静态文档门禁，API runtime gates 不再与该 docs-only 命令并列；本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-latest-candidate-guard` / 本分支 | 将用户文件与简历资产 Gate 2 后续建议目标候选从上一代 `9a702981` 刷新为当前本地门禁链 `2187f6a7`，并重新生成裁剪运行时归档完成 install、Prisma 双 client、API/Kiosk/Admin build；API dist hash 与旧候选一致；本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-candidate-freeze-policy` / 本分支 | 补齐用户文件与简历资产 Gate 2 部署候选冻结口径：当前远端执行候选保持为 `2187f6a7`，后续纯治理、文档、本地静态门禁或任务归档提交不自动刷新候选，治理提交不刷新部署候选；只有运行时代码、数据库 schema、构建输入、归档范围、生产构建变量或 Gate 2 执行命令变化才重新确认候选。本分支不连接预生产、不上传候选包、不迁移数据库、不重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-readiness-recheck` / 本分支 | 完成用户文件与简历资产 Gate 2 执行前只读就绪复核：本地冻结候选 `2187f6a7` 仍可执行，`/tmp` 候选包 sha256 与记录一致；预生产仍自报部署源 `6b055d6b`，PM2 online，本机和公网 health 均为 `db=postgres`，磁盘预算、API env、`node` / `pnpm` / `pg_dump` / `pm2`、PostgreSQL/Redis/Tencent COS 脱敏指纹满足执行前只读检查；本分支仅修正 Gate 2 指纹脚本的 Tencent COS key 名并记录报告，未上传候选包、未写 `/srv`、未迁移数据库、未重启 PM2。 |
| 2026-06-22 | `codex/file-assets-gate2-execution` / 本分支 | PREPRODUCTION GATE 2 PASSED：经用户明确确认和 Claude + Antigravity 执行前审查，已将预生产 `/srv/ai-job-print` 从自报 `6b055d6b` 刷新到冻结候选 `2187f6a7`；候选包 sha256 校验通过，API/Kiosk/Admin production build 通过，Kiosk 产物包含 `AiAdvisorCall` / `trtc` chunk；迁移前 DB 备份存在且 `pg_restore -l` 可读；仅应用两个预期 additive migrations；PM2 online，本机和公网 health 均为 `db=postgres`，API dist hash 匹配。Gate 3/Gate 4 尚未执行；该结果仍不等于正式生产、Windows 真机或试运营完成。 |
| 2026-06-22 | `codex/file-assets-gate3-gate4-execution` / 本分支 | PREPRODUCTION GATE 3 PARTIAL PASS / BLOCKED：在 Gate 2 基线 `2187f6a7` 上执行 Gate 3 安全子集，预生产运行时包通过 `verify:production-runtime-gates`、`verify:production-db-guard`、`verify:file-retention`、`verify:file-lifecycle-summary`、`verify:member-assets-c2d`、`verify:audit-logs`；本地完整仓库通过 `verify:cos-lifecycle-policy`。G3-06 `verify:cos:live` 未执行，因为当前 COS bucket 脱敏复核为 fp=7637995480、`prod_label=true`、`strict_nonprod=false`，且与历史生产私有桶记录一致；Gate 4 文件上传、保存期限、删除三态、过期清理和 Admin 生命周期浏览器验收因此暂停。执行后 health 仍为 `db=postgres`、PM2 online；该结果不等于 Gate 3 完整通过、Gate 4 完成、正式生产、Windows 真机或试运营完成。 |
| 2026-06-22 | `codex/file-assets-preprod-cos-switch-plan` / 本分支 | PREPRODUCTION COS SWITCH PASSED：用户确认后已在腾讯云创建隔离预生产 COS bucket 和预生产专用 CAM 子用户，随后仅切换预生产服务器 `/srv/ai-job-print/services/api/.env` 的 COS 相关键，备份为 `/srv/ai-job-print-env-backups/api.env.20260622134416.bak`；新 bucket 脱敏指纹 `d855f7e900`、`strict_nonprod=true`、`prod_label=false`、region `ap-guangzhou`；PM2 `ai-job-print-api` 使用新 env 重启后 online，本机和公网 health 均为 `success=true`、`db=postgres`；G3-06 `verify:cos:live` 已通过 put/head/get/预签名下载/delete，删除后对象不存在。该结果仍不等于 Gate 4、正式生产、Windows 真机或试运营完成。 |
| 2026-06-22 | `codex/file-assets-gate4-runbook-preflight` / 本分支 | 校准用户文件与简历资产 Gate 3/Gate 4 证据执行模板：将 runbook 当前状态从“COS live 与 Gate 4 仍阻塞”修正为“Gate 3 自动命令门禁已通过（含 G3-06 COS live），Gate 4 浏览器账号验收待执行”；保留旧生产语义 bucket 的阻断规则，并新增当前预生产 bucket 脱敏指纹 `d855f7e900`、`strict_nonprod=true`、`prod_label=false`、region `ap-guangzhou`。本分支仅做 Gate 4 前置文档校准，不执行账号登录、文件上传、DB/COS 写入、过期清理或 Admin 浏览器验收。 |
| 2026-06-22 | `codex/file-assets-gate4-runbook-preflight` / 本分支 | PREPRODUCTION GATE 4 API-LEVEL ACCEPTANCE PASSED WITH NOTES：用户确认 B 方案后，临时将预生产 `SMS_PROVIDER=log`，使用受控 MEMBER_A / MEMBER_B / 临时 Admin 通过真实 HTTP API + PostgreSQL + Redis + COS 完成会员登录、原始文件上传、默认 90 天、设置 180 天、原始文件长期保存拒绝、签名 URL 内部访问、跨账号 403、删除三态、过期清理和 Admin 生命周期汇总；执行后已回滚 `SMS_PROVIDER=tencent`，公网 health 复核 `db=postgres`，SSH 只读复核确认 `SMS_PROVIDER=tencent`、`FILE_STORAGE_DRIVER=cos`、`DATABASE_URL=postgres`、`REDIS_URL=set`。注意：完整浏览器截图仍待补；当时优化成果长期保存使用受控 DB 夹具标记 `assetCategory=optimized`，真实 AI 导出产物自动分类链路已由后续 `codex/file-assets-gate4-browser-ai-output` 刷新到预生产并补证。 |
| 2026-06-22 | `codex/file-assets-gate4-browser-ai-output` / 本分支 | PREPRODUCTION AI OUTPUT RECHECK PASSED WITH NOTES：用户确认后已将预生产从 `2187f6a7` 刷新到 AI 导出产物候选 `76c06ca8`；候选包 sha256 校验、API/Kiosk/Admin build、PostgreSQL 备份、无 pending migration、PM2 重启和 health 均通过。预生产缺少中文字体导致 `verify:resume-generate` 初次失败，已安装 `fonts-wqy-microhei` 并配置 `RESUME_PDF_FONT_PATH` / `RESUME_PDF_FONT_FAMILY=WenQuanYiMicroHei` 后复跑通过。自动 Gate 通过 `verify:production-runtime-gates`、`verify:production-db-guard`、`verify:resume-generate`、`verify:file-retention`；真实 COS 补证显示 AI 导出文件 digest `34f964913eec` 为 `optimized`，`sourceMatches=true`，COS HEAD 200，短 TTL 签名 URL 200→403，会员 B 拒绝访问，审计写入存在。完整浏览器截图、正式生产、Windows 真机和试运营仍未完成。 |
| 2026-06-24 | `docs/real-resume-diagnosis-phase1-refresh` / 本分支 | 从旧远程分支 `origin/docs/real-resume-diagnosis-phase1` 提取仍有价值的真实 AI 简历诊断 Phase 1 设计目标，并按当前 `main` 已落地实现重写为 `docs/product/real-resume-diagnosis-phase1.md`；不迁回旧 job fair / smart campus 运行时代码，不回写旧进度条目。 |
| 2026-06-25 | `codex/standardization-execution-guidance` / 本分支 | 固化后续规范化治理启动口径：默认从干净 `main` 新建独立分支推进，旧分支只允许选择性提取已复核价值，不直接复活落后旧分叉；旧 worktree / 旧分支清理前必须只读盘点并保护仍有价值的候选功能分支。 |
| 2026-06-25 | `codex/standardization-cleanup-state` / 本分支 | 同步分支 / worktree 治理收口后的当前事实：主线保持干净，已清理可证实冗余的远程历史分支；保留 QR 登录、面试重设计、订单模型、Sprint1 顶层旧栈和专家审查小候选，后续只能从干净 `main` 新分支选择性迁移。 |
| 2026-06-25 | `docs/progress-remaining-candidates-sync` / 本分支 | 同步 #89 合入后的主线事实与剩余候选边界：`main == origin/main == f1d6f8e7`，旧 UI 候选 `fix/expert-audit-stage-a` 已删除；剩余 QR 登录 dirty worktree、面试重设计本地候选 / 备份、Sprint1 订单 / Partner dashboard 远程候选已定级到 `docs/reviews/remaining-branch-candidates-2026-06-25.md`。 |
| 2026-06-25 | `codex/admin-orders-readonly` / 本分支 | 从旧 `origin/feature/sprint1-partner-dashboard` 只提取 Admin 订单只读价值：新增后端 `GET /admin/orders` 与 `GET /admin/orders/:id`，Admin `/orders` 改为订单只读列表 / 详情，只展示订单、支付状态、打印任务和安全元数据；明确不迁旧候选中的标记支付、退款、改状态写操作，不触碰 Kiosk / Partner / Terminal Agent / 支付状态机。 |
| 2026-06-25 | `codex/qr-login-local-agent-bridge` / 本分支 | 从干净 `main` 补齐 QR 扫码登录候选：保留现有 terminal-bound 后端 QR 安全模型，新增 Terminal Agent 127.0.0.1 本地 create/claim 代理，`claimToken` 仅留在 Agent 内存；Kiosk 扫码页改为手机确认登录，手机页只执行 status/confirm、不接收 member token；旧微信/支付宝占位扫码 UI 已移除。 |
| 2026-06-25 | `docs/qr-login-cleanup-progress` / 本分支 | 同步 QR 登录收口后的当前事实：#91 已 rebase merge 到 `main`，运行时代码基线为 `535587e0`；旧 `codex/qr-ticket-login` dirty worktree / 分支已按证据清理，本次过渡分支 `codex/qr-login-local-agent-bridge` 本地 / 远程 head 也已清理。 |
| 2026-06-25 | `codex/order-model-foundation` / 本分支 | 从远程候选 `origin/feature/sprint1-order-model` 选择性迁入订单底座：新增 `Order` 数据模型与 SQLite/PostgreSQL additive migration，`PrintJobsService.create` 在保持原 `{ taskId, status, createdAt }` API 合约不变的同时创建 `type=print`、`payStatus=unpaid`、`amountCents=0` 的运营订单，Terminal claim/status/reset 会镜像 `taskStatus` / `terminalId`；新增 `verify:order` 并接入 CI。当前不接真实支付、报价、退款、PaymentAttempt 或 Partner dashboard，源远程候选待本分支 PR/CI/合并后再决定清理。 |

## 当前工作区事实

主工作区：`/Users/wanglei/AI求职打印服务终端`。QR 登录运行时代码已在 `main` / `origin/main` 的 `535587e0` 合入；本次文档收口仅同步清理事实，不改变运行时代码。后续治理、迁移和清理默认继续从干净 `main` 或独立 worktree 启动，不再以旧 `feature/interview-setup-redesign` 等落后分叉作为治理基线。

当前仍保留的特殊 worktree / 分支边界：

- `codex/qr-ticket-login`：已清理。旧 dirty worktree 中的暂存 QR 登录草案会把 `claimToken` 放在浏览器侧、Kiosk 直接打后端 QR 接口，且不具备 #91 的 Terminal Agent 本地代理边界；#91 已用更安全实现合入 `main`，旧 worktree / 本地分支已移除，无同名远程 head。
- `feature/interview-setup-redesign` / `backup/interview-b65d6e48`：本地候选分支仍保留；前者涉及面试页重设计产品取舍，后者涉及 fair verify residue 候选验证。未确认迁移或明确放弃前不得删除。
- 真实远程候选 head 仅保留 `feature/sprint1-order-model`、`feature/sprint1-partner-dashboard` 和 `main`：分别对应订单 / 支付域基础候选、Sprint1 顶层旧栈候选和主线。旧远程中间分支与旧 UI 候选 `fix/expert-audit-stage-a` 已清理；后续迁移必须从干净 `main` 单独提取最小价值。
- 剩余候选定级已记录到 `docs/reviews/remaining-branch-candidates-2026-06-25.md`；未授权前不得用 `git remote prune` / `git gc` 做额外清理。

## 主工作区高价值新增结论（待后续按证据迁入）

T0 已确认主工作区进度文档中新增了若干高价值结论，但这些内容仍属于待收口输入，不代表已经进入当前治理分支的运行时代码：

- 机构类型矩阵后端硬约束：记录为已在独立 worktree 完成，涉及 `Organization.type -> sceneTemplate -> enabledModules`，需按对应分支/PR/验证证据复核后再归入正式完成项。
- Claude CLI 修复与代码瘦身首批清理：记录了 Claude auth 修复、旧入口/旧组件/旧设计预览/本地缓存清理等结论；需区分已入库代码、仅本地清理、仅文档记录。
- Kiosk 生产构建守卫与数字人构建变量：记录 `VITE_USE_TRTC_CALL`、`VITE_TERMINAL_ID`、`build:kiosk:production` 等门禁；正式生产仍需服务器构建与真机验证。
- 百度云预生产核心复验：记录 IP 预生产 HTTP / PostgreSQL / Redis / nginx / PM2 等链路；仍不等于正式生产上线。
- AI 简历上传账号资产须知、工程规模控制规范、代码瘦身最终核验等结论需要在对应任务分支或审查报告中逐条对齐。

## 当前产品与上线边界

已验证和可作为当前产品基础的能力仍以实际代码、CI、verify、浏览器/服务器/真机证据为准。长期边界不变：

- 生产就绪必须是 PostgreSQL + Redis + COS + 真实服务配置 + HTTPS/nginx + 生产运行时门禁。
- Windows 一体机、Terminal Agent、奔图打印/扫描、断网恢复和真实出纸仍需真机验收。
- AI/OCR/SMS/TRTC 等外部服务上线前需要生产密钥、权限、轮换和 live 冒烟。
- 本地 SQLite/browser 成功不能替代硬件或生产验收。
- 2026-06-22 预生产服务器当前仍是阶段性验收状态：代码包已升级到 AI 导出产物复验候选 `76c06ca8`，health 指向 PostgreSQL，COS 已切换到隔离预生产 bucket 并通过 G3-06 live 验证，Gate 4 账号/API 级验收已通过并回滚短信 Provider；真实 AI 导出产物 `optimized/sourceFileId` 链路已在预生产通过自动 Gate 与 COS/DB 脱敏补证。仍需补 Gate 4 浏览器截图、百度 OCR Key 与 live 验证、AI/TRTC/ASR/TTS 按启用范围 live 验证、正式域名 HTTPS，以及腾讯短信审核后的真实手机号 E2E。

## 近期优先级

1. 用户文件与简历资产商用闭环：文件资产留存模型、保存期限服务、Kiosk 用户自助设置 UI、Admin 文件生命周期运营视图、COS 生命周期与隐私文案验收材料、生产/试运营验收证据包、预生产候选集成、Gate 2 执行、Gate 3 自动命令门禁、预生产 COS bucket 切换、G3-06 `verify:cos:live` 和 Gate 4 账号/API 级验收已完成；真实 AI 导出产物自动标记 `assetCategory=optimized` 与 `sourceFileId` 安全绑定已完成预生产复验和 COS/DB 脱敏补证。下一步补 Gate 4 浏览器截图、正式短信通过后的真实手机号 E2E、正式域名 HTTPS 和试运营证据；不能直接宣布生产/试运营完成。
2. 招聘会 / 校园招聘闭环：Branch 1 列表页 `terminalId` 本校优先接线、Branch 2 `fair_company` 外部跳转记录、Branch 3 大页面零行为拆分均已完成；下一步进入上线前真实验收或另起分支处理 T4/T5 派生任务。
3. T5 派生任务：已跟踪旧 PDF 清理、商业计划书转正、对外简介转正、路线图转正、OPC 策略输入归档，均需另起独立分支。
4. T4 派生任务：业务闭环审计文档化、代码瘦身候选确认、预生产部署事实脱敏收口，均需另起独立分支。

## 历史记录

历史流水文本请查阅：

- [2026-06-20 current-progress 归档](./archive/2026-06-20-current-progress-pre-normalization.md)
- [2026-06-20 next-tasks 归档](./archive/2026-06-20-next-tasks-pre-normalization.md)
