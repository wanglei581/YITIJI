# 交底书 P2：多源异构招聘信息的合规化标准接入与审核发布解耦方法

> 建议类型：**发明专利** ｜ 创造性：🟢🟢 中-强
> 技术领域：数据集成、ETL 字段映射、信息发布审核系统

---

## 1. 背景技术与现有问题

聚合第三方岗位/招聘会信息时，来源（招聘平台、人力公司、高校、招聘会主办方、聚合站）与接入方式（API、Excel、Webhook、手工）组合众多，字段格式各异；同时存在合规红线：**只能接入岗位/招聘会公开展示信息，绝不可接收求职者简历等个人敏感信息**。

现有数据集成方案普遍缺乏：① 对"接入方式"与"来源种类"的正交建模；② 在导入链路内**结构性阻断**个人隐私字段；③ 审核与发布两种权限/状态的解耦。

## 2. 发明目的

让不懂技术的合作机构也能自助接入多源异构数据；在导入链路内从结构上杜绝个人简历/候选人数据进入系统，满足"只做信息入口、不做招聘闭环"的合规边界；审核与发布解耦以提升运营灵活性与可追溯性。

## 3. 技术方案（权利要求骨架）

### 独立权利要求（方法）

1. **双维度正交分类**：为每个数据源同时标注**来源种类**（job_platform / hr_company / school / fair_organizer / aggregator / manual）与**接入方式**（api / excel / csv / json / webhook / manual）两个**相互正交**的维度；同一来源种类可经多种接入方式接入。

2. **可复用字段映射规则**：以"外部字段 → 标准字段 + 必填标志 + 默认值 + 变换算子（trim/大小写等）"定义映射规则；映射规则按 (数据源, 数据类型) 维度持久化，下次导入**自动回填**上次映射；空映射不覆盖既有规则。

3. **隐私字段双层阻断（合规核心）**：在导入预览阶段，对**外部原始表头**与**用户选中映射的字段名**两处分别匹配敏感词模式（手机/邮箱/简历/候选人/Offer 等），命中即拒绝整批导入；并且**仅持久化映射后的标准字段，原始行数据置空不落库**，从结构上防止个人敏感信息进入系统与导入历史。

4. **审核与发布状态解耦**：为每条数据维护**两个独立状态**——审核状态（pending / reviewing / approved / rejected）与发布状态（draft / published / unpublished / expired）；并规定：
   - 终态（approved/rejected）不可回退；
   - 驳回必须填写理由；
   - **审核通过后强制将发布状态重置为 draft**，且只有"审核通过"的数据才允许执行发布；
   - 终端仅展示"审核通过且已发布"的数据。

5. **Webhook 安全接入**：接收端以 `HMAC-SHA256(密钥, 时间戳.原始报文字节)` 验签、±5 分钟时间窗校验、以 (数据源ID, nonce) 复合键做防重放，所有失败统一返回同一错误码以防探测；数据源凭证以 **AES-256-GCM**（scrypt 派生密钥 + 认证标签）加密落库，前端只读"是否已配置"布尔值、永不回显明文。

### 从属权利要求方向

- 字段映射运行时引擎支持**多别名解析**（一个标准字段对应多个候选外部字段名 + fallback）与**类型归一**（中文/英文文本变体归一到标准枚举）。
- Excel 确认导入采用**事务化 upsert**，以 (sourceOrgId, externalId) 复合键去重；任一行失败则整批回滚并标记 failed，避免"部分导入"脏状态。
- 同批内重复检测（intra-batch）与库级已存在检测（existing）并行执行。
- 防重放 nonce 缓存以插入有序结构实现 O(过期数) 的定时淘汰，容量上限触发批量驱逐。
- 同步任务队列以 jobId 唯一保证幂等；Redis 不可用时降级为内存进度跟踪（开发模式）。

## 4. 关键创新点

| 创新点 | 与惯例对比 |
|--------|-----------|
| **隐私字段双层 + 结构性阻断**（表头检测 + 映射列检测 + 原始数据不落库） | 通用 ETL 无合规阻断，原始数据通常全量留存 |
| **审核通过即重置为 draft** | 防"绕过发布审核""驳回后旧版本仍在终端展示" |
| **sourceKind ⊥ accessMode 正交建模** | 替代扁平的数据源类型枚举，更灵活 |
| 映射规则 (源,类型) 维度复用回填 | 减少重复手工配置 |

> ⚠️ 撰写提示：HMAC 验签、AES-GCM、nonce 防重放属成熟技术，**不宜单独主张**，应作从属权利要求并入；创造性核心落在"隐私双层阻断 + 审核发布解耦 + 正交分类"。

## 5. 有益效果

合作机构自助接入多源数据；导入链路从结构上杜绝求职者简历/候选人数据进入系统；审核与发布解耦提升运营灵活性与可追溯性，满足合规边界。

## 6. 关键代码位置

| 功能 | 文件 | 行号 |
|------|------|------|
| SourceKind / AccessMode 定义 | `packages/shared/src/types/job.ts` | 63-80 |
| FieldMappingRule / ImportBatch / ImportRecord 类型 | `packages/shared/src/types/job.ts` | 185-231 |
| ReviewStatus / PublishStatus 定义 | `packages/shared/src/types/job.ts` | 2-9 |
| 敏感列双层检测 | `services/api/src/jobs/dto/excel-import.dto.ts` | 9-22 |
| Excel 预览 + ImportBatch 创建（原始数据置空） | `services/api/src/jobs/jobs.service.ts` | 1367-1546 |
| Excel 确认导入 + 映射规则保存 | `services/api/src/jobs/jobs.service.ts` | 1552-1693 |
| 审核状态机 | `services/api/src/jobs/jobs.service.ts` | 704-757 |
| 发布状态机（publish 需 approved） | `services/api/src/jobs/jobs.service.ts` | 759-789 |
| 终端可见性约束（approved+published） | `services/api/src/jobs/jobs.service.ts` | 508-536 |
| Webhook 验签 | `services/api/src/sync/sync.service.ts` | 1-139 |
| nonce 防重放 | `services/api/src/sync/replay-guard.ts` | 全文 |
| AES-256-GCM 凭证加密 | `services/api/src/common/crypto/secret-cipher.ts` | 全文 |
| 字段映射运行时引擎（多别名+归一） | `services/api/src/job-sync/job-sync.service.ts` | 47-71 |

## 7. 附图建议

- 图1：数据源双维度分类矩阵（sourceKind × accessMode）。
- 图2：导入链路流程图（上传→表头检测→字段映射→隐私列检测→预览/校验→事务 upsert→映射规则回填）。
- 图3：审核状态机与发布状态机的解耦双状态图。
- 图4：Webhook 验签时序图（时间窗→HMAC→nonce 防重放→统一拒绝）。

## 8. 检索关键词

字段映射 field mapping / 数据源接入 / 审核发布解耦 review publish state machine / 敏感字段过滤 / webhook 防重放 nonce replay / ETL 标准化。
