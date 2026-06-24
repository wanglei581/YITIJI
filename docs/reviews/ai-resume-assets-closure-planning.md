# AI 简历资产闭环计划审查

> 日期：2026-06-21
> 分支：`codex/ai-resume-assets-closure-plan`

## 目标

对下一组渐进式重构闭环「AI 简历上传 / 我的简历 / 我的文档 / AI服务记录资产闭环」做事实审计、双模型专家分析和执行计划，不在本分支直接改运行时代码。

## 当前事实

- 后端 `/api/v1/me/resumes`、`/me/documents`、`/me/ai-records` 已存在。
- Kiosk client `getMyResumes` 已存在。
- Kiosk 已有 `/me/documents` 和 `/me/ai-records` 页面。
- Kiosk 缺少 `/me/resumes` 页面。
- Profile「我的简历」入口仍指向 `/resume/source` 上传页；这与“我的简历”作为本人资产列表的产品口径不一致。
- `ResumeSourcePage` 登录态上传会把会员 token 传给 `kioskUploadFile(file, 'resume_upload', getToken())`。
- `ResumeReportPage` 和 `ResumeGeneratePreviewPage` 已支持会员凭 `taskId` 读回结果。

## 双模型分析结论

Antigravity：

- APPROVE。
- 建议先提交计划分支，再执行 `feature/my-resumes-page`。
- 认为真实缺口是 `/me/resumes` 页面缺失、简历操作闭环不可达、`MyDocumentsPage` 删除交互缺失。
- 建议后续分支补文档和简历删除。

Claude：

- APPROVE。
- 认为核心缺口是 `/me/resumes` 页面缺失，且 `user-data-flow-matrix.md` 的“我的简历已可回看”状态已因 IA 整改变成失真，需要先修正文档。
- 明确建议 Branch 1 后端零改动，只做元数据页。
- 建议简历删除不要在 `/me/resumes` 另开，先统一收口到 AI 服务记录页，避免双删和敏感级联语义冲突。
- 强调匿名上传后登录不自动认领；文件保存期限以后续留存策略为准：匿名 / `system_short` 文件保持短期保存，登录会员简历类文件默认 90 天，可按规则延长。

## 采纳方案

采用更保守的 Claude 主线，并保留 Antigravity 的文档删除建议为后续独立分支：

1. 当前分支只落地计划、审查报告和文档状态修正。
2. Branch 1：新增 `/me/resumes` 页面，修正 Profile「我的简历」入口。
3. Branch 2：对 `/me/resumes` 动作做回看/优化/岗位匹配状态 hardening。
4. Branch 3：单独给 `/me/documents` 补删除交互。

## 风险分级

Critical：

- 简历原文和 payload 不得进入列表页或 `/me/resumes` API 响应。
- 匿名上传后登录不得自动认领，避免公共终端串号。

Warning：

- 原始会员简历可在账号内默认保存 90 天、按规则延长至 180 天，但首批不开放长期保存；下载/打印优先走本人资产中心或导出的文档 / 生成简历 PDF。
- 简历删除入口容易和 AI 服务记录删除发生双删歧义；暂不在 Branch 1 开放。
- 「我的简历」改到 `/me/resumes` 后，上传入口要通过「AI简历服务」和空态 CTA 保持可达。

Info：

- 本组闭环不涉及投递、候选人筛选、企业收简历，合规风险低。
- 现有后端和 client 复用度高，Branch 1 应是低风险前端装配。

## 验证

本分支为计划/文档分支，验证以文档一致性和 whitespace 检查为主：

- `git diff --check`
- 双模型专家分析均 APPROVE。
