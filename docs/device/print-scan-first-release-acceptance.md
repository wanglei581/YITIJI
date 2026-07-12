# 打印扫描首期发布验收清单（Task 11 汇总索引）

> 本文件是打印扫描首期计划（`docs/superpowers/plans/2026-06-30-print-scan-first-release-full-scope.md` Task 11）
> 要求的验收清单**汇总索引**。判定标准、证据 ID、执行步骤与各条目状态一律以下列三份既有文档为准，
> 本文件只做逐项映射、**不维护第二份状态账本**，不另起一套并列标准，两边不一致时以被引用文档为准：
>
> - 证据包：[print-scan-first-release-acceptance-package.md](../acceptance/print-scan-first-release-acceptance-package.md)（PS-G0~PS-G4）
> - 执行清单：[print-scan-field-execution-runbook.md](../acceptance/print-scan-field-execution-runbook.md)
> - 部署与换机清单：[production-deployment-and-windows-host-checklist.md](./production-deployment-and-windows-host-checklist.md)
>
> 状态口径：以被引用文档中各 Gate / 条目的状态为准（截至本文件创建时未执行的现场项均为
> Not Passed Yet）；13 项中任何一项未过，不得宣称打印扫描首期验收完成。

## 一、13 项验收清单 → 归属映射

| # | 清单项 | 归属（判定标准与状态所在处） |
|---|--------|------------------------------|
| 1 | 本地自动化 verify 全量通过 | 证据包 PS-G0-01~04；完整口径 = CI 双 job 全绿（见 §二） |
| 2 | 预生产 PostgreSQL / COS / Redis 验证 | 证据包 PS-G1 / PS-G2；执行清单 §四~五（预生产真实连接、迁移与候选部署）；部署清单 §3（环境与版本基线，辅助） |
| 3 | Windows Terminal Agent 安装 | 部署清单 §5.3；执行清单 §六 |
| 4 | 打印机真实出纸 | 证据包 PS-G3-PAPER-01；执行清单 §七；部署清单 §5.6 |
| 5 | 扫描仪真实进件 | 部署清单 §5.7（TWAIN/WIA 或 SMB 目录 → PDF → COS → 我的文档） |
| 6 | 身份证复印 | 部署清单 §5.7 证件类专项（扫描 → A4 排版 → 真实出纸全链路，口径对齐计划 Task 8；短 TTL 清理 + 删除日志） |
| 7 | 证件照隔离验收 | 部署清单 §5.7 证件类专项（能力未上线：本项通过只代表未上线能力被正确隔离，不代表证件照功能验收通过；功能验收待 Task 8 实现后另行执行或经正式决策移出本期） |
| 8 | U 盘导入 | 部署清单 §5.5（桥接令牌 fail-closed / safeId 一次性）+ §5.7（真实插拔识别） |
| 9 | 云上传（手机扫码等非本机上传链路） | 部署清单 §4.3（文件闭环）；手机扫码上传链路以 upload-sessions 相关 verify 与真机走查为准 |
| 10 | 文件 TTL 删除 | 证据包 PS-G4-01；执行清单 §九 |
| 11 | Admin 审计抽样 | 证据包 PS-G4-05（文件访问 / 能力开关变更 / 任务重试取消各抽 ≥3 条 AuditLog 核对） |
| 12 | 回滚流程演练 | 部署清单 §7.2（回滚材料准备 + 实际回滚/恢复演练条目，仅材料准备不算通过） |
| 13 | 生产运行时门禁全绿 | 见 §三（七项拒绝语义；口径以门禁代码与对应 verify 脚本为准） |

## 二、本地自动化 verify（清单项 1 的命令口径）

以下为计划 Task 11 指定的核心命令；**完整口径 = CI 双 job（build-and-verify + postgres-readiness）
同批全绿**，其中已含 Terminal Agent verify suites、各端 typecheck / lint / 生产 build 与
`git diff --check`。如本清单与 CI 配置有出入，以 `.github/workflows/ci.yml` 为准。

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:prod-build-config
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/api verify:admin-print-scan
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/api verify:scan-tasks
pnpm --filter terminal-agent verify:print-scan-agent
pnpm --filter terminal-agent verify:usb-import-agent
pnpm --filter terminal-agent verify:local-qr-proxy
```

服务器候选包在预生产复跑核心 verify（执行清单 §四）。

## 三、生产运行时门禁（清单项 13：七项拒绝语义）

生产（NODE_ENV=production / Kiosk 生产构建）必须拒绝以下配置。**口径以
`services/api/src/config/production-runtime-gates.ts`、`apps/kiosk/vite.config.ts`
与对应 verify 脚本为准**，下表仅为映射摘要：

| 拒绝条件 | 门禁位置 | 错误码 / 断言 |
|----------|----------|---------------|
| mock API 模式 | Kiosk 构建期硬门禁（vite.config）+ `verify:production-real-services` / `verify:prod-build-config` A1 | 拒绝 `VITE_API_MODE` ≠ http |
| mock AI provider | API 启动门禁 | `PRODUCTION_AI_PROVIDER_NOT_LLM` / `PRODUCTION_LLM_CONFIG_MISSING` |
| 关闭 OCR | API 启动门禁 | `PRODUCTION_OCR_PROVIDER_NOT_BAIDU` / `PRODUCTION_BAIDU_OCR_CONFIG_MISSING` |
| 缺 Redis | API 启动门禁 | `PRODUCTION_REDIS_URL_MISSING` |
| 缺 COS | API 启动门禁 | `PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS` |
| 缺终端 ID | Kiosk 构建期硬门禁（vite.config，直接 vite build 也无法绕过；文字助手模式不豁免）+ 构建后 A4 复核 | `VITE_TERMINAL_ID` 必填 |
| 缺 print-scan feature gate 配置 | API 启动门禁 | `PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED`（必须显式 `PRINT_SCAN_CAPABILITY_MODE=managed|strict`） |

`PRINT_SCAN_CAPABILITY_MODE` 语义（真相源：`terminal-capabilities.service.ts` 的进程内单次解析）：
`managed` = 未配置的终端能力行放行既有已验证闭环（管理员按需接管）；
`strict` = 未配置行 fail-closed 拒绝（全部能力必须显式验收后配置）。选择哪种是显式部署决策。

## 四、最终判定

- 13 项全部按被引用文档判定通过并按证据包规则归档证据（原始截图 / 日志 / 实物照片保存在
  仓库外私有证据目录）后，才能按证据包「最终判定」章节宣布打印扫描首期验收通过。
  其中第 7 项（证件照隔离验收）通过**不构成**证件照功能验收通过，最终判定文案不得宣称
  证件照能力已完成。
- 任何一项失败：按执行清单停止条件中止，修复后从受影响 Gate 重跑，不得跳项。
