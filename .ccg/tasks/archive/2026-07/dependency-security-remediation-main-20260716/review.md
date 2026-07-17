# 依赖安全与 multipart 限深复审

## 结论

本地候选通过独立 CCG 终审：无 Critical 或 Warning。可提交并创建 PR，仍须以 GitHub 的 SQLite / PostgreSQL CI 为最终门禁；不代表已合并或部署。

## 已修复的审查发现

- 新增 `verify-multipart-field-nesting.ts` 原本未被 API 主 `tsconfig` 覆盖，单独严格编译会报 Map 键类型和 `fetch` `BodyInit` 两处错误。已修复，并将同一份严格 `tsc` 检查前置到 `verify:multipart-field-nesting`，故本地与 CI 都会先编译该脚本再运行。

## 非阻塞说明

- 静态扫描当前识别直接导入并调用的 `FileInterceptor`。当前 10 处上传入口均为这一模式，计数、每文件契约和运行时 loopback 均通过；未来若引入 import alias 或包装器，应扩展 AST import-binding 解析后再采用该写法。
- pnpm 11 会提示根 `package.json` 的 `pnpm.overrides` 不读取；实际生效的是同值的 `pnpm-workspace.yaml` override。锁文件与 `pnpm why` 已证明解析结果正确。
- 本机 macOS 的 Prisma Schema Engine 无法为全新临时 SQLite datasource 输出可诊断错误，故既有 `verify:print-jobs` 未在本机执行；没有修改 schema、迁移、生产数据库或以其他方式绕过。候选 PR 的 Linux SQLite CI 会在 fresh schema 后执行该既有 verify。

## 已完成验证

- `pnpm install --offline --frozen-lockfile`
- `pnpm audit --audit-level=high`：0 high / 0 critical；剩余 2 low、1 moderate 已独立列为 P1。
- `pnpm why shell-quote hono multer vite --depth 8`：仅解析 `1.8.4` / `4.12.25` / `2.2.0` / `6.4.3`。
- `pnpm -r typecheck`，API/三端 lint，API/三端/Terminal Agent build。
- `verify:multipart-field-nesting`：严格单文件 TypeScript 编译、AST 10 入口核验、flat multipart 204、`meta[nested]` 400 且 `LIMIT_FIELD_NESTING`。
- `verify:upload-sessions` 与 `verify:kiosk-upload-print-contract`（11 项）通过。
- `git diff --check` 通过。

## 审查来源

- CCG 依赖规范审查发现 CI 缺口，已补入 SQLite `Verify suites` 后复核。
- CCG 最终差异审查结论为 `APPROVE`；其脚本类型问题已按上述方式修复并复审。
- 曾尝试调用 Claude Opus 4.8 与 Antigravity 进行外部复审。Claude 审查进程已开始读取完整差异但 wrapper 未持久化最终报告；Antigravity 因本机登录 / 远程工具确认链路异常无法产出有效报告。两者均不计为通过，本文不把外部双模型终审写成已完成。
