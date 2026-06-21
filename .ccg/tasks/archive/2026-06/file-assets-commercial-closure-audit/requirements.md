# 用户文件与简历资产商用闭环完成度审计矩阵

## 用户请求

用户要求把“用户文件与简历资产商用闭环”建立为持续目标推进，当前先回答“还剩哪些没有完成”，并按项目规范化、商用级别、双模型审查要求推进。

## 本分支目标

只做本地只读证据汇总和文档收口，形成一份完成度审计矩阵：

- 明确数据库模型、保存期限、账号资产 API、Kiosk 文件管理、Admin 生命周期视图、COS/隐私合规、预生产 Gate 2/3/4、正式生产/Windows/试运营分别处于什么状态。
- 区分“代码/文档候选已具备”“待预生产验证”“待真实验收”“外部依赖”。
- 给出后续持续目标的第一批执行顺序。

## 非目标

- 不修改运行时代码、数据库迁移、构建脚本或测试逻辑。
- 不连接预生产或正式生产服务器。
- 不执行 COS live、账号登录、DB 查询、文件上传、保存期限修改或删除。
- 不改腾讯云、域名、HTTPS、短信、OCR、TRTC、ASR/TTS、Windows 真机或第三方资源。
- 不声称生产/试运营/Windows 真机验收已经完成。

## 允许修改文件

- `docs/acceptance/user-file-assets-commercial-closure-audit.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-commercial-closure-audit/*`

## 验证方式

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 针对新增/修改文档运行敏感信息与合规红线扫描。
- Claude + Antigravity 双模型审查；如 Antigravity 工具无有效输出，必须如实记录。

## 回滚方式

本分支仅文档变更。回滚时删除新增审计文档，撤回进度入口更新和 `.ccg/tasks/file-assets-commercial-closure-audit` 归档即可；不涉及远端环境、数据库或对象存储状态。
