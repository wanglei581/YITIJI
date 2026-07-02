# 客户真实岗位样本导入 readiness

> 状态：导入准入与静态门禁已定义；2026-07-01 已用同目录 `gen_jobs.py` 生成的合成自测 Excel 完成一次本地导入链路验证，但该批不是客户真实岗位样本，真实客户样本验收仍未通过。
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

### 2026-07-01 合成 Excel 本地导入链路验证

`岗位数据导入模板_已填写.xlsx` 位于 local-agent `outputs/` 目录，经核实由同目录 `gen_jobs.py` 生成，脚本自述为“生成100条真实行情+范例岗位数据”，属于合成自测样例，不是客户真实岗位样本。已在本地 SQLite 中用专用机构 / 数据源隔离导入，用于验证导入链路：

- 机构：`org-customer-job-sample-20260701`
- 数据源：`src-customer-job-sample-excel-20260701`
- 导入前备份：`/tmp/ai-job-print-dev-before-job-sample-20260701114004.db`
- Excel 只读检查：100 行、18 个模板字段全部匹配、无敏感表头、必填字段齐全、无非法 `workType`、`sourceUrl` 均为 http(s)。该检查只代表合成自测样例格式可被系统承接，不代表岗位真实性。
- 导入结果：`preview totalRows=100 validRows=100 invalidRows=0 dupRows=0`，`confirm imported=100`，`SyncLog result=success added=100 error=0`。
- 审核发布：本地通过 `JobsService.reviewJobSource` / `publishJobSource` 发布 100 条；公开查询按该 `sourceOrgId` 可见 100 条。
- 质量快照：100 条均为字段完整度 `ready`；该结果不代表来源 URL 可达性或逐条岗位真实性已核验。
- 公开筛选抽样：北京 25 条、关键词“算法”6 条、实习 13 条、兼职 6 条、全职 81 条、校园招聘 0 条。

本次只能证明本地 Excel 导入、审核发布、公开查询和字段质量快照链路已打通；不能作为真实客户岗位样本验收通过，原因：

- 该批数据由 `gen_jobs.py` 合成生成，不是客户或正式岗位源提供的真实在招岗位。
- 100 条岗位只有 10 个去重 `sourceUrl`，均为招聘官网或招聘平台首页级链接，不是逐条岗位详情页，用户外跳后仍需二次搜索。
- 2 条标题含“校招”的岗位在源表 `workType` 填为 `full_time`，系统按源数据落到 `fulltime`；如客户需要校园招聘筛选，应在源表中改为 `campus` / `校招` / `校园招聘`。

进入预生产真实会员浏览器验收前，必须先由客户或正式数据源提供真实岗位样本、逐条岗位详情 URL，并修正源表中的校招 `workType`。本批数据只能保留为本地导入链路自测批次和整改文件生成示例，不得写作“客户真实岗位样本验收通过”。

```text
客户真实岗位样本导入 readiness：已准备静态门禁
合成 Excel 本地导入链路验证：已执行，通过
客户真实岗位样本验收：Not Passed Yet（真实样本未到位，来源链接与校招分类仍需正式数据源修正）
不得对外宣称岗位信息 AI 商用完成
```

### 2026-07-01 腾讯真实岗位样本本地导入链路验证

用户提供 `岗位数据_真实样本_腾讯.xlsx` 后，已在本地 SQLite 中用专用机构 / 数据源隔离导入：

- 机构：`org-tencent-real-job-sample-20260701`
- 数据源：`src-tencent-real-excel-20260701`
- 导入前备份：`/tmp/ai-job-print-dev-before-tencent-real-sample-20260701153526.db`
- Excel 只读检查：100 行、21 个表头；18 个标准字段全部可映射，额外 `来源名称` / `发布时间` / `同步时间` 未映射入库；无敏感表头、必填字段齐全、`workType=fulltime` 已归一化为 `full_time` / `fulltime`。
- 来源链接：100 条均为 `https://careers.tencent.com/jobdesc.html?postId=...` 逐条岗位详情页；全量 100 条 HTTP GET 抽检均返回 200。
- 导入结果：`preview totalRows=100 validRows=100 invalidRows=0 dupRows=0`，`confirm imported=100`，`SyncLog result=success added=100 error=0`。
- 审核发布：本地审核通过 100 条；质量快照发现 1 条岗位 `validThrough=2026-06-27` 已过期，已在本地隔离样本中下架；公开查询按该 `sourceOrgId` 可见 99 条。
- 质量快照：总样本 100 条中 `ready=58`、`partial=41`、`insufficient=1`。41 条 partial 主要缺 `educationRequirement`，另有 1 条缺 `skills`；1 条 insufficient 为已过期且缺学历要求，已下架。
- 公开筛选抽样：深圳 63 条、北京 18 条、广州 12 条、上海 6 条、成都 1 条；该统计按导入 100 条口径计算，包含随后下架的 1 条过期深圳岗位，因此预生产公开 `city=深圳` 为 62 条。全职 100 条，校园招聘 / 实习均为 0；标题含 AI / 人工智能 / 算法 / 机器学习 / 大模型关键词 28 条，标题含“产品”56 条。这里的 28 条是标题关键词口径，预生产公开 API `keyword=AI` 为 32 条是接口关键词检索口径，可能覆盖描述 / 要求等字段。

本次可以证明腾讯真实岗位 Excel 样本在本地环境完成“字段校验 → 预览 → 确认导入 → 审核发布 → 过期岗位下架 → 公开查询 → 质量快照 → 来源链接可达性抽检”链路。但仍不能写作完整商用验收完成，原因：

- 本次只在本地 SQLite 执行，未导入预生产 PostgreSQL，也未跑公网浏览器真实会员链路。
- 腾讯招聘属于第三方公开来源样本；进入预生产或对外展示前，必须确认客户 / 数据源授权，或在前台和验收材料中明确标注为第三方公开来源聚合信息，不得误写成腾讯授权合作数据源。
- 样本中仍有 41 条字段质量为 `partial`，主要是腾讯源表未提供学历要求；可以展示，但岗位 AI 匹配解释会比 `ready` 数据弱。
- Windows 一体机 / Terminal Agent / Pantum 真机链路尚未使用该样本复验。

```text
客户真实岗位样本导入 readiness：已准备静态门禁
腾讯真实岗位样本本地导入链路验证：已执行，通过（99 条公开可见，1 条过期已下架）
客户真实岗位样本验收：Local Gate Passed / Preprod & Kiosk Hardware Pending
不得对外宣称岗位信息 AI 商用完成
```

### 2026-07-01 腾讯真实岗位样本预生产隔离导入 Gate

用户确认后，已把预生产刷新到包含 Excel `workType -> Job.category` 修复的干净候选，并在 PostgreSQL 中使用同一专用机构 / 数据源隔离导入腾讯样本：

- 候选提交：`5ca81d04`，基于 `5d4b46f7` 仅叠加 Excel `workType -> Job.category` 修复范围。
- 预生产 release：`<PREPROD_ROOT>/releases/20260701-162226-5ca81d04`。
- 候选归档：`<PREPROD_ROOT>/artifacts/job-ai-preprod-5ca81d04.tar.gz`，sha256 `e0c38b72db0a37acfe05c6cb57cd168931c3bded3aa85411ac1ebc8cc3b3d77c`。
- 刷新前备份：`<PREPROD_ROOT>/db-backups/pre-tencent-worktype-20260701162717.dump`，已用 `pg_restore -l` 确认可读。
- 预生产健康检查：`success=true` / `db=postgres`。
- 预生产导入结果：`preview totalRows=100 validRows=100 invalidRows=0 dupRows=0`，`confirm imported=100`。
- 公开查询结果：公开可见 99 条，1 条已过期岗位下架；`category=null` 为 0，`category=fulltime` 为 100，公开 `fulltime` 筛选 99 条。
- 公开 API 抽样：sourceOrgId 总数 99、fulltime 总数 99、keyword=AI 总数 32、city=深圳 总数 62。
- 详情抽样：首条岗位返回 `sourceName=腾讯招聘公开来源样本（预生产验证）`、`category=fulltime`、`workType=full_time`、腾讯单岗位详情链接、描述、要求和第三方来源提示。
- 远端临时 Excel 与一次性导入脚本已清理。

本次可以证明腾讯真实岗位样本已经通过预生产 PostgreSQL 隔离导入 Gate，并解决了此前预生产运行包落后导致的 `category=null` 分类筛选风险。但仍不能写作完整商用验收完成，原因：

- 尚未补 Kiosk 公网浏览器截图或一体机触控证据。
- 尚未补 Admin / Partner 质量摘要截图或脱敏 API 摘要。
- 尚未使用真实会员、真实已解析简历、真实 LLM/OCR 跑岗位 AI 推荐 / 解读 / 匹配浏览器 E2E。
- 腾讯招聘仍属于第三方公开来源样本；进入对外展示前，必须确认客户 / 数据源授权，或明确标注为第三方公开来源聚合信息。
- Windows 一体机 / Terminal Agent / Pantum 真机链路尚未使用该样本复验。

```text
腾讯真实岗位样本预生产隔离导入 Gate：已执行，通过
客户真实岗位样本验收：Preproduction Sample Gate Passed / Browser, AI E2E & Kiosk Hardware Pending
不得对外宣称岗位信息 AI 商用完成
```
