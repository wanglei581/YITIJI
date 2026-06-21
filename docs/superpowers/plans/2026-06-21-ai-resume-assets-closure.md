# AI 简历资产闭环实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把已经具备后端和 client 的「我的简历」归位到独立业务页面，恢复上传/诊断/生成简历的跨会话资产入口，同时保持高敏简历短留存和 Profile 不聚合的 IA 边界。

**Architecture:** 不新建资产中心聚合页，不复活 `AccountAssetsPanel`。`/profile` 继续只做入口；「我的简历」进入 `/me/resumes` 元数据页，上传入口保留在「AI简历服务」和空态 CTA；报告、优化、岗位匹配和生成预览继续复用既有简历业务页与本人 token 门禁。后端 `/api/v1/me/resumes`、`/me/documents`、`/me/ai-records` 和 `verify:member-assets-c2d` 先复用，不改 schema。

**Tech Stack:** React + Vite + TypeScript + Tailwind CSS + lucide-react；NestJS API + Prisma；现有 `pnpm` workspace、`MeListShell`、`memberAssets.ts` client 和服务级 verify 脚本。

---

## Current-State Audit

已具备：

- `GET /api/v1/me/resumes` 已返回本人 `AiResumeResult(kind=parse|generate)` 元数据，支持游标分页、`optimized` 标记、过期过滤和本人归属。
- `GET /api/v1/me/documents`、`GET /api/v1/me/ai-records`、`DELETE /me/ai-records/:id` 已存在。
- Kiosk client `getMyResumes`、`getMyDocuments`、`getMyAiRecords`、`deleteMyAiRecord`、`deleteMyDocument` 已存在。
- `/me/documents` 和 `/me/ai-records` 页面已存在。
- `ResumeSourcePage` 上传时会调用 `kioskUploadFile(file, 'resume_upload', getToken())`；登录会员上传会由后端 `kiosk-upload` 绑定 `endUserId`。
- `ResumeReportPage` 可用 `taskId + member token` 恢复诊断报告。
- `ResumeGeneratePreviewPage` 可用 `taskId + member token` 恢复生成简历。

真实缺口：

- 没有 `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx`。
- 没有 `/me/resumes` 路由。
- `profileEntries.ts` 中「我的简历」仍指向 `/resume/source`，实际进入上传页，不是本人简历资产列表。
- `docs/product/user-data-flow-matrix.md` 对「我的简历可回看」的描述比当前代码状态更乐观，需要先修正为“后端/API 已具备，Kiosk `/me/resumes` 页面待恢复”。

边界：

- 不支持匿名上传后登录自动认领；只有上传时已登录并带 token 的文件/AI 结果才进入本人资产。
- 不延长 `resume_upload` 高敏文件 TTL；原始简历短留存是隐私设计，不作为缺口处理。
- 不在列表返回 `payloadJson`、简历原文、`storageKey`、`sha256`、签名 URL 或任何企业可用候选人数据。

## Branch 1: `codex/me-resumes-page`

**Objective:** 新增 `/me/resumes` 本人简历列表页，修正 Profile「我的简历」入口。该分支只恢复可达入口和安全元数据展示。

**Allowed Files:**

- Add `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx`
- Modify `apps/kiosk/src/routes/index.tsx`
- Modify `apps/kiosk/src/pages/profile/profileEntries.ts`
- Modify `docs/progress/current-progress.md`
- Modify `docs/progress/next-tasks.md`

**Non-Goals:**

- 不改 `services/api`、Prisma、shared 类型或上传接口。
- 不新增 `AccountAssetsPanel`、账号资产聚合区或资产中心重复入口。
- 不展示 payload / 简历原文 / 诊断正文 / 优化正文。
- 不新增删除入口；删除仍先收口到 `/me/ai-records`，避免简历页和 AI 记录页双删语义冲突。
- 不做匿名结果认领、历史匿名任务绑定、简历投递、发给企业、候选人筛选。

**Tasks:**

- [ ] 新建 `MyResumesPage`，复用 `MeListShell` 和 `getMyResumes(getToken(), { pageSize: 50 })`。
- [ ] 游客态沿用 `MeListShell` 登录引导，`loginFrom="/me/resumes"`。
- [ ] 空态文案必须诚实：未登录前的匿名上传不会自动进入账号；登录后上传/生成的简历才会显示。
- [ ] `parse` 行展示“上传诊断简历”、状态、创建时间、到期时间、`optimized` 标记。
- [ ] `generate` 行展示“AI 生成简历”、状态、创建时间、到期时间。
- [ ] `parse` 行提供两个安全动作：`查看报告` → `/resume/report` with `{ taskId }`；`岗位匹配` → `/resume/job-fit` with `{ taskId }`。
- [ ] `parse` 行优化动作：`optimized ? '查看优化版' : '继续优化'` → `/resume/optimize` with `{ taskId }`。
- [ ] `generate` 行提供 `查看并打印` → `/resume/generate/preview` with `{ taskId }`。
- [ ] 空态 CTA `去上传简历` → `/resume/source`。
- [ ] 注册 `/me/resumes` 路由。
- [ ] 将 `profileEntries.ts` 的「我的简历」路由从 `/resume/source` 改为 `/me/resumes`；保留「AI简历服务」入口继续指向 `/resume/source`。

**Verification:**

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`
- Browser smoke:
  - `/profile` 200，点击「我的简历」进入 `/me/resumes`。
  - `/me/resumes` 游客态显示登录引导。
  - `/me/resumes` 空态显示去上传 CTA。
  - `/me/resumes` 不展示原文、payload、签名 URL。

## Branch 2: `codex/me-resumes-actions-hardening`

**Objective:** 在 Branch 1 页面上做动作回归和状态细化，确认回看、优化、岗位匹配与现有页面的 `taskId` 恢复链路一致。

**Allowed Files:**

- Modify `apps/kiosk/src/pages/profile/me/MyResumesPage.tsx`
- Optional docs updates under `docs/progress/`

**Non-Goals:**

- 不做后端新端点；现有 `ResumeReportPage`、`ResumeGeneratePreviewPage` 已支持 `taskId + token` 恢复。
- 不新增下载原始简历；高敏原始文件过期后不可恢复。
- 不新增简历删除入口。

**Tasks:**

- [ ] 对每个动作按钮补充 disabled / loading / 失败提示，避免过期记录误导。
- [ ] 如果目标页面回看失败，提示“记录可能已到期或已删除”，并提供回到 `/resume/source` 的路径。
- [ ] 确认 `/resume/optimize`、`/resume/job-fit` 对仅带 `taskId` 的 state 行为；若现有页面不能恢复，再单独开后端/前端准入分支，不在本分支硬改。
- [ ] 用浏览器走：`/me/resumes` → 报告 → 优化 → 岗位匹配 → 返回。

**Verification:**

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- Browser smoke for the action routes above.

## Branch 3: `codex/my-documents-delete-action`

**Objective:** 给 `/me/documents` 补本人文档删除交互。该分支与 `/me/resumes` 分开，避免文件物理删除和 AI 记录硬删语义混在一起。

**Allowed Files:**

- Modify `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
- Optional docs updates under `docs/progress/`

**Non-Goals:**

- 不改变 `FilesService.ownerDelete`。
- 不新增批量删除。
- 不删除 AI 记录或简历元数据。

**Tasks:**

- [ ] 复用 `deleteMyDocument(token, fileId)`。
- [ ] 使用两步确认：第一次显示“确认删除”，第二次执行删除。
- [ ] 成功后从本地列表移除。
- [ ] 404 / 过期 / 已清理时提示“文档可能已到期或已删除”，然后刷新列表。
- [ ] 删除按钮触控高度不低于 44px，并与查看按钮在窄屏不挤压文件名。

**Verification:**

- `pnpm --filter @ai-job-print/kiosk typecheck`
- `pnpm --filter @ai-job-print/kiosk lint`
- `VITE_API_MODE=http VITE_API_BASE_URL=/api/v1 pnpm --filter @ai-job-print/kiosk build`
- `pnpm --filter @ai-job-print/api verify:member-assets-c2d`
- Browser smoke: 登录态 `/me/documents` 查看、删除、空态和过期置灰。

## Review Gate

- 每个分支必须先写目标、非目标、允许文件和验证方式。
- diff 超过 30 行或跨模块变更必须 Claude + Antigravity 双模型审查。
- 每个分支完成后只显式暂存本分支文件，禁止 `git add .`。
- 删除旧实现必须另起分支，并证明无路由、无 import、无测试/verify、无当前文档声明、不会被生产部署或硬件链路使用。
- 任何涉及后端 auth、文件访问、TTL、删除或简历 payload 的改动都默认高风险，必须双模型审查。
