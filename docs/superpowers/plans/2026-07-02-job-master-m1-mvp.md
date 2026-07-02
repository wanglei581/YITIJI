# 岗位大师 M1 MVP —— 任务开卡(执行契约)

> 开卡日期:2026-07-02
> 分支:`feature/job-master`(从干净 `main` @ `eba2dd0f` 新建;独立窗口推进,禁止混入 toolbox 或其他任务)
> 设计依据:[docs/superpowers/specs/2026-07-02-job-master-design.md](../specs/2026-07-02-job-master-design.md)
> 约束依据:CLAUDE.md §8.1 / §14、docs/product/feature-scope.md、docs/compliance/compliance-boundary.md
> 前置纪律:开发前重读上述三份文档;每个 30 行以上 diff 走 Claude + Antigravity 双模型审查(设计文档 §九-5)。

---

## 1. 本任务对应的真实功能闭环 / 上线阻塞

点亮 Kiosk 首页「岗位大师」禁用占位磁贴,交付一条**可用可打印**的最小决策闭环:

```
选岗(站内单岗 或 手填) → 单次 LLM 分析(适配度双栏 + 晋升路径三节点 + 基础风险)
 → 竖屏四段结果卡 → 生成《岗位决策参考报告》PDF
 → 我的文档 + 打印订单 + 「我的」AI服务记录(kind=job_master)
```

- **不是上线阻塞项**;设计文档 §九-1 明确「上线收口完成后启动」。本卡为并行隔离预备,执行时机以用户确认为准。
- M1 薪资**只展示来源方区间**(站内统计区间留 M2);多岗对比留 M2;岗位详情页入口改线留 M2。

## 2. 允许修改 / 新增文件;禁止修改文件

### 允许新增(API)
- `services/api/src/ai/job-master.controller.ts` —— `POST /api/v1/resume/job-master`、`GET .../{taskId}`、`POST .../{taskId}/print`(限流对齐 job-fit 6 次/分钟)
- `services/api/src/ai/resume/job-master.service.ts` —— 编排:简历重提 → LLM 分析 → 持久化 → 审计
- `services/api/src/ai/resume/llm-job-master.service.ts` —— 单次结构化 LLM 调用(prompt 复用 job-fit/career-plan 防护栏)
- `services/api/src/ai/resume/job-master-pdf.service.ts` —— 参照 `career-plan-pdf.service.ts`(中文字体自适应)
- `services/api/scripts/verify-job-master.ts` + `package.json` 加 `verify:job-master`(mock 链路 + 禁词/合规断言)

### 允许新增(Kiosk)
- `apps/kiosk/src/pages/resume/JobMasterPage.tsx`(或 `pages/jobs/JobMasterPage.tsx`,择一;复用 `JobFitPage` 选岗交互 + `CareerPlanPage` 报告版式)
- `apps/kiosk/src/services/api/jobMaster.ts`(参照 `services/api/jobFit.ts`)

### 允许改动(点接线,最小 diff)
- `apps/kiosk/src/routes/index.tsx` —— 新增 `/jobs/master` 路由(紧邻现有 75-76 行 job-fit/career-plan)
- `apps/kiosk/src/pages/home/HomePage.tsx:316` —— 岗位大师磁贴 `disabled: true` → 可点击并路由到 `/jobs/master`
- `services/api/src/ai/ai.module.ts`(或对应 module)—— 注册新 controller/service
- `services/api/src/member-assets/member-assets.service.ts:124` —— kind 白名单加入 `job_master`,使其进入「我的」AI服务记录
- `packages/shared` —— 如需新增 `JobMaster*` 响应类型(禁止把 apiSecret/凭证等敏感字段写进共享类型)
- Prisma schema —— **仅当** `AiResumeResult.kind` 是枚举而非自由字符串时才需加 `job_master`;若为字符串则无需迁移(执行前先确认,能不迁移就不迁移)

### 禁止修改
- toolbox / TAS-G3/G4 相关任何文件;其他 feature 分支的在途改动。
- 现有 `job-fit` / `career-plan` 的 controller/service/page 语义(可复用其代码作参照,但 M1 不改其行为;入口改线是 M2)。
- 合规文案白名单、job-fit 现有禁词/防编造过滤(只复用,不放松)。
- 生产配置、密钥、数据库连接、Windows Agent / 硬件链路。

## 3. 新增入口 / 页面 / 数据模型 / 服务 / 外部依赖 —— 理由

| 新增 | 理由 |
|---|---|
| 首页磁贴点亮 + `/jobs/master` 页 | 设计定稿的独立功能,占位磁贴本就是为它预留;非同义入口(job-fit 是 AI 简历服务内能力,岗位大师是岗位组决策台) |
| `job-master.*` 后端一组 | job-fit/career-plan 输出结构不同(四段合一 + 报告 PDF),无法直接复用其 service;按 job-fit 八步接入法新建 |
| `AiResumeResult(kind='job_master')` | 复用现有表与 24h TTL 机制,不新建表;payloadJson 不含简历原文/PII |
| 外部依赖 | **不新增**。LLM 走现有 `AI_PROVIDER` 架构(mock + 真实双实现);PDF 走现有渲染栈 |

## 4. 触碰面清单

- ☑ 简历:凭 fileId 重提原文做分析,**不落库、不写日志原文**(复用 `resume-extraction.service.ts`)
- ☑ 岗位数据:**只读** 站内 `approved+published` Job 记录(requirements/skills/salary 等)做上下文;不写岗位、不建投递语义
- ☑ 文件 / 打印:生成报告 PDF → `FileObject(purpose='job_master_report')` → `/me/documents` → `PrintTask`
- ☑ AI 记录:写 `AiResumeResult(kind='job_master')`
- ☐ 不碰:生产配置 / 数据库连接串 / 密钥 / 招聘会 / 合作机构 / 硬件链路 / Terminal Agent

## 5. 合规红线(M1 必须内建,来自设计文档 §二)

- 适配度只用三档参考等级(`reference_high/medium/low`)+ 可解释命中项;**禁止**百分比 / 录用概率 / 通过率 / 「精准命中」。
- 薪资 M1 只展示「来源方提供区间」,缺失显示「来源平台未提供」;禁止自建预测模型。
- 风险只用定性三档 + 依据;禁止「自动化替代概率 N%」类强预测数字。
- 行动按钮仅限白名单:查看岗位 / 去来源平台投递 / 扫码投递 / 打印报告 / 去优化简历。
- 报告页脚固定免责声明(数据来源 + 生成时间 + 「仅供求职参考,不构成录用或薪酬承诺」)。
- LLM evidence 必须源自简历原文,不编造经历;mock 模式 **fail-closed**,不产生假结果。

## 6. 验证清单(交付前必须通过)

- [ ] API `pnpm --filter api typecheck` + `lint` + `build`
- [ ] Kiosk `pnpm --filter kiosk typecheck` + `lint` + `build`
- [ ] 新增 `verify:job-master`(mock 链路端到端 + 禁词/合规断言)本地通过,并接入主 CI 与 postgres-readiness 两条 job
- [ ] `verify:llm-connectivity` 扩展覆盖 job_master 真实 LLM 联调(有真实 key 时)
- [ ] 1080×1920 竖屏浏览器走查:选岗 → 分析 → 四段结果 → 打印确认全链路(preview_* 工具)
- [ ] 按钮文案合规扫描(无「一键投递/立即投递/平台投递」等越界词)
- [ ] 报告 PDF 中文字体在三平台正常(至少本机 + CI 验证渲染不乱码)
- [ ] mock 模式 fail-closed 验证:LLM 失败不产出假结果、不写记录

## 7. 需同步的文档

- `docs/progress/current-progress.md` —— M1 完成后记录(功能、验证结果、kind 新增)
- `docs/progress/next-tasks.md` —— 更新 M2/M3 待办
- `docs/product/user-data-flow-matrix.md` —— 登记「岗位大师」入口 ↔ 我的记录归属,确认无同义入口堆叠
- `docs/product/feature-scope.md` —— 如涉及功能范围表述则同步
- 合规边界文档无需改(M1 在现有红线内);如对外宣传「AI 岗位分析」,先与法务确认生成式 AI 备案范围(设计文档 §二末条)

## 8. 执行顺序建议(M1 内部里程碑)

1. 后端契约先行:`packages/shared` 类型 + controller 骨架 + mock provider 输出 → `verify:job-master` 立起来(TDD:先让 verify 红,再实现绿)。
2. LLM 真实实现 + 防护栏复用 + 持久化 + 审计。
3. PDF service(参照 career-plan-pdf)+ 文件/打印/记录闭环。
4. Kiosk 页面(选岗 → 进度 → 四段结果 → 打印确认)+ 磁贴点亮 + 路由。
5. 全量验证清单 → 双模型审查 → 文档同步。
