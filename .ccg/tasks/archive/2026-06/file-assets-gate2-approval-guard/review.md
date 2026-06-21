# Gate 2 审批确认口径防回退审查记录

## 范围

- 分支：`codex/file-assets-gate2-approval-guard`
- 基线：`157f313e`
- 目标：保护 `docs/acceptance/user-file-assets-gate2-approval-package.md` 的 Gate 2 用户确认口径，防止后续削弱远端执行授权边界。
- 非目标：不连接预生产或生产，不上传候选包，不迁移数据库，不重启 PM2，不写 COS/账号/浏览器验收数据，不宣布 Gate 2、Gate 3/Gate 4、试运营或商用闭环完成。

## TDD 与验证

- RED：先修改 `services/api/scripts/verify-file-assets-trial-acceptance.ts`，新增审批确认块锚点和确认口径断言；运行 `pnpm --filter @ai-job-print/api verify:file-assets-trial-acceptance` 按预期失败，错误为缺少 `<!-- GATE2_APPROVAL_STATEMENT_START -->`。
- GREEN：在审批包第九节加入 `GATE2_APPROVAL_STATEMENT_START/END` 机读锚点，并补进度入口后，同一命令通过。
- 复审修复：Claude 指出 token 只在整个 consent block 搜索会产生假通过；已改为分别抽取 `同意：`、`不同意：`、`已知：` 行并逐项断言，同一命令再次通过。
- `git diff --check`：通过。
- 精确秘密与招聘红线扫描：通过；未发现真实 secret、连接串、token 或合规红线文案。

## 双模型分析

- Claude：建议按 `## 九、用户确认口径` 或机读锚点切片，锁定“用户明确确认后才能执行”、同意范围、不同意范围、Gate 3/Gate 4 另行确认、Gate 2 不等于试运营或商用闭环完成，并扩展完成声明否定语境扫描。
- Antigravity：建议审批包新增显式 guard 标记，锁定 `APPROVAL REQUIRED，尚未执行` 状态和确认/同意/不同意/已知四类语句；提示整段硬比对可能过脆。

## 双模型审查

### 第一轮

- Claude：无 Critical；Warning 为同意/不同意 token 未绑定到具体行，禁止项移到同意行仍可能假通过；另提示否定语境里的 `待` 过宽。
- Antigravity：启动较慢但输出 APPROVE；其对本分支相关结论为无 Critical，认为审批确认口径防回退方向成立。

### 修复

- 新增 `findRequiredLine`，分别提取 `同意：`、`不同意：`、`已知：` 行。
- 同意项只在同意行检查；不同意项只在不同意行检查；Gate 3/Gate 4 另行确认和不等于试运营/商用闭环只在已知行检查。
- 移除完成声明否定语境中过宽的 `待`。

### 第二轮

- Claude：无 Critical，确认上一轮 Warning 已闭合；剩余为低风险 Info，例如未来可进一步断言三类行只出现一次。
- Antigravity：无 Critical、无 Warning，APPROVE；确认行前缀匹配闭合越权假通过风险。报告中夹带了主工作区规范化口径的无关描述，未作为本分支证据采纳。

## 结论

本分支可合入。它只增强本地静态门禁和审批包防回退提示，不代表 Gate 2 已授权、已执行，也不代表 Gate 3/Gate 4、生产、试运营或 Windows 真机验收完成。
