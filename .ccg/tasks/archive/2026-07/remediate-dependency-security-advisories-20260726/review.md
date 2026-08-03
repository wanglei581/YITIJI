# 审查结论

## 风险结论

- React Router `GHSA-qwww-vcr4-c8h2` 只影响 unstable RSC API；本项目三端为 Vite SPA + Data Mode，现有架构门禁禁止 RSC/SSR/Framework Mode，因此不为该告警升级 8.x。
- `brace-expansion@1.1.16/2.1.2` 未包含 `GHSA-mh99-v99m-4gvg` 所需的总展开长度防护；原门禁按版本号放行属于 false negative，已纠正。
- 全局覆盖 `brace-expansion@5.0.8` 会破坏 minimatch 3/5 依赖的 callable CommonJS 导出，禁止采用。
- 定向 pnpm 补丁保留 1.x/2.x API，并增加 100,000 结果、4,000,000 总字符和 256 展开组边界；超过组边界抛 `RangeError`，未来用户可控 glob pattern 必须在调用边界转成受控错误。

## 双模型结果

- Antigravity 分析阶段：建议保留 React Router 7、采用 `pnpm patchedDependencies` 对 1.x/2.x 做兼容安全回补，并用运行时行为测试替代版本号假放行。
- Claude 首轮终审：无 Critical；提出 W1（RangeError 行为需文档化与消费者测试）、W2（旧 `\z` 正则无效）、W3（运行时门禁硬编码 minimatch 小版本）。
- 修复结果：文档明确 RangeError 边界；overrides 改为复用统一 YAML block parser；门禁动态枚举所有补丁实例和 minimatch 消费者，验证 `_patch_hash` 真实解析路径、callable API 与普通 brace pattern。
- Claude 二轮终审：无 Critical / 无 Warning，可放行。
- pnpm 11.2.2 单线收敛后的 Claude 终审：无 Critical / 无 Warning；确认工具链四处口径、CI 安装顺序、补丁运行时门禁、锁文件 patch hash 与部署前置条件自洽。
- Antigravity 最终审查连续三次因外部账号/配额服务返回 `not logged in` / `admin controls not applicable`，未取得有效报告；不得记为通过。该故障不影响本地验证证据，但未满足理想的双模型最终审查可用性。

## 验证证据

- TDD RED：收紧门禁后因缺少 `pnpm.patchedDependencies` 预期失败。
- 早期复用现有 `node_modules` 的 pnpm 9/11 frozen 结果不可靠；强制 clean install 揭示两代 patchedDependencies 锁哈希格式不兼容，该结论已纠偏。
- 项目改为固定 pnpm 11.2.2；packageManager、engines、engineStrict、三项 CI job 与安全门禁统一，服务器升级 pnpm 11.2.2 成为部署前硬门禁。
- full/prod audit 经门禁分类后未接受 Critical/High = 0；React Router 为 accepted-unreachable，brace-expansion 为 locally-patched。
- `brace-expansion` 1.x/2.x 九组常规语义与未补丁版本一致；恶意 300 组输入抛 `RangeError`；自定义 `maxLength` 生效。
- ExcelJS `writeBuffer` → `load` 往返通过。
- 全 workspace typecheck、lint（0 error，4 条既有 Fast Refresh warning）、build 通过。
- pnpm 11.2.2 强制 frozen clean install 通过；pnpm 9.15.9 被 `ERR_PNPM_UNSUPPORTED_ENGINE` 按预期拒绝。
- 排除统一补丁文件自身 diff context 后，`git diff --check` 通过；补丁文件由 pnpm 生成并以 lockfile patch hash 锁定。
- PR #397 CI run `30199110501`：`build-and-verify`、`kiosk-browser-smoke` 与重跑后的 `postgres-readiness` 均通过。PostgreSQL 首跑在既有 `verify:member-step-up` 的随机敏感子串扫描处误报；同一提交的 SQLite 套件和 PostgreSQL 干净重跑均通过，且失败发生在本任务未修改的 verifier，因此未扩大本 PR 范围。

## 剩余边界

- 原始 `pnpm audit` 仍会按 registry 版本号报告本地已补丁 High，不得宣称 audit 告警消失。
- 未部署、未改数据库/账号/手机号/短信/Redis/COS/环境配置。
- 上游提供保持 1.x/2.x callable 契约的正式回补，或 ExcelJS 依赖链移除旧 minimatch 后，应删除本地补丁并重跑 pnpm 11 frozen clean install、full/prod audit 与 ExcelJS 往返。
