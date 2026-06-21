# 下一步任务

> 最后更新：2026-06-22
> 入口用途：当前任务池与执行顺序。历史任务长记录文本已归档到 `docs/progress/archive/2026-06-20-next-tasks-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。

## P0：项目规范化治理

- [x] **P0 治理基线**：保留现有 monorepo，不新建仓库；已新增 `docs/project-structure.md` 与 `.ccg/spec/guides/index.md`。
- [x] **主工作区分类规则**：已输出 `docs/reviews/project-normalization-p0-worktree-inventory.md`，明确 A/B/C/D/E 类处理口径。
- [x] **Codex + Claude 协作模式**：已输出 `docs/reviews/project-normalization-codex-claude-collaboration.md`，确认 Claude 只做草案/清单，Codex 落盘，Antigravity + Claude 双模型复审。
- [x] **T0 真值对齐**：已输出 `docs/reviews/project-normalization-truth-audit.md`，确认三层状态并存，不能整包同步或整包清理。
- [x] **T1 进度文档收口**：已将入口文档短版化，保留历史归档，不迁入运行时代码。
- [x] **T2 E 类本地工具状态 ignore 提案**：已输出提案文档；T3 已按“先抽取再 ignore”落地，不直接清理本地文件。
- [x] **T3 E 类本地工具落地**：已抽取 `.product-pm/prd/print-material-pack.md` 与 `.superpowers` HTML 预览摘要，并写入根路径锚定 ignore 规则；不删除本地文件。
- [x] **T4 C 类任务证据筛选**：已输出任务证据筛选报告；只登记高价值摘要、脱敏规则和后续任务，不提交原始 `.ccg/tasks` 包。
- [x] **T5 D 类外部材料索引**：已输出外部材料索引报告；只登记 Markdown 转正候选、PDF/二进制外部归档规则、OPC 输出处置，不提交原始外部材料。

## P0：上线前真实验收

- [ ] 生产域名与 HTTPS：完成域名解析、证书、nginx 反代、上传限制和自动续期。
- [ ] PostgreSQL 生产实例：`migrate deploy`、seed、核心 verify、备份恢复演练通过。
- [ ] Redis 生产连接：队列/缓存配置、访问权限和内网隔离确认。
- [ ] COS 生产私有桶：CAM 最小权限、上传/下载/删除 live 冒烟。
- [ ] 腾讯短信：签名/模板审核、真实 CAM Key、真号登录 E2E 后才能启用 `SMS_PROVIDER=tencent`。
- [ ] 百度 OCR / AI / TRTC / ASR / TTS：生产 Key、权限、失败兜底和 live 冒烟按启用范围验收。
- [ ] Windows 真机：Terminal Agent、奔图打印机、打印真实出纸、扫描链路、断网/重启恢复逐项记录。
- [ ] 法务合规：用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明审定。
- [ ] 小范围试运营：仅 1 台终端 + 1 台打印机先跑，问题记录按任务闭环处理。

## P1：渐进式重构首批业务闭环

首批业务闭环不按目录搬家，按可验收业务流推进。

- [x] **我的页商用闭环计划与准入**：已输出 `docs/superpowers/plans/2026-06-21-profile-commercial-closure.md` 和 `docs/reviews/profile-commercial-closure-planning.md`；目标从“做出闭环”修正为“收口计划、拆分准入和首批执行任务定义”。
- [x] **我的页商用闭环 Branch 1：ProfilePage 拆分**：纯结构拆分，零行为变更；`ProfilePage.tsx` 已降到 177 行，入口、路由、文案和行为保持不变。
- [x] **我的页商用闭环 Branch 2：AI 服务记录页**：已新增 `/me/ai-records`，复用 `getMyAiRecords` / `deleteMyAiRecord`，修正「AI服务记录」入口，不展示 payload 或简历原文。
- [x] **我的页商用闭环 Branch 3：打印订单关联反馈**：从 `/me/print-orders` 跳转 `/me/feedback?category=print&relatedPrintTaskId=...`，提交时带 `relatedPrintTaskId`，以后端归属校验为安全边界；已补齐 `verify-member-print-orders` 分页正路径。
- [x] **AI 简历上传 / 资产中心计划与准入**：已输出 `docs/superpowers/plans/2026-06-21-ai-resume-assets-closure.md` 和 `docs/reviews/ai-resume-assets-closure-planning.md`；确认首个真实缺口是 `/me/resumes` Kiosk 页面缺失。
- [x] **AI 简历上传 / 资产中心 Branch 1：我的简历页**：新增 `/me/resumes`，复用 `getMyResumes`，Profile「我的简历」入口从上传页改为本人简历元数据页，上传入口保留在「AI简历服务」和空态 CTA。
- [x] **AI 简历上传 / 资产中心 Branch 2：我的简历动作 hardening**：确认报告回看、继续优化、岗位匹配、生成简历预览均通过 `taskId + member token` 恢复；不新增后端，除非现有页面确实缺门禁读取能力。
- [x] **AI 简历上传 / 资产中心 Branch 3：我的文档删除交互**：单独给 `/me/documents` 补本人删除按钮和两步确认，继续复用 `deleteMyDocument` 与 `verify:member-assets-c2d`。
- [x] **规范化治理与首批业务闭合集成收口**：`codex/normalization-business-closures-integration` 已从干净 `main` 快进集成 18 个已验证提交，完成总验证、敏感信息扫描和 Claude + Antigravity 最终审查；无 Critical，可交付。
- [x] **招聘会 / 校园招聘准入审查**：已输出 `docs/reviews/jobfair-campus-closure-admission.md` 和 `docs/superpowers/plans/2026-06-21-jobfair-campus-closure.md`；确认不新增入口、不做报名/签到/候选人闭环，后续拆为 3 个独立分支。
- [x] **招聘会 / 校园招聘 Branch 1：列表页本校优先接线**：`JobFairsPage` 调用 `getTerminalId()` 并透传 `getJobFairs(terminalId ? { terminalId } : undefined)`，对齐 `/campus` 已有本校优先排序；新增 `verify-jobfairs-terminal-priority` 防回退脚本，不改 UI、不改后端。
- [x] **招聘会 / 校园招聘 Branch 2：参展企业外部投递跳转记录**：新增 `fair_company` activity target，限定 `external_apply`；`FairCompanyDetailPage` 使用真实 `SourceUrlQr` 并记录本人外部入口打开；`/me/activity` 支持参展企业记录回跳。
- [x] **招聘会 / 校园招聘 Branch 3：大页面零行为拆分**：已拆分 `CampusPage`、`JobFairDetailPage`、`FairCompanyDetailPage`，保持路由、接口、文案和行为不变；新增 `verify:jobfair-size` 并接入 `verify:jobfair-ui`，已完成 Claude + Antigravity 双模型审查。
- [x] **用户文件保存期限 Branch 2：策略服务与清理门禁**：`FileObject.expiresAt` 支持 `long_term` 的 `null` 语义；会员本人可改本人文件保存期限；原始文件首批仅 3/6 个月，`optimized/derived` 成果物可长期，证件/匿名/系统文件保持短期；补 `verify:file-retention` 与 Admin/Kiosk 可空兼容。
- [x] **用户文件保存期限 Branch 3：Kiosk 文件保存期限 UI**：`/me/documents` 展示当前保存期限和后端允许策略；本人可设置 3 个月 / 6 个月 / 成果物长期保存，6 个月 / 长期保存自动带当前保存条款版本；保存条款版本由 shared/API 本地副本常量收敛并有防回退验证。
- [x] **用户文件保存期限 Branch 4：Admin 文件生命周期运营视图**：Admin `/files` 复用现有入口展示保存策略、设置来源、同意时间、长期保存数量和即将到期/待清理统计；新增全库只读 `GET /files/lifecycle-summary`，不受列表 `limit=200` 截断；管理员无保存期限修改入口，查看文件兼容 COS 绝对签名 URL。
- [x] **用户文件保存期限 Branch 5：COS 生命周期与隐私文案验收**：采集点、帮助中心、隐私政策、Admin 文件横幅统一为短期 / 90 天 / 180 天 / 长期保存口径；新增 COS 生命周期合规文档，明确禁止 Bucket 全局过期规则、`long_term` 防误删人工验收和截图存档；新增 `verify:legal-retention-copy` 与 `verify:cos-lifecycle-policy`。

## P1：用户文件与简历资产商用闭环后续

- [ ] **生产/试运营验收**：使用 PostgreSQL + COS + 会员账号跑上传、设置保存期限、重登查看、删除、过期清理和审计查询全链路。

## P1：工程质量门禁

- [ ] 每个新任务先写目标、非目标、允许修改文件、验证方式。
- [ ] 后续另起分支统一 `docs/product/*` 和历史计划中旧文件 TTL 参考口径；本轮已完成 UI / 隐私政策 / shared copy / 送审材料 / 部署验收文档，产品参考文档历史口径不作为本分支继续扩范围修改。
- [ ] 超过 30 行 diff 或跨模块任务必须 Claude + Antigravity 双模型审查。
- [ ] 500 行以上文件新增功能前评估拆分；800 行以上不得继续堆新功能；1000 行以上进入拆分清单。
- [ ] P3 拆分候选：`apps/kiosk/src/pages/profile/me/MyFeedbackPage.tsx` 当前超过 500 行，后续反馈/通知扩展前先拆分表单、列表和详情面板。
- [ ] 删除旧页面/组件/脚本/文档前，必须确认无路由、import、测试/verify、当前文档、生产部署或硬件链路依赖。
- [ ] 构建产物、缓存、临时截图、录屏、数据库备份、密钥备份、可再生成文件不得进入 Git。

## 待用户确认

- [x] 是否确认后续每个业务闭环都独立分支、独立验证、双模型审查后再推进。
