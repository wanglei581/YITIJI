# Kiosk 86 屏原型视觉 1:1 对齐设计（方案 B）

> 日期：2026-07-25  
> 分支：`codex/kiosk-visual-unification-20260725`  
> 状态：用户已确认方案 B，进入实施

## 1. 目标

把 `apps/kiosk` 全部用户可见页面的**视觉语言、排版、信息层级、组件构图**对齐 `docs/design/kiosk-proto-2026-07/`（75 基线）+ `docs/design/kiosk-proto-2026-07-fusion/`（派生状态屏），达到前端商用可读标准。

## 2. 方案 B（已批准）

- **有内容时**：色板、间距、栏位、主 CTA、页壳与对应原型一致（1080×1920）。
- **无内容 / 失败 / 离线时**：走 fusion 状态屏口径（15A / 22B / 32A / 34A / 76A / 73），**禁止**用假数据填满假装完成。
- **不改**：路由集合（86）、后端、支付、硬件、合规按钮文案白名单。

## 3. 非目标（本轮不宣称）

整机商用上线（真机打印/扫描、真实支付/SMS、TRTC、密钥轮换、生产部署）仍按 P0 验收清单；本轮只交付**前端视觉与诚实态**。

## 4. 权威源

| 类型 | 路径 |
|------|------|
| 路由契约 | `apps/kiosk/tests/visual/route-manifest.ts` |
| 映射矩阵 | `docs/design/kiosk-proto-2026-07-migration-matrix.md` |
| 基线原型 | `docs/design/kiosk-proto-2026-07/*.html` |
| Fusion 派生 | `docs/design/kiosk-proto-2026-07-fusion/*.html` |
| Shell token | `packages/ui/src/styles/kiosk-shell.css` |

## 5. 波次

| 波次 | 内容 | 完成定义 |
|------|------|----------|
| W7 | 对比度/裁切/校园双顶栏急救 | 助手发送、profile 登录、login 禁用、home/help 溢出、campus 单顶栏可读 |
| W8 | 主色统一 fusion token | 打印/我的/面试主 CTA 无冰蓝分裂 |
| W9 | 退役 lightflow 内页壳 | assistant/profile/resume 内页跟 fusion 壳同语言 |
| W10 | A 类双栏 03/05/06 | 复用 07 步进+~348px 右轨 |
| W11 | VISUAL_DIFF 21/23/26 + 空态 | 入口/预览/空态构图对齐 |

## 6. 验收

- 视口：Kiosk `1080×1920`；手机辅助页 `390×844`
- 与原型同屏：布局偏差 >±4px 打回（README 口径）
- 每波：`typecheck` + `lint`（0 error）+ `verify:kiosk-visual-unity` + 抽样 Playwright 截图
- 主 CTA：对比度可读；禁用态 opacity 不叠乘到近不可见
- 不新增路由/服务/假完成文案

## 7. 约束

- 允许改：`apps/kiosk/src/**`、`packages/ui/src/**`（presentation）
- 禁止改：services、硬件、支付、数据库、合规越界文案
- 05 保留「云端上传」+ `/scan` 分流
