# 用户文件与简历资产 Gate 3/Gate 4 证据包与试运营验收模板

## 背景

Gate 2 预生产刷新方案已完成，但实际远程执行仍需用户确认。为了让 Gate 2 通过后可以直接进入商用闭环验收，本任务只补齐 Gate 3/Gate 4 的执行级证据模板，不连接服务器、不写数据库、不写 COS、不创建账号。

## 目标

- 建立 Gate 3 自动命令门禁的证据编号、日志命名和脱敏规范。
- 建立 Gate 4 浏览器账号验收的会员 A / 会员 B / Admin 证据矩阵。
- 明确原始文件、优化后/修改后文件、90 天、180 天、长期保存、签名 URL、跨账号否定测试、删除三态一致、过期清理和 Admin 生命周期视图的通过标准。
- 同步预生产执行记录，使 Gate 3/Gate 4 从粗表升级为可执行证据包入口。

## 非目标

- 不执行 Gate 2、Gate 3 或 Gate 4。
- 不连接预生产/生产服务器。
- 不执行 `verify:cos:live`、浏览器登录、DB 查询、COS 控制台操作。
- 不新增或修改业务代码、API、schema、页面或云资源配置。
- 不提交真实证据、截图、手机号、文件 ID、密钥、签名 URL 或简历正文。

## 允许修改

- `docs/acceptance/user-file-assets-gate3-gate4-evidence-runbook.md`
- `docs/acceptance/user-file-assets-preprod-execution-record.md`
- `docs/progress/current-progress.md`
- `docs/progress/next-tasks.md`
- `.ccg/tasks/file-assets-gate3-gate4-evidence-plan/*`

## 验证方式

- `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance`
- `git diff --check`
- 搜索确认没有真实主机 IP、手机号、密钥、签名 URL 查询串或违规招聘闭环文案。
