# 求职材料库商用闭环设计规格

## 目标

把首页现有「简历素材库 / 求职材料」占位收口为同一条真实业务链路：

`首页既有入口 -> /resume/templates 求职材料库 -> 选择模板 -> 生成真实 A4 PDF -> FileObject -> 我的文档 -> 预览 / 打印 / 删除 / 保存期限`

该功能仍是求职材料服务与打印服务，不做招聘投递、企业候选人管理、简历收取给企业或自营招聘闭环。

## 竞品能力映射

- Canva / Resume.io 的模板选择能力：转化为内置模板目录，不做在线设计器。
- Kickresume 的 AI 求职信能力：转化为结构化表单生成求职信、自荐信、感谢信等 PDF。
- Jobscan 的岗位关键词能力：本轮只保留岗位/目标单位字段，后续接岗位关键词参考。
- 超级简历的中文场景化：模板文案按校招、社招、技术岗、运营岗、设计岗归类。

## 本轮范围

允许修改：

- `packages/shared/src/types/jobMaterials.ts`
- `packages/shared/src/index.ts`
- `services/api/src/job-materials/*`
- `services/api/src/app.module.ts`
- `services/api/package.json`
- `services/api/scripts/verify-job-materials.ts`
- `apps/kiosk/src/services/api/jobMaterials.ts`
- `apps/kiosk/src/services/api/index.ts`
- `apps/kiosk/src/pages/resume/ResumeTemplateLibraryPage.tsx`
- `apps/kiosk/src/pages/home/HomePage.tsx`
- `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`
- `apps/kiosk/scripts/verify-job-material-library-ui.mjs`
- `apps/kiosk/package.json`
- `apps/admin/src/services/api/jobMaterials.ts`
- `apps/admin/src/routes/job-materials/index.tsx`
- `apps/admin/src/routes/index.tsx`
- `apps/admin/src/layouts/AdminLayoutWrapper.tsx`
- `apps/admin/scripts/verify-admin-job-materials-ui.mjs`
- `apps/admin/package.json`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `docs/product/user-data-flow-matrix.md`

禁止修改：

- 不新增首页重复入口或新的 `/materials` 顶层页。
- 不新增数据库模板表和迁移。
- 不新增 Puppeteer、浏览器渲染、第三方模板素材依赖。
- 不修改旧秒哒目录。
- 不做平台内投递、企业候选人筛选、候选人推荐、企业收简历。

## 后端契约

新增 `JobMaterialsModule`：

- `GET /api/v1/job-materials/templates`：公开读取已发布内置模板，不返回任何文件存储 key。
- `POST /api/v1/job-materials/generate`：受 `EndUserAuthGuard` 保护，会员本人生成 PDF。
- `GET /api/v1/admin/job-materials/summary`：受 admin guard 保护，返回模板数量、生成文件统计、最近 7 天趋势。

生成文件：

- `purpose = 'cover_letter'`
- `assetCategory = 'derived'`
- `sensitiveLevel = 'sensitive'`
- `endUserId = 当前会员 endUserId`
- `createdBy = 'job_material_generate'`

响应只返回 `fileId`、短期签名 URL、`previewUrlPath`、`downloadUrlPath`、页数和保存期限，不持久化用户表单原文。

## 前端体验

Kiosk：

- 首页点亮现有「简历素材库」和「求职材料」两张卡，均进入 `/resume/templates`，通过 query/tab 区分默认筛选。
- `/resume/templates` 改为「求职材料库」，展示模板、标签筛选、结构化生成表单。
- 只有生成成功并拿到真实 `signedUrl` 后才开放「打印材料」。
- 生成成功后给出「查看我的文档」「打印材料」两个动作。

我的文档：

- 对 PDF 文档补「打印」动作。
- 打印前重新用本人 token 换短期 `previewUrlPath`，再进 `/print/confirm`。

Admin：

- 新增单一菜单「求职材料库」。
- 只读展示内置模板、发布状态、使用统计和留存口径。
- 不提供模板上传/编辑，避免未建版权和审核闭环时形成运营假能力。

## 安全与合规

- 生成接口必须会员登录；匿名只可浏览模板。
- 输入字段限制长度、数组数量；不接收 HTML。
- PDF 生成失败不创建 FileObject。
- 审计 payload 只写 templateId、documentType、fileId、endUserId，不写正文。
- Admin 统计不展示个人姓名、电话、邮箱、正文。
- 禁止文案：一键投递、立即投递、平台投递、发送给企业、候选人推荐。

## 商用闭环验收

- Kiosk 首页不再显示「即将上线」占位。
- Kiosk 生成真实 PDF 并进入 `FileObject`。
- `GET /me/documents` 能看到生成文件。
- `/me/documents` 可预览和再次打印。
- Admin 有只读运营视图。
- API / Kiosk / Admin 静态 verify 通过。
- API typecheck、Kiosk typecheck、Admin typecheck 通过。
