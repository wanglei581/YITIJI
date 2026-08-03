# 设计复审记录

## 第一轮

- Antigravity：`APPROVE`，建议补充双视口样式隔离、内部索引生产隔离和真实错误分类传导。
- Claude：`REQUEST_CHANGES`，指出 8177/5299 未版本化、与现有 75 屏基线关系不清、增量和别名路由清单不足、构建模式需区分。
- 处理：新增 §2.1 来源固化门禁、W0 唯一融合基准、别名表、错误分类、双视口隔离和目标部署模式复验。

## 第二轮

- Antigravity：`APPROVE`，无 Critical/Warning。
- Claude：发现事实清单仍漏 `14-profile.html` 和 `FREEZE.md`，要求修正共同文件一致数量。
- 处理：实机核对 5299=82、8177=90、共同文件 79 个一致；明确个人中心采用 5299“我的资产”语义。

## 最终复审

- Antigravity：`APPROVE`，100/100，无 Critical/Warning。
- Claude：`APPROVE`，确认数量、文件清单和 `14-profile` 取舍全部准确，无残余 Critical/Warning。

结论：设计规范可提交；尚未进入运行时代码实施。

## 实施计划双模型复审

### 第一轮

- Antigravity：`REQUEST_CHANGES`，指出 Playwright 基础设施 RED 顺序、CI workspace 依赖说明、路径解析基准和测试路径需收紧。
- Claude：`REQUEST_CHANGES`，发现 `/upload/phone` 没有全局标题导致原断言不可达、`/error-offline` 健康轮询可能形成未注册请求、路由 manifest 未与路由源码做集合校验、scope 守卫未覆盖 staged/untracked。
- 处理：Task 0 提前冻结来源；Playwright 先配置依赖与 fixture，再以缺失 layout helper 形成 RED；改为路由特定 landmark；显式注册 health 503；路由做双向集合差；scope 守卫改用 `git status --porcelain --untracked-files=all`；CI 对源码导出 workspace 只跑真实存在的 typecheck。

### 第二轮与来源漂移复核

- Antigravity：`APPROVE`，100/100，无 Critical/Warning。
- Claude：八项修订均通过，但在复核期间发现 8177 工作树前进到 `4d667463`，旧计划两个哈希漂移；主审进一步核对发现 `WAVE-P2-FLOWS.md` 也随纠错提交变化。
- 处理：8177 的 11 个来源全部改为固定读取纠错提交 `4d667463dd3f1353394bdaa7286c3d1b693d1e58` 的 Git blob；更新 `index.html`、`FREEZE.md`、`WAVE-P2-FLOWS.md` 三个哈希。5299 的三个未提交来源继续在 Task 0 先验哈希并立即提交冻结。

### 最终复审

- Antigravity：`APPROVE`，100/100，无 Critical/Warning。
- Claude：`APPROVE`，确认 8177 11 个 blob、三个更新哈希、5299 先验后冻全部一致，无 Critical/Warning。

结论：Master + W0 TDD 计划可执行；下一步立即执行 Task 0 来源冻结。

## W0 完成审查

### 内部规格与质量复审

- W0 完整范围：`75a76aca..404f452f`。
- 最终规格复审：`PASS`，无阻塞项。
- 最终全量质量复审：`APPROVE`，无 Critical/Warning。
- 复审过程中先后修复：遗漏的 76 工具箱主态、派生登录页敏感输入值、redirect target/duplicate 门禁、production preview 复用、CI 契约覆盖率、15-source/9-derived 精确 inventory、route manifest 正则解析及 mobile smoke 未启用 ApiRouter。
- 最终实测：baseline 12 组 PASS；契约测试 10/10，lines 97.91%、functions 100%、branches 92.09%；Playwright 裸跑、`CI=1`、故障代理环境均 4/4 PASS；shared/ui/kiosk typecheck PASS；lint 0 error / 5 个既有 warning；production build/config guard PASS。
- 范围：`apps/kiosk/src/**`、`packages/ui/src/**`、`packages/shared/**`、`services/**`、`apps/terminal-agent/**` 零差异；W0 仍只是冻结视觉基准与测试底座，不代表生产 Kiosk UI 已完成融合。

### 外部模型终审

- Claude：`APPROVE`。独立复核 12 组 baseline、10/10 覆盖率、86 router/manifest AST unique parity、5 redirects、15-source/9-derived、hash、隐私和 runtime 零改动，确认可进入 W1。
- Antigravity：两次调用均未生成有效模型报告。wrapper 明确报告本机 Antigravity 账号/eligibility/token source 不可用；该结果不计为通过，也不是代码 `REQUEST_CHANGES`。
- 处置：不伪造双模型结论；保留 Claude + 内部独立规格/质量审查的通过证据，W1 继续按同样的 TDD、子代理和审查门禁推进；Antigravity 账号恢复后再补跑。

结论：W0 已完成并冻结；下一步编写并复审 W1 共享基础与首页详细 TDD 计划。

## W1 完成审查

- 候选提交：`9999d022`。
- 浏览器：W0 smoke 4/4 PASS；W1 normal、`CI=1`、故障代理三环境各 6/6 PASS。
- 实跑修复：`.g-title-link` 45px → 48px；fixture 按真实 `KioskScreensaverPlaylist` 补 `enabled:false` 响应；可见触控目标断言 fail closed。
- 工程门禁：foundation/shell/home 与既有回归静态合同、shared/ui/kiosk typecheck、production build、`verify:prod-build-config`、diff check 全部 PASS；lint 0 error（Kiosk 5 条既有 warning，fixture 1 条 Fast Refresh warning）。
- 内部独立质量复审：`APPROVE`，Critical/Warning 0。
- Antigravity：`APPROVE`，Critical/Warning 0。
- Claude：`APPROVE`，Critical 0；仅将首页既有 nested `<main>` 语义债列为已知 Warning，并确认已诚实延后至 W6、不阻塞 W1。

结论：W1 共享 presentation API、壳层、首页、手机辅助路由与浏览器基础设施已冻结；W2–W5 可以在不修改 W1 文件的前提下进入详细计划。

## W2–W6 最终收口审查

### 新鲜验证证据

- 路由：W6 production-build Playwright **86/86 PASS**，严格为 Kiosk 84 条 `1080×1920` + Mobile 2 条 `390×844`。
- 静态：W6 contract 1/1、W2–W6 verifier 全部 PASS；W6 锁定 86/86 route ownership、landmark 三态、mobile 路由、合规文案、CI / package 接线、production fixture isolation、状态覆盖与长文本法律 fixture。
- 工程：shared / ui / kiosk typecheck PASS；Kiosk lint 0 error / 4 条既有 Fast Refresh warning；`git diff --check` PASS；禁止范围 `apps/kiosk/src/routes`、`apps/kiosk/src/services`、`packages/**`、`services/**`、`apps/terminal-agent/**`、`pnpm-lock.yaml` 无变更。
- 构建：TRTC 数字人模式与显式 text-only 模式均完成 production build，并在相同环境变量下通过 `verify:prod-build-config`。曾复现“build 有环境变量、verify 未继承”的 A1–A4 失败，修正命令环境作用域后通过，判定为执行方式问题而非代码回归。

### 实跑修复与 fail-closed 门禁

- `/member/qr-login` 在 390px 的横向溢出已修复；Mobile QR 输入框实际 25.5px 触控高度已提升为 48px。
- 横向滚动豁免只允许祖先 `overflow-x:auto|scroll`、祖先真实可滚动且祖先自身位于视口内；不豁免 `overflow:hidden`、普通负 margin 或通用元素。
- smart-campus actionbar 统一复用 `--w4-page-inset`，生产 CSS 与 W4 verifier 同步且无 fallback 漂移。
- `landmark:'none'` 必须 0 个可见 `<main>`；`presentation` 与默认 `main` 三态均 fail-closed。
- `requiresTouchTargets:false` 只允许 `/screensaver`、`/upload/phone`；非白名单显式关闭会在 route case 构造与 verifier 中失败。

### 内部与双模型终审

- 内部 reviewer：`APPROVE`，Critical/Warning 0。上轮的 landmark none 与触控豁免 Warning 均关闭；Antigravity 后续新增的三条 Task 8 文档精确白名单也已二次复核，不会匹配其他 docs 或放宽 production scope。
- Claude：`APPROVE`，Critical 0 / Warning 0。确认 `/member/qr-login`、fixture / script / landmark 文档一致，`--w4-page-inset` 无 fallback 漂移，触控白名单、横向滚动豁免、合规和 scope 均 fail-closed。
- Antigravity wrapper 首次仍因本地 CLI `admin controls not applicable` / `loadCodeAssist` 取消而无有效报告，不计为通过；随后通过已登录的本地 Antigravity 应用读取正确 worktree 完成真实终审，返回 `APPROVE`、Critical 0 / Warning 0，并实跑 W2–W6、typecheck、lint 与 production build/config guard。
- Antigravity 终审中发现 Task 8 三份正式文档会被旧 W4 scope guard 误判，已仅将 migration matrix、current-progress、next-tasks 三个精确字符串加入 `W6_INTEGRATION_FILES`；内部 reviewer 二次确认该变更未扩大生产代码白名单。

结论：W0–W6 的本地融合候选和 86 路由验收完成，可以归档 CCG 任务。该结论不等于正式商用上线；生产部署、Windows 一体机、奔图真机打印 / 扫描、真实支付 / SMS、真实 TRTC、密钥轮换、法务验收和现场试运营仍为上线前 P0。
