# 岗位信息 AI 真实验收证据包

> STATIC DOC CHECK ONLY
> 状态：验收标准与执行模板已定义，真实客户样本、预生产公网浏览器和一体机真机尚未执行。
> 本证据包就绪不等于岗位信息 AI 生产商用完成。

## 一、验收边界

本文件只定义岗位信息 AI 商用闭环进入真实验收时的证据要求、停止条件和脱敏规则。实际截图、数据库查询结果、命令日志、COS 对象摘要、LLM 返回摘要和真机照片必须保存在仓库外私有证据目录，证据不进 Git。

当前状态：

- [ ] PENDING REAL-EVIDENCE：客户真实岗位样本验收未执行。
- [ ] PENDING REAL-EVIDENCE：预生产公网浏览器验收未执行。
- [ ] PENDING REAL-EVIDENCE：一体机真机验收未执行。

允许证明的能力：

- 第三方 / 官方岗位来源信息展示。
- 求职者本人基于真实简历、真实岗位和真实 LLM 的 AI 推荐、岗位解读、岗位匹配参考。
- 岗位浏览记录写入 BrowseLog，来源平台二维码 / 外链打开动作写入 ExternalJumpLog，只记录 external_apply 打开动作。
- 求职材料或岗位相关 PDF 生成后进入 FileObject、PrintTask 和一体机打印准备链路。

禁止证明或暗示的能力：

- 一键投递。
- 立即投递。
- 平台投递。
- 候选人筛选。
- 面试邀约。
- Offer 管理。
- 向企业推荐候选人。
- 不记录投递结果，不记录第三方平台办理结果，不追踪第三方后续状态。

所有推荐结果仅供参考，不得输出百分比、通过承诺或录用承诺。

## 二、客户真实岗位样本 Gate

目标：证明客户真实 API / Excel / Webhook 岗位样本进入系统后，可以被后台、合作机构后台和 Kiosk 用同一套真实数据展示，不使用 mock、不生成虚假岗位。

### 2.1 样本准入

客户样本最小要求：

| 字段 | 要求 |
| --- | --- |
| `sourceOrgId` | 必须来自真实合作机构，不得使用本地 mock org |
| `externalId` | 必须是客户源系统真实外部编号 |
| `sourceName` | 必须显示第三方 / 官方来源名称 |
| `sourceUrl` | 必须是 http / https 来源链接或二维码目标 |
| `title` | 岗位名称必填 |
| `company` | 招聘单位名称必填 |
| `city` | 工作城市必填 |
| `description` 或 `requirements` | 至少一项真实提供 |
| `syncTime` | 必须记录真实同步时间 |

导入方式必须至少覆盖一种真实路径：

- Excel：使用客户真实 Excel 模板或客户导出的脱敏样本，列白名单必须覆盖学历、经验、技能、福利、薪资上下限、薪资单位、有效期。
- API：必须使用合作机构账号或服务凭证，岗位归属必须落在该机构的 `sourceOrgId` 下。
- Webhook：必须验证 HMAC、时间窗和 nonce 防重放，不得接受无签名请求。

### 2.2 数据质量证据

必须生成或核对：

- `JobDataQualitySnapshot` 已为本轮岗位样本刷新。
- Admin 岗位来源质量摘要显示总岗位数、AI 可读就绪率、字段缺失、来源链接异常、同步陈旧。
- Partner 只能看到本机构岗位质量摘要，不能看到其他机构数据。
- Kiosk `/jobs` 和 `/jobs/:id` 只展示已审核已发布岗位；缺失字段展示“来源平台未提供”，不得补造字段。

### 2.3 数据库抽样模板

实际执行时只保存脱敏摘要，不保存完整岗位描述、完整来源 URL、真实客户密钥或完整 object key。

```sql
select id, "sourceOrgId", "externalId", "sourceName",
       case when "sourceUrl" is null then 'missing' else 'present' end as source_url_state,
       title, company, city, "reviewStatus", "publishStatus", "syncTime"
from "Job"
where "sourceOrgId" = 'ORG_ALIAS'
order by "createdAt" desc
limit 50;

select "sourceOrgId", "qualityLevel", count(*) as count
from "JobDataQualitySnapshot"
where "sourceOrgId" = 'ORG_ALIAS'
group by "sourceOrgId", "qualityLevel";
```

## 三、预生产公网浏览器 Gate

目标：证明公网预生产环境使用 PostgreSQL、Redis、COS、真实 LLM、百度 OCR 和真实会员会话完成用户侧岗位 AI 闭环。

### 3.1 执行前环境快照

必须只读记录：

- `DATABASE_URL` 指向 PostgreSQL，只记录 host 指纹和 `db=postgres` health。
- `REDIS_URL` 已设置，只记录 set / unset。
- `FILE_STORAGE_DRIVER=cos`，COS bucket 只记录用途、region 和脱敏指纹。
- 真实 LLM 已通过 `verify:llm-connectivity -- --all`，只记录 feature、vendor、model，不记录 apiKey、prompt 或响应正文。
- 百度 OCR live 验证已通过，或本轮明确标记 OCR 未参与岗位 AI 浏览器验收。
- Kiosk 生产包使用 `VITE_API_MODE=http`，不得使用 mock adapter。

### 3.2 会话来源

浏览器验收必须选择一种方式，并在 `job-info-ai-preprod-execution-record.md` 中记录方式编号：

- `SESSION-A_REAL_SMS`：真实短信审核通过后，使用受控手机号接收验证码。
- `SESSION-B_REDIS_TEST_CODE`：用户明确授权后，由运维向预生产 Redis 写一次性测试验证码；该方式不代表真实短信链路通过。
- `SESSION-C_CONTROLLED_SESSION`：使用受控测试账号的有效浏览器会话；不得复制或记录 cookie、JWT、token。

### 3.3 浏览器流程

必须覆盖：

1. 会员登录后进入 `/jobs`。
2. 打开 AI 推荐入口，确认 `job_ai` 授权。
3. 选择本人真实已解析简历，调用岗位 AI 推荐。
4. 推荐列表只展示三档参考等级、理由、准备动作和免责声明。
5. 打开一个真实岗位详情，执行 AI 岗位解读。
6. 对同一岗位执行岗位匹配参考。
7. 点击来源平台二维码 / 外链入口，生成 `ExternalJumpLog(action=external_apply)`；只记录 external_apply 打开动作，不记录投递结果。
8. 在 `/me/ai-records` 查看 JobAiSession 元数据。
9. 在 `/me/settings` 撤回 `job_ai` 授权。
10. 抽样确认本人 `JobAiSession` / `JobAiRecommendation` 按现有删除 / 撤权策略处理，`AiServiceLog` 仅含元数据。

### 3.4 证据脱敏

必须脱敏：

- 手机号脱敏：只保留前 3 后 2。
- token 脱敏：不得保存验证码、cookie、JWT、localStorage 内容、access token。
- 签名 URL 脱敏：只保存 host、path hash、TTL，删除 query。
- 简历正文不进入截图、日志、SQL 摘要或审查记录。
- LLM prompt、模型原始输出、完整岗位描述不进入仓库。

## 四、一体机真机 Gate

目标：证明 27 寸竖屏触控、一体机网络、Windows Terminal Agent、Pantum 打印机和岗位 AI 相关打印准备链路可以真实运行。

### 4.1 设备前置

必须记录：

- Windows 版本。
- Kiosk 浏览器版本和竖屏分辨率。
- Windows Terminal Agent 版本。
- Agent `terminalId`。
- Pantum 打印机 Windows 真实识别名。
- 设备摆放机构和网络环境。

### 4.2 真机流程

必须覆盖：

1. 27 寸竖屏触控打开 `/jobs`，搜索和筛选可用，文字不重叠。
2. 打开 AI 推荐、AI 解读、岗位匹配参考，触控按钮可操作，忙碌状态不重复提交。
3. 来源二维码展示清晰；扫码或打开来源入口不阻断页面。
4. 从岗位 AI 结果进入求职材料或简历优化，再进入打印确认。
5. 生成真实 FileObject 和 PrintTask。
6. Windows Terminal Agent 只 claim 本机 `terminalId` 的任务。
7. Pantum 真实出纸，记录纸张、单双面、彩色 / 黑白实际模式；不得硬编码彩色 mode。
8. 打印完成、失败、断网恢复和 Agent degraded 状态在 Admin / Kiosk 可见。
9. 打印后本地缓存按 TTL 清理，不能保留可打开的用户文件。

## 五、证据编号

| 证据 ID | 类型 | 内容 |
| --- | --- | --- |
| JAI-G0 | 本地静态门禁 | `verify:job-info-ai-real-acceptance` 输出 |
| JAI-G1 | 客户样本摘要 | 导入方式、岗位数量、字段完整度、质量快照摘要 |
| JAI-G2 | 预生产命令日志 | production gates、LLM、OCR、Job AI verify |
| JAI-G3 | 预生产浏览器证据 | 登录、授权、推荐、解读、匹配、外链打开、撤权 |
| JAI-H1 | 真机环境记录 | Windows、Agent、terminalId、Pantum 识别名 |
| JAI-H2 | 真机触控截图 | `/jobs`、`/jobs/:id`、AI 结果、来源二维码 |
| JAI-H3 | 真机打印证据 | PrintTask、Agent claim、真实出纸、状态回传 |

## 六、停止条件

出现任一情况必须停止验收，不得继续扩大：

- Kiosk、Admin、Partner 或 AI 输出出现禁止链路文案。
- AI 输出出现百分比化推荐、通过承诺或录用承诺。
- Partner 能看到用户简历、用户手机号、个人 AI 明细或其他机构岗位质量摘要。
- 会员 B 能读取、删除或恢复会员 A 的 JobAiSession。
- `AiServiceLog`、`AuditLog`、浏览器日志或截图出现简历正文、prompt、模型原始输出、完整签名 URL、cookie、JWT 或密钥。
- 预生产环境使用 mock adapter、mock AI、disabled OCR 或 local file storage 冒充真实能力。
- 来源链接打开记录写入第三方办理结果。
- Windows Terminal Agent 能 claim 不属于本机 `terminalId` 的 PrintTask。
- Pantum 真机未出纸但任务被标记 completed。
- 打印缓存 TTL 后仍可在本地磁盘打开用户文件。

## 七、结论模板

```text
岗位信息 AI 真实验收：未执行 / 已执行未通过 / 已执行待复验 / 已执行通过
执行环境：本地 / 预生产 / 一体机现场
部署 commit：
客户样本来源：
证据目录：
通过 Gate：
未通过 Gate：
停止条件是否触发：
残余风险：
结论：不得在客户样本、预生产浏览器和一体机真机三项均通过前宣称生产商用完成。
```
