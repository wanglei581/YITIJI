# 终端设备档案与 Kiosk 配置候选改动审查记录

## 审查对象

- 分支：`codex/terminal-device-profile-closure`
- 候选 diff：
  - `apps/kiosk/scripts/verify-home-toolbox-ui.mjs`
  - `apps/kiosk/src/pages/home/HomePage.tsx`
  - `apps/kiosk/src/services/api/terminalConfig.ts`
  - `docs/progress/next-tasks.md`
  - `services/api/scripts/verify-terminal-device-config.ts`
  - `services/api/src/terminals/terminal-toolbox.service.ts`

## 本地验证

- `pnpm --filter @ai-job-print/kiosk verify:home-toolbox-ui`：PASS
- `pnpm --filter @ai-job-print/api verify:terminal-device-config`：PASS
- `pnpm --filter @ai-job-print/kiosk typecheck`：PASS
- `pnpm --filter @ai-job-print/api typecheck`：PASS
- `pnpm --filter @ai-job-print/kiosk build`：PASS
- `pnpm --filter @ai-job-print/api build`：PASS
- `pnpm --filter @ai-job-print/kiosk lint`：PASS，只有既有 `KioskBusyContext.tsx` Fast Refresh warnings。
- `pnpm --filter @ai-job-print/api lint`：PASS。
- `git diff --check`：PASS。

说明：第一次并行执行 `api lint` 与 `api build` 时，`api build` 正在重新生成 `src/generated/prisma`，导致 ESLint 读取生成文件时遇到短暂 `ENOENT`。构建结束后串行复跑 `api lint` 通过，判定为验证命令并发时序问题，不是业务代码失败。

## Antigravity 审查

### 初审

- 结论：`REQUEST_CHANGES`
- 报告的唯一 Critical：认为 `services/api/scripts/verify-terminal-device-config.ts` 中 `disabledToolbox` 来自 `saveTerminalConfig`，访问 `smartCampusItems` 会崩溃。

### 技术核查

该 Critical 与当前代码不符。当前代码是：

```ts
await toolbox.saveTerminalConfig(codeB, { enabled: false, items: [] }, adminId)
const disabledToolbox = await toolbox.getPublicConfig(codeB, { id: tB, terminalCode: codeB, enabled: true })
if (!disabledToolbox.enabled && disabledToolbox.items.length === 0 && disabledToolbox.smartCampusItems.length === 0) {
  pass('0a2. 显式关闭百宝箱时整块隐藏且不下发应用项')
}
```

`getPublicConfig` 的返回值明确包含 `smartCampusItems`，并且本地复跑 `verify:terminal-device-config` 已通过 `0a2`。

### 复核

- 结论：`VERDICT: APPROVE`
- Critical：无。
- Warning：无。
- Info：无。
- 复核结论：上一轮 Critical 不成立，属于把 `getPublicConfig` 返回结构误判为 `saveTerminalConfig` 返回结构；当前 diff 无阻塞问题。

## Claude 审查

- 结论：可提交。
- Critical：无。
- Warning：无阻塞项。
- Info：
  - 默认 `enabled=true` 不构成安全/隐私/合规风险，因为 `getPublicConfig` 仍先用 `Boolean(terminal?.enabled)` 强制停用终端关闭。
  - 未配置终端 `config` 为 `null` 时只下发空数组，默认值翻转只影响空占位块是否渲染，不会泄露功能项、外链或二维码。
  - 显式关闭场景已由 `0a2` 覆盖，空配置占位防回潮由 `E3b` 反向断言覆盖。
  - `docs/progress/next-tasks.md` 已同步生产验收口径。

## 门禁结论

- 本地验证：PASS。
- Antigravity：APPROVE。
- Claude：APPROVE。
- 合规边界：无平台内投递、候选人推荐、招聘闭环新增。
- 结论：候选 diff 可精确暂存并提交；上线前仍需按 `docs/progress/next-tasks.md` 完成 PostgreSQL 预生产 migration、外链白名单配置和真实终端验收。
