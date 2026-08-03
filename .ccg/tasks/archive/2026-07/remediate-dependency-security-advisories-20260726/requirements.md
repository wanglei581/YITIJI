# 需求与边界

## 真实阻塞

`pnpm audit --audit-level=high` 报告 React Router RSC CSRF 绕过与 `brace-expansion` DoS 两项 High。React Router 告警仅影响本项目未使用且被门禁禁止的 unstable RSC API；`brace-expansion@1.1.16/2.1.2` 虽修复过旧公告，但源码尚无本次 CVE 所需的总展开长度上限，现有门禁误将其视为已修复。需要用保持 CommonJS 调用契约的定向补丁真实消除 DoS，并修正门禁语义。

## 允许修改

- 根依赖治理配置：`package.json`、`pnpm-workspace.yaml`、`pnpm-lock.yaml`
- `.github/workflows/ci.yml` 与既有依赖审计说明（仅用于统一 pnpm 11.2.2 工具链）
- `patches/` 下仅限 `brace-expansion@1.1.16` 与 `brace-expansion@2.1.2` 的安全回补
- 必要时修改三端 `package.json`，但必须先证明不能由工作区级约束解决
- 现有 dependency security verifier / CI 配置，仅在现有门禁无法表达经验证的风险边界时修改
- `docs/progress/current-progress.md`、`docs/progress/next-tasks.md`
- 本任务 CCG 记录

## 禁止事项

- 不顺带升级无关依赖、React、Vite、Prisma、NestJS 或业务代码。
- 不以关闭审计、通配忽略 High、伪造版本或删除安全门禁作为修复。
- 不把 `brace-expansion` 全局强制升级到 5.x；该版本导出对象，而 minimatch 3/5 需要可调用的 CommonJS 函数。
- 不在未验证三端路由兼容前跨 React Router 主版本升级。
- 不部署、不修改数据库、账号、手机号、短信、密钥或生产配置。

## 验收标准

- 先取得当前审计 RED，并记录两项 High 的完整依赖路径。
- 使用官方 advisory / 包元数据确认受影响版本、修复版本和本项目可利用面。
- 强制 clean install 已证明 pnpm 9/11 的 patchedDependencies 锁哈希格式不兼容；项目固定 pnpm 11.2.2，packageManager、engines、engineStrict、三项 CI job 与安全门禁必须一致。部署前必须先升级仍使用 pnpm 9 的服务器。
- `pnpm audit --audit-level=high` 与项目 dependency security gate 通过，或对确属不可利用且无兼容补丁的告警建立精确、可审计、非通配的临时门禁并记录退出条件。
- `brace-expansion@1.1.16/2.1.2` 保持 `module.exports` 可调用，并通过可执行的 `maxLength` 限制测试；门禁不得再仅凭版本号声称已修复。
- 三端 typecheck、lint、build 与浏览器/静态路由门禁通过；锁文件只含预期依赖变化。
- 双模型分析与最终审查无未解决 Critical，任务归档并通过 PR CI。
