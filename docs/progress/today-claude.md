# 2026-06-01 Claude 今日动手清单(Day 4)

> 日期格式:YYYY-MM-DD。本文件每天覆盖。

## 角色

P0 冲刺 W1 Day 4。K2d 简历优化对比页 + W1 收尾(开 PR 合 main)。

## 分支

`feat/p0-w1-claude-ui-foundation`(延续整周分支)。

## 将编辑/新建的文件

- `apps/kiosk/src/pages/resume/ResumeOptimizePage.tsx`(改写优化对比 UI:
  从"两段彩色盒子"升级为 `ReactDiffViewer` 字符级 diff + split-view + 整体评分提升卡)

## 将新增/修改的共享类型契约(packages/shared)

无。沿用 `ResumeOptimizeModule { title, before, after }` 形状。
**专家报告强调的"语义 diff with reason/dimension"** 涉及 prompt schema 改动 +
provider 全部同步 + 桩数据,**不在 Day 4 scope**,留到 W2 整周做 K2d 升级版。

## 将安装的依赖

无。`react-diff-viewer-continued@4.2.2` 已在 Day 1 装好(`603c15d`)。

## 阻塞 Mavis 的事项

无。今日只动 Kiosk resume(我的独占目录)+ docs。

## Mavis 今天可以并行做的事(零冲突)

1. K1 Kiosk 首页卡片墙
2. K3 Kiosk 招聘列表 + 合规横幅
3. A4 Admin 岗位信息源蓝色横幅
4. P1 Partner 工作台:占位 SVG → `TrendLineChart` / `MetricGrid`
5. **新增**:可消费 BE-2 audit 接口,做 A5 Admin 审计 UI 骨架

## 预计完成时间

UTC+8 EOD。

## 完成清单(下班前更新)

- [ ] ResumeOptimizePage diff view 改写
- [ ] 评分提升卡片(优化前/后 + "估算,仅供参考"免责)
- [ ] typecheck 全员通过
- [ ] commit
- [ ] 开 PR `feat/p0-w1-claude-ui-foundation` → `main`,标题 P0 W1 周收尾
