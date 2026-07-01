# 客户真实岗位样本导入 readiness

> 状态：导入准入与静态门禁已定义；2026-07-01 已完成一次本地 Excel 导入链路验证，但因来源链接为首页级且校招分类源数据不一致，真实客户样本验收仍未通过。
> 本文件只用于客户样本进入真实验收前的字段、路径和证据准备，不代表客户样本验收完成。

## 目标

本 readiness 只解决一件事：客户真实岗位样本到达系统前，先确认现有导入链路能承接客户字段、拒绝不该接收的数据，并在导入后刷新岗位质量快照。

不做：

- 不新增 Kiosk / Admin / Partner 页面入口。
- 不导入候选人、简历、手机号、邮箱、投递状态、面试邀约或 Offer 数据。
- 不记录第三方平台投递结果。
- 不把本地演示岗位当成客户真实样本。
- 不在客户样本、预生产浏览器和一体机真机三项完成前对外宣称岗位信息 AI 商用完成。

## 最小字段清单

客户样本至少要满足以下字段，才能进入后续岗位 AI 浏览器验收。

| 字段 | 用途 | Partner API | Excel | Webhook | API 拉取 |
| --- | --- | --- | --- | --- | --- |
| `sourceOrgId` | 真实机构归属 | 来自 JWT 机构 | 来自数据源机构 | 来自签名数据源机构 | 来自数据源机构 |
| `externalId` | 客户源系统外部编号 | 必填 | 必填 | 必填 | 必填 |
| `title` | 岗位名称 | 必填 | 必填 | 必填 | 必填 |
| `company` | 招聘单位 | 必填 | 必填 | 必填 | 必填 |
| `city` | 城市 | 必填 | 必填 | 必填 | 必填 |
| `sourceUrl` | 来源链接 / 二维码目标 | 必填 | 必填 | 必填 | 必填 |
| `description` | 岗位描述 | 推荐 | 推荐 | 推荐 | 推荐 |
| `requirements` | 任职要求 | 推荐 | 推荐 | 推荐 | 推荐 |
| `industry` | 行业 / 分类辅助 | 支持 | 支持 | 支持 | 支持 |
| `workType` | 工作类型 | 支持枚举 | 支持映射并落库 | 支持枚举和常见别名归一化 | 支持映射 |
| `educationRequirement` | 学历要求 | 支持 | 支持 | 支持 | 支持 |
| `experienceRequirement` | 经验要求 | 支持 | 支持 | 支持 | 支持 |
| `skills` | 技能关键词 | 支持数组 | 支持分隔文本 | 支持数组 | 支持数组或分隔文本 |
| `benefits` | 福利标签 | 支持数组 | 支持分隔文本 | 支持数组 | 支持数组或分隔文本 |
| `salary` | 薪资展示文本 | 支持 | 支持 | 支持 | 支持 |
| `salaryMin` | 薪资下限 | 支持数字 | 支持数字 | 支持数字 | 支持数字 |
| `salaryMax` | 薪资上限 | 支持数字 | 支持数字 | 支持数字 | 支持数字 |
| `salaryUnit` | 薪资周期 | 支持 | 支持 | 支持 | 支持 |
| `validThrough` | 岗位有效期 | 支持 ISO 日期 | 支持可解析日期 | 支持 ISO 日期 | 支持可解析日期 |

说明：

- `description` 与 `requirements` 至少应提供一项，否则质量快照会降级。
- `skills`、`educationRequirement`、`experienceRequirement` 等字段越完整，岗位越容易达到 AI-readable `ready`。
- `headcount` 当前不属于 `Job` 表持久化字段，不作为岗位样本准入字段；如客户需要展示招聘人数，应另起 schema / 展示设计，不在本轮混入。
- `tags` 可由 Partner API / Webhook 接收；Excel 当前不把 `tags` 作为准入字段，客户应优先提供 `skills`、`benefits`、`industry`。

## 四条实际入口

### Partner API

入口：`POST /partner/jobs/import`

准入：

- 必须使用合作机构账号 JWT。
- `sourceOrgId` 和 `sourceName` 只来自登录机构，不读请求 body。
- body 只允许岗位展示字段；多余字段会在全局 `forbidNonWhitelisted` 下 400 拒收。
- 导入后写 `Job`，默认 `reviewStatus=pending`、`publishStatus=draft`，再刷新 `JobDataQualitySnapshot`。

### Excel

入口：

- `POST /partner/excel/parse`
- `POST /partner/excel/preview`
- `POST /partner/excel/:batchId/confirm`

准入：

- 表头命中手机号、邮箱、简历、候选人、投递、面试、Offer 等敏感列时，直接拒收。
- `JOB_STANDARD_FIELDS` 白名单覆盖本文件最小字段。
- `workType` 会在预览阶段按统一规则归一化，未知值进入无效行，避免确认导入时静默写成空分类。
- `ImportRecord.rawDataJson` 不保存原始行，避免把客户表格里非映射内容写库。
- `confirm` 后写 `Job` 并刷新 `JobDataQualitySnapshot`。

### Webhook

入口：`POST /sync/webhook?source=<jobSourceId>`

准入：

- 必须校验 HMAC、5 分钟时间窗和 nonce 防重放。
- `sourceOrgId` 来自已启用 `webhook` 数据源，不读 body。
- `workType` 接受 `full_time`、`part_time`、`internship`、`contract`、`campus`，并会把 `FULL_TIME`、`full-time`、`全职`、`兼职`、`实习`、`合同`、`校招`、`校园招聘`、`应届` 等常见客户别名归一化；仍无法识别的未知值直接拒收，避免被静默写成全职。
- 支持与 Partner API 对齐的 AI-ready 字段：学历、经验、技能、福利、薪资上下限、薪资周期、有效期。
- 审计只记录 `source=webhook`、机构、导入数量和 requestId，不保存原始 payload。

合规 JSON 样本：

```json
{
  "items": [
    {
      "externalId": "cust-job-001",
      "title": "客户成功经理",
      "company": "真实客户科技有限公司",
      "city": "上海",
      "sourceUrl": "https://jobs.example.com/cust-job-001",
      "salary": "15000-22000",
      "description": "负责客户上线、续约和产品使用反馈闭环。",
      "requirements": "熟悉 B 端客户服务和项目推进。",
      "industry": "企业服务",
      "workType": "full_time",
      "educationRequirement": "本科及以上",
      "experienceRequirement": "3 年以上",
      "skills": ["客户沟通", "项目推进"],
      "benefits": ["五险一金"],
      "salaryMin": 15000,
      "salaryMax": 22000,
      "salaryUnit": "monthly",
      "validThrough": "2099-12-31T00:00:00.000Z"
    }
  ]
}
```

### API 拉取

入口：`JobSyncService` 按启用的数据源配置拉取。

准入：

- `responseConfig.fields` 可把客户字段映射到标准字段。
- `rootPath` 定位客户返回中的岗位数组。
- 命中敏感字段名时，该字段会跳过并记录告警；该路径的敏感字段策略是“跳过 / 告警”，不宣称统一拒收客户响应整体。
- 写入后默认 `pending + draft`，必须经 Admin 审核 / 发布后才进入 Kiosk。

## 验收步骤

客户真实岗位样本到达后按以下顺序执行：

1. 建立或确认真实合作机构和数据源，记录脱敏机构别名，不在文档中保存客户密钥。
2. 选择一种导入路径：Partner API / Excel / Webhook / API 拉取。
3. 先跑 `pnpm --filter @ai-job-print/api verify:job-customer-sample-readiness`。
4. 导入客户样本，保存仓库外命令日志和脱敏摘要。
5. Admin 审核并发布本轮样本中的可展示岗位。
6. 复核 `JobDataQualitySnapshot`：至少记录 `ready / partial / insufficient` 数量，不保存完整岗位描述。
7. 复核 Admin 岗位来源质量摘要。
8. 复核 Partner 只能看到本机构岗位质量摘要。
9. 复核 Kiosk `/jobs` 和 `/jobs/:id` 只展示已审核已发布岗位。
10. 点击来源入口只生成 `ExternalJumpLog(action=external_apply)`，不记录投递结果。

## 通过标准

```text
客户样本导入 readiness：通过
真实客户样本导入：待执行 / 已执行未通过 / 已执行通过
公开岗位演示数据：已隔离 / 已下线 / 仍阻塞
岗位质量快照：已刷新 / 未刷新
Admin 质量摘要：已复核 / 未复核
Partner 隔离：已复核 / 未复核
Kiosk 展示：已复核 / 未复核
```

只有“真实客户样本导入、质量快照、Admin / Partner / Kiosk 展示”全部通过后，才能进入预生产公网真实会员浏览器验收。

## 停止条件

- 样本中出现候选人姓名、手机号、邮箱、简历、投递状态、面试时间、Offer 等字段。
- 导入路径绕过机构归属，把岗位写到错误 `sourceOrgId`。
- `sourceUrl` 缺失或不是 http / https。
- 样本仍混入演示来源、演示标题或 demo externalId。
- Partner 能看到其他机构岗位质量摘要。
- Kiosk 展示未审核或未发布岗位。
- 文档、日志或截图泄露客户密钥、签名、cookie、JWT、完整来源签名 URL 或完整岗位描述。

## 当前结论

### 2026-07-01 本地 Excel 导入链路验证

用户提供 `岗位数据导入模板_已填写.xlsx` 后，已在本地 SQLite 中用专用机构 / 数据源隔离导入：

- 机构：`org-customer-job-sample-20260701`
- 数据源：`src-customer-job-sample-excel-20260701`
- 导入前备份：`/tmp/ai-job-print-dev-before-job-sample-20260701114004.db`
- Excel 只读检查：100 行、18 个模板字段全部匹配、无敏感表头、必填字段齐全、无非法 `workType`、`sourceUrl` 均为 http(s)。
- 导入结果：`preview totalRows=100 validRows=100 invalidRows=0 dupRows=0`，`confirm imported=100`，`SyncLog result=success added=100 error=0`。
- 审核发布：本地通过 `JobsService.reviewJobSource` / `publishJobSource` 发布 100 条；公开查询按该 `sourceOrgId` 可见 100 条。
- 质量快照：100 条均为字段完整度 `ready`；该结果不代表来源 URL 可达性或逐条岗位真实性已核验。
- 公开筛选抽样：北京 25 条、关键词“算法”6 条、实习 13 条、兼职 6 条、全职 81 条、校园招聘 0 条。

本次只能证明本地 Excel 导入、审核发布、公开查询和字段质量快照链路已打通；不能作为真实客户岗位样本验收通过，原因：

- 100 条岗位只有 10 个去重 `sourceUrl`，均为招聘官网或招聘平台首页级链接，不是逐条岗位详情页，用户外跳后仍需二次搜索。
- 2 条标题含“校招”的岗位在源表 `workType` 填为 `full_time`，系统按源数据落到 `fulltime`；如客户需要校园招聘筛选，应在源表中改为 `campus` / `校招` / `校园招聘`。

进入预生产真实会员浏览器验收前，必须先提供逐条岗位详情 URL，并修正源表中的校招 `workType`。本批数据可以保留为本地导入链路验证批次，但不得写作“客户真实岗位样本验收通过”。

```text
客户真实岗位样本导入 readiness：已准备静态门禁
本地 Excel 导入链路验证：已执行，通过
客户真实岗位样本验收：Not Passed Yet（来源链接与校招分类待修正）
不得对外宣称岗位信息 AI 商用完成
```
