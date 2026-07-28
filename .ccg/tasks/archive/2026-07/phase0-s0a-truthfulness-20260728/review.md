# S0-A 最终审查

## 结论

`APPROVE`（本分支 A1–A3 可合并）；阶段 0 仍为 `CONDITIONAL GO`，因为 A4 审计识别出的既有打印 SIM 与简历解析动画真值债必须拆分到后续任务，不能写成已经解决。

## 已交付

- 招聘会五个无可靠来源指标改为 `null/unsupported`，时间戳改用记录真实 `updatedAt`，来源明确为“主办方录入数据 · 非实时”。
- 两个 Kiosk 统计界面不再把 `null` 渲染成 `0` 或 `0%`，无来源时显示明确空态。
- 智慧校园静态能力改称“可查看指引”，只有可启动扩展项称“已配置入口”；关闭时不显示幽灵数量。
- 校园“AI模拟面试”进入 `/interview/setup`，并有真实按钮点击 Playwright 回归。

## 审查结果

- Claude 最终审查：`APPROVE`，Critical 0；仅提示本地截图目录导致范围门禁假红灯、一个无害死分支。截图已迁出工作树，`verify:fusion-w4` 随后全绿。
- Cursor Grok 4.5 High Fast：`CONDITIONAL PASS`。确认本分支无新增合规/真值回归；识别既有 `PrintProgressPage` SIM 假进度与真实出纸/支付话术，以及 `ResumeParsePage` 固定阶段动画。
- Antigravity：A2 聚焦复审曾为 100/100 `APPROVE`；本轮全分支复审因配额/资源限制未返回有效报告，不得表述为通过。
- Codex：复核 1080×1920、390×844 截图；独立复跑契约、类型、构建和浏览器测试；接受 Claude/Cursor 的有证据结论，不扩大本分支修复范围。

## 验证证据

- API `verify:fair-stats-truth`：31/31 PASS；API typecheck、build PASS。
- Kiosk `verify:fusion-w4`、`verify:smart-campus-ui`、typecheck、lint、生产配置 build PASS；lint 仅 4 个既有 `react-refresh` warning。
- Playwright W4：13/13 PASS（含新增校园面试真实点击）；W6 聚焦路由：8/8 PASS。
- 截图证据已迁至 Codex 可视化目录，不进入 Git，不干扰范围门禁。

## 后续独立任务

1. 打印 SIM 必须固定显示“演示模式·非真实打印”，移除未真实发生的支付、终端接收、出纸与取件暗示；生产 HTTP 主路径不改。
2. 简历解析固定阶段动画必须标明非实时阶段，或接真实后端阶段；不得继续用动画宣称 OCR/提取/诊断已完成。
3. 以上修复需各自 TDD、浏览器双视口与真机/真实 API 边界验收，不并入本次 A1–A3 候选。
