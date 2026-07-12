# 打印扫描首期发布验收清单（Task 11 汇总索引）

> 本文件是打印扫描首期计划（`docs/superpowers/plans/2026-06-30-print-scan-first-release-full-scope.md` Task 11）
> 要求的验收清单**汇总索引**。判定标准、证据 ID 与执行步骤一律以下列三份既有文档为准，
> 本文件只做逐项映射，不另起一套并列标准，两边不一致时以被引用文档为准：
>
> - 证据包：[print-scan-first-release-acceptance-package.md](../acceptance/print-scan-first-release-acceptance-package.md)（PS-G0~PS-G4）
> - 执行清单：[print-scan-field-execution-runbook.md](../acceptance/print-scan-field-execution-runbook.md)
> - 部署与换机清单：[production-deployment-and-windows-host-checklist.md](./production-deployment-and-windows-host-checklist.md)
>
> 状态口径：全部条目在通过前保持 Not Passed Yet；任何一项未过不得宣称打印扫描首期验收完成。

## 一、13 项验收清单 → 归属映射

| # | 清单项 | 归属（判定标准所在处） | 状态 |
|---|--------|------------------------|------|
| 1 | 本地自动化 verify 全量通过 | 证据包 PS-G0-01~04；执行清单 §三；下方 §二 命令清单 | Not Passed Yet |
| 2 | 预生产 PostgreSQL / COS / Redis 验证 | 证据包 PS-G1 / PS-G2；执行清单 §四~五；部署清单 §3.1 / §3.4 | Not Passed Yet |
| 3 | Windows Terminal Agent 安装 | 部署清单 §5.3；执行清单 §六 | Not Passed Yet |
| 4 | 打印机真实出纸 | 证据包 PS-G3-PAPER-01；执行清单 §七；部署清单 §5.6 | Not Passed Yet |
| 5 | 扫描仪真实进件 | 部署清单 §5.7（TWAIN/WIA 或 SMB 目录 → PDF → COS → 我的文档） | Not Passed Yet |
| 6 | 身份证复印 | 部署清单 §5.7 证件类专项（复印产物短 TTL 清理 + 删除日志） | Not Passed Yet |
| 7 | 证件照 | 部署清单 §5.7 证件类专项（能力未上线：验收 = 卡片不可进入 + 能力开关非可用） | Not Passed Yet |
| 8 | U 盘导入 | 部署清单 §5.5（桥接令牌 fail-closed / safeId 一次性）+ §5.7（真实插拔识别） | Not Passed Yet |
| 9 | 云上传（手机扫码等非本机上传链路） | 部署清单 §4.3；执行清单 §七 | Not Passed Yet |
| 10 | 文件 TTL 删除 | 证据包 PS-G4-01；执行清单 §九 | Not Passed Yet |
| 11 | Admin 审计抽样 | 证据包 PS-G4-05（文件访问 / 能力开关变更 / 任务重试取消各抽 ≥3 条 AuditLog 核对） | Not Passed Yet |
| 12 | 回滚流程演练 | 部署清单 §7.2 | Not Passed Yet |
| 13 | 生产运行时门禁全绿 | 下方 §三（七项拒绝语义 + verify 命令） | Not Passed Yet |

## 二、本地自动化 verify（清单项 1 的命令口径）

```bash
pnpm --filter @ai-job-print/api verify:production-runtime-gates
pnpm --filter @ai-job-print/api verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:production-real-services
pnpm --filter @ai-job-print/kiosk verify:prod-build-config
pnpm --filter @ai-job-print/api verify:print-scan-first-release
pnpm --filter @ai-job-print/api verify:admin-print-scan
pnpm --filter @ai-job-print/api verify:print-jobs
pnpm --filter @ai-job-print/api verify:scan-tasks
```

CI（SQLite 主 job + postgres-readiness 双 job）必须同批全绿；服务器候选包在预生产复跑核心 verify。

## 三、生产运行时门禁（清单项 13：七项拒绝语义）

生产（NODE_ENV=production / Kiosk 生产构建）必须拒绝以下配置，任何一项缺失即拒启动或拒构建：

| 拒绝条件 | 门禁位置 | 错误码 / 断言 |
|----------|----------|---------------|
| mock API 模式 | Kiosk 构建门禁（`verify:production-real-services` / `verify:prod-build-config` A1） | 拒绝 `VITE_API_MODE` ≠ http |
| mock AI provider | API 启动门禁 `config/production-runtime-gates.ts` | `PRODUCTION_AI_PROVIDER_NOT_LLM` / `PRODUCTION_LLM_CONFIG_MISSING` |
| 关闭 OCR | API 启动门禁 | `PRODUCTION_OCR_PROVIDER_NOT_BAIDU` / `PRODUCTION_BAIDU_OCR_CONFIG_MISSING` |
| 缺 Redis | API 启动门禁 | `PRODUCTION_REDIS_URL_MISSING` |
| 缺 COS | API 启动门禁 | `PRODUCTION_FILE_STORAGE_DRIVER_NOT_COS` |
| 缺终端 ID | Kiosk 构建门禁 A4（文字助手模式不豁免） | `VITE_TERMINAL_ID` 必填 |
| 缺 print-scan feature gate 配置 | API 启动门禁 | `PRODUCTION_PRINT_SCAN_CAPABILITY_MODE_UNDECLARED`（必须显式 `PRINT_SCAN_CAPABILITY_MODE=managed|strict`） |

`PRINT_SCAN_CAPABILITY_MODE` 语义：`managed` = 未配置的终端能力行放行既有已验证闭环（管理员按需接管）；
`strict` = 未配置行 fail-closed 拒绝（全部能力必须显式验收后配置）。选择哪种是显式部署决策。

## 四、最终判定

- 以上 13 项全部通过并按证据包规则归档证据（原始截图 / 日志 / 实物照片保存在仓库外私有证据目录）后，
  才能按证据包「最终判定」章节宣布打印扫描首期验收通过。
- 任何一项失败：按执行清单停止条件中止，修复后从受影响 Gate 重跑，不得跳项。
