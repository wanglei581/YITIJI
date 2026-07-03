# AI 简历商用闭环多模型审查记录

> 日期：2026-06-29
> 分支：`codex/ai-resume-commercial-closure-plan`
> 范围：AI 简历诊断、优化、岗位/JD、模板、预览编辑、导出、打印、套餐、优惠券、收费、支付、退款、验收。
> 性质：只读审查 + 计划落地；未修改 `apps/`、`services/`、`packages/` 运行时代码。

## 参与审查

| 来源 | 结论摘要 |
| --- | --- |
| 前端子代理 | 现有 Kiosk 链路已覆盖诊断、优化、局部编辑、PDF 导出、打印跳转、系统岗位/手填 JD。缺语音生成、多格式导出、模板真实填充、外部 URL 安全化。 |
| 后端/支付子代理 | AI 解析/优化/生成/PDF 导出已具备，订单只是 `amountCents=0` 的打印底座，权益没有核销账本。商业化前不能在 GET 优化接口扣费。 |
| 合规子代理 | 无 Critical。必须明确不做平台内投递、企业收简历、候选人管理、第三方结果记录、就业承诺；收费/券/退款要幂等落库。 |
| Claude | 必须把“原版式保真”改为“模板重排”；禁止任意外部岗位 URL 抓取；收费域从零新建，不能在现有 AI 页拼接。 |
| Antigravity | 建议使用后端渲染保证最终预览/导出/打印一致；在线编辑用触控友好的卡片式结构；支付/权益需独立域。 |

## Critical

1. **不能承诺优化后与原始简历版式完全一致。**
   当前导出是结构化 `GeneratedResume` 经服务端模板重排。系统能保证优化后预览、PDF、PNG、打印之间一致，不能保证和用户上传原件完全一致。

2. **不能抓取任意外部岗位 URL 自动解析 JD。**
   任意 URL 抓取带来招聘平台边界、版权、SSRF、登录态和来源真实性风险。首期只允许系统已审核岗位或用户手动粘贴 JD 文本。

3. **收费闭环不能基于现有 `Order` 骨架直接上线。**
   当前 `Order.amountCents=0`，无 Quote、OrderItem、PaymentAttempt、PaymentTransaction、Refund、BenefitLedger、Reconciliation。真实收费必须先补这些域模型和状态机。

4. **未来收费不能发生在当前 GET 优化接口。**
   `GET /resume/records/:taskId/optimize` 当前有懒生成副作用。商业收费前必须新增显式 POST action 和订单/权益门禁，避免刷新页面触发扣费。

## Warning

1. `ResumeOptimizePage.tsx` 接近 500 行，后续新增编辑、导出、模板、AI 调整前应先拆组件。
2. `ResumeExportPage` 当前不是真实商用导出页，打印按钮被禁用；需要接真实 FileObject 或移出主流程。
3. 前端 `PrintConfirmPage` 仍有硬编码单价，商用前必须改为后端 Quote。
4. 语音生成简历必须有转写确认，不得长期保存音频，不得自动填写姓名、电话、邮箱等高敏字段。
5. DOCX/PNG/TXT/Markdown 都应通过后端 FileObject、签名 URL、归属校验和留存策略，不能直接在前端生成永久下载。
6. 权益发放已有底座，但没有 reserve/consume/release ledger；直接扣 `quantityRemaining` 会缺审计、并发和回滚。
7. 支付状态、退款状态、打印任务状态必须分离，支付异常不得伪装成打印失败。

## Info

- AI 诊断/优化/生成/岗位匹配主体链路已经存在，并且在隐私、access token、报告元数据和合规文案上有较好基础。
- JobFit 当前三档参考、无百分比、无录用概率，这是正确方向，收费后也不能改变。
- 文件资产 `assetCategory` 和 `sourceFileId` 已能表达原始文件与优化/派生成果物关系。
- 预生产和部分文件资产验收已有记录，但支付、正式生产、Windows 真机、正式域名 HTTPS、真实 provider live 仍不能宣称完成。

## 综合取舍

| 问题 | 最终决策 |
| --- | --- |
| 优化前后格式一致 | 不承诺与原件一致；承诺最终预览、导出、图片、打印同模板一致。 |
| 图片导出 | 可以做，但只保证最终渲染结果一致，不是原件保真工具。 |
| 外部岗位链接 | 首期不抓取。只允许手动 JD + 可选来源备注；系统岗位继续使用已审核来源数据。 |
| 在线编辑 | 做结构化卡片编辑，不做完整 Word 编辑器。 |
| AI 一键调整 | 可以做压缩到一页、版式优化、关键词强化、表达统一；每次必须显示差异并等待用户确认。 |
| 收费点 | 按最终 AI 成果/服务项收费，不按每次导出按钮重复收费；打印按页另算或套餐抵扣。 |
| 套餐/优惠券 | 通过 Quote/OrderItem/BenefitLedger 抵扣，免费单也落库。 |
| 支付 | 在独立 commerce/payment/refund/reconciliation 域实现，不能塞进 PrintTask。 |

## 必须进入计划的验收

- `verify:resume-extraction`
- `verify:resume-generate`
- `verify:resume-optimize`
- `verify:job-fit`
- `verify:ai-result-ownership`
- `verify:file-retention`
- `verify:member-assets-c2d`
- `verify:audit-logs`
- `verify:order`
- `verify:print-jobs`
- `verify:member-print-orders`
- 新增 `verify:resume-export-formats`
- 新增 `verify:resume-template-rendering`
- 新增 `verify:commerce-quote-order`
- 新增 `verify:benefit-ledger`
- 新增 `verify:payment-attempts`
- 新增 `verify:refunds`
- 新增 `verify:ai-commercial-flow`

## 审查结论

可以实现用户提出的大部分业务闭环，但必须按计划分期：

1. 先锁产品口径和合规边界。
2. 再补优化预览、编辑、多格式导出、模板和语音。
3. 再做报价、订单明细、权益账本。
4. 最后接真实支付、退款、对账和真机验收。

不能做或不能首期做的部分：

- 不能承诺原件排版 100% 保真。
- 不能任意抓取外部招聘 URL。
- 不能平台内投递或把简历发给企业。
- 不能在没有订单/权益/支付账本前展示真实收费闭环。
