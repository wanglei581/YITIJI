# 首页功能入口与「我的」数据闭环矩阵

> 最后更新：2026-07-02（对齐实现：修正 `/me/resumes` 已上线、打印订单详情快速关联反馈已接线等此前仍标「待恢复/未接线」但代码已落地的条目）
> 关联文档：[feature-scope.md](./feature-scope.md) | [compliance-boundary.md](../compliance/compliance-boundary.md) | [current-progress.md](../progress/current-progress.md) | [next-tasks.md](../progress/next-tasks.md)

---

## ⚠️ 信息架构整改（2026-06-14，用户确认，优先级高于下文「我的＝资产中心」旧表述）

Kiosk「我的」页**不再**承载独立的「账号资产 / 资产中心」明细聚合区（`AccountAssetsPanel` 已从 [ProfilePage.tsx](../../apps/kiosk/src/pages/profile/ProfilePage.tsx) 移除，旧 Profile 聚合明细组组件已删除）。「我的」页只做个人中心**入口与概览**（顶部 AI记录 / 收藏 / 文档数量概览 + 分区入口 + 本次会话记录），各类**明细归位到对应业务页面**：

- 简历 / AI 简历记录 → 简历服务相关页面
- 文档 / 打印订单 → 打印扫描相关页面
- 收藏 / 浏览 / 外部跳转记录 → 岗位、招聘会、政策等对应页面
- 权益 / 套餐 → 权益活动 / 服务套餐页面
- 智慧校园相关个人记录 → 智慧校园自身业务页或对应服务页，不塞回「我的」

**硬约束：** 不在 ProfilePage 重新渲染 `AccountAssetsPanel`；不新增「账号资产」「资产中心」这类重复聚合入口。

> 因此：下文 §一闭环、§三各表「『我的』归属」列、§四分组表中出现的「『我的』」，自本整改起一律理解为**「数据所属分类 + 对应业务页面承载位置」**，而非「在『我的』页聚合展示明细」。闭环要求（可查看 / 继续使用 / 打印 / 删除 / 复用）本身不变，仅承载位置从「我的」聚合区改为对应业务页面。整改记录见 [current-progress.md](../progress/current-progress.md)（2026-06-14 Codex 条目）。

---

## 一、总原则

当前首页与各业务板块的功能入口已经定版。后续开发不再新增重复入口，不新增同义卡片，不因为阶段任务再加一个新功能块。

每个已有入口必须形成完整操作闭环：

```text
首页/板块入口 → 业务操作 → 产生用户数据 → 沉淀到对应业务页面的记录/资产分组（不在「我的」页聚合明细）→ 可查看、继续使用、打印、删除或复用
```

每次开发前必须回答四个问题：

1. 用户从哪个已有入口进入？
2. 用户在该页面完成什么操作？
3. 系统产生什么用户数据？
4. 用户以后在**对应业务页面**（而非「我的」聚合区）哪里找到，并能做什么后续操作？

如果功能完成后结果无处承接，这是半闭环；如果对应业务页面里有记录但不能继续操作，也是不完整闭环。

---

## 二、入口稳定规则

后续开发必须遵守：

- 不新增重复卡片。
- 不新增同义入口。
- 不新增一层菜单来承接同一能力。
- 优先复用当前路由、当前卡片、当前资产分组。
- 可以把 `即将上线` 的已有入口真实化。
- 可以从结果页提供 CTA 串联下一步，但这不等于新增首页入口。

示例：

| 已有入口 | 正确做法 | 禁止做法 |
|---|---|---|
| 职业规划 | 将现有「职业规划」卡片接到真实职业规划页 | 新增「职业规划建议」卡片 |
| 模拟面试 | 完善现有「模拟面试 / 面试技巧 / 面试报告」 | 新增「AI 面试训练」重复入口 |
| 岗位大师 / 岗位匹配 | 接到岗位匹配参考或作为既有入口真实化 | 新增「目标岗位分析」同义入口 |
| AI简历优化 | 完善现有优化链路 | 新增「AI改简历」入口 |
| 打印扫描 | 完善上传/扫码/U盘/扫描/打印闭环 | 新增另一个打印入口 |

---

## 三、首页入口 ↔ 数据归属矩阵

### 3.1 AI 简历服务

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| AI简历诊断 | `/resume/source?intent=diagnose` → `/resume/parse` → `/resume/report` | `AiResumeResult(kind=parse)`、关联简历文件 | 我的简历、AI服务记录 | ✅ 已打通（2026-06-21：Kiosk `/me/resumes` 页面已上线，复用 `getMyResumes`；Profile「我的简历」入口指向 `/me/resumes`；本人报告可凭 `taskId`+会员 token 回看） | 保持报告可追溯、可删除；导出报告须真实 FileObject 后再开放 |
| AI简历优化 | `/resume/source?intent=optimize` → `/resume/optimize` | `AiResumeResult(kind=optimize)`、优化版简历/PDF FileObject | 我的简历、我的文档、AI服务记录、打印订单 | ✅ 已打通：kind=optimize 进 AI记录，导出 PDF 进我的文档；Kiosk「我的简历」独立页 `/me/resumes` 已上线（2026-06-21）；文件留存按当前保存期限策略执行：未登录/系统短期，登录会员默认 90 天，优化后成果物可按规则长期保存 | `/me/resumes` 只展示安全元数据和下一步动作；保持事实校验、防编造、PDF/打印链路 |
| 岗位匹配（2D，经诊断报告 CTA，无独立首页入口） | `/resume/report` →「目标岗位匹配参考」→ `/resume/job-fit` | `AiResumeResult(kind=job_fit)` | AI服务记录（标签「岗位匹配参考」） | ✅ 已打通（核查 2026-06-12：kind=job_fit 落库继承归属，AI记录可见；结果页 CTA 衔接 2B 优化与去来源平台） | 「岗位大师」首页占位点亮时复用本链路 |
| 简历素材库 | `/resume/templates`（2026-06-30 已从求职材料库拆分为独立页面；旧 `/resume/templates?tab=materials` 兼容跳转到 `/resume/materials`） | 内置简历模板/版式素材浏览记录；简历模板类只引导到 AI 简历优化，不就地生成假简历 | 我的简历、AI 简历优化链路；如后续生成正式简历 PDF，再进入我的文档、打印订单 | ✅ 代码侧已拆分：页面标题、路由、数据筛选与求职材料库分离；不再显示求职信表单或 `generateJobMaterial` 生成入口 | 后续动态模板管理需单独审核 / 版权 / 字段白名单设计；不得做平台投递、企业收简历或伪造简历生成结果；新版独立页仍需预生产 / 真机浏览器复验 |
| 职业规划 | ✅ `/resume/career-plan`（首页磁贴已点亮，2026-06-12） | `AiResumeResult(kind=career_plan)`、建议单 PDF FileObject、PrintTask | AI服务记录（标签「职业规划」，可删除）、我的文档、打印订单 | ✅ 已打通（无简历引导上传/自动聚合本人岗位匹配+面试摘要且依据如实展示/防编造现状画像/打印建议单进打印链路/CTA 串联优化·匹配·面试） | 保持回归 |
| 简历打印 | `/print/upload` | FileObject、PrintTask | 我的文档、打印订单 | 已有打印主链路 | 继续完善打印状态实时追踪 |
| 求职材料 | `/resume/materials`（2026-06-30 已从简历素材库拆分为独立页面） | 求职信 / 感谢信 / 作品集封面 / 材料清单 PDF FileObject、打印任务 | 我的文档、打印订单；Admin 仅看聚合统计 | ✅ 生成闭环保留：会员结构化表单生成真实 PDF，后端落 `FileObject(purpose=cover_letter, assetCategory=derived)`，我的文档可重签 URL 后进入打印确认；2026-06-29 预生产验收使用的是拆分前旧路径 `/resume/templates?tab=materials`，新版 `/resume/materials` 仍需重新远端验收 | Windows 真机打印仍需验收；正式域名 HTTPS / 真实短信上线 E2E、二期动态模板、Partner 上传、套餐收费另起分支 |

### 3.2 岗位信息

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 全职岗位 | `/jobs?category=fulltime` | 浏览记录、收藏、外部跳转记录 | 我的收藏、浏览与跳转记录 | ✅ 已打通（2026-06-12：`BrowseLog(targetType=job)` + `ExternalJumpLog(action=external_apply)`；详情加载后记录浏览，打开「去来源平台投递 / 扫码投递」入口时记录外部跳转） | 保持来源平台边界；不记录投递结果 |
| 实习岗位 | `/jobs?category=intern` | 浏览记录、收藏、外部跳转记录 | 我的收藏、浏览与跳转记录 | ✅ 同上 | 同上 |
| 兼职信息 | `/jobs?category=parttime` | 浏览记录、收藏、外部跳转记录 | 我的收藏、浏览与跳转记录 | ✅ 同上 | 同上 |
| 全部岗位 | `/jobs` | 浏览记录、收藏、外部跳转记录 | 我的收藏、浏览与跳转记录 | ✅ 同上 | 同上 |
| 岗位大师 | 当前首页已有，占位 | 岗位匹配参考、定向优化建议 | AI服务记录、收藏岗位关联 | 2D 能力已完成，但首页该入口未接线 | 后续如点亮，应复用 2D 岗位匹配参考，不新增同义入口 |
| 找企业 / 企业展示（岗位信息页内入口，非新增首页卡片） | `/jobs` 页内入口 → `/companies` → `/companies/:id` | 企业浏览记录、企业来源页跳转记录、经企业进入岗位的浏览/投递入口记录 | 我的·浏览与跳转记录（企业 Tab） | ✅ 已打通（2026-06-12：CompanyProfile 真实数据底座；列表/统计/筛选全真实聚合；详情指标受 Admin 开关控制；岗位联动既有 /jobs/:id 与来源投递链路） | 定位「来源企业导览」非招聘平台；不收简历、无平台内投递（长期红线见 compliance §4.5） |

合规口径：岗位链路只能是「查看 → 收藏 → 匹配参考 → 去来源平台投递/扫码投递」，不得出现平台内投递或投递结果记录。

### 3.3 招聘会

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 社会招聘会 | `/job-fairs` | 浏览记录、收藏、外部预约入口打开记录、资料打印任务 | 我的收藏、浏览与跳转记录、我的文档、打印订单 | ✅ 已打通（2026-06-12：详情加载后记录 `BrowseLog(targetType=job_fair)`；列表/详情打开「扫码预约」入口时记录 `ExternalJumpLog(action=external_appointment)`；资料打印仍进我的文档+打印订单） | 预约只引导来源平台，不记录预约结果 |
| 校园招聘会 | `/campus` | 浏览记录、外部预约入口打开记录、资料打印任务 | 我的收藏、浏览与跳转记录、我的文档、打印订单 | ✅ 部分打通（2026-06-12：校园专区主体招聘会浏览与预约入口打开记录已接真；企业查看不单独建模） | 校园页继续保持第三方/官方来源入口定位 |
| 扫码签到 | `/job-fairs/checkin`；详情页有条件展示 | `ExternalJumpLog(action=external_checkin_open)`；来源 URL 快照取 `JobFair.checkinUrl` | 外部跳转记录 | ✅ 已打通（2026-06-30：仅展示已审核发布招聘会的来源平台/官方签到二维码；Partner 可录入 `checkinUrl`，Admin 审核详情可见；本系统只记录打开来源入口） | 不记录签到结果、入场状态、报名信息或平台内凭证 |

### 3.4 打印扫描

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 文档打印 | `/print/upload` | FileObject、PrintTask | 我的文档、打印订单 | 已有主链路 | 打印状态实时追踪 UI 待完善 |
| 证件复印 | 当前首页已有，占位 | PrintTask、复印服务记录 | 打印订单 | 未打通 | 依赖 Terminal Agent/设备能力，不能伪造 |
| 纸质扫描 | `/scan/start` | 扫描 PDF/图片 FileObject | 我的文档 | ❌ 未打通（核查 2026-06-12：整条链路为前端流程演示——定时器+假文件元数据，页面已诚实标注；不产生真实 FileObject） | 真实扫描依赖 Terminal Agent 扫描扩展与真机验收，打通前扫描结果不得进「我的」 |
| 云打印 | 当前首页已有，占位 | FileObject、PrintTask | 我的文档、打印订单 | 未打通 | 云端任务队列 → Windows Agent claim，本机驱动打印 |
| 格式转换 | 当前首页已有，占位 | 转换后 FileObject | 我的文档 | 未打通 | 只做文件服务，不生成假文件 |
| 证件照打印 | 当前首页已有，占位 | 证件照 FileObject、PrintTask | 我的文档、打印订单 | 未打通 | 涉及图像处理/隐私，需单独安全设计 |

### 3.5 AI 面试训练

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 模拟面试 | `/interview/setup` → `/interview/session` → `/interview/report` | MockInterviewSession/Turn/Report、PDF PrintTask | AI服务记录、面试报告、打印订单 | ✅ 已打通（2026-06-12 闭环补丁：「我的」AI服务记录组并列展示模拟面试报告条目（元数据+查看+删除），与 `/interview/reports` 双向互链） | 保持回归 |
| 面试技巧 | `/interview/tips` | 勾选/学习记录（可选） | AI服务记录或本地学习记录 | 页面已可用 | 若无真实记录，不展示假学习进度 |
| 面试报告 | `/interview/reports` | 面试报告历史 | AI服务记录/面试报告 | ✅ 历史页可用（会员真实列表+两步删除+TTL 说明；游客诚实空态） | 与「我的」互链统一（同上 P0-闭环项） |

### 3.6 政策服务

| 已有入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 就业政策 | `/renshi?tab=policy` | 浏览记录、收藏政策、官方入口打开记录、材料打印任务 | 我的收藏、浏览与跳转记录、我的文档、打印订单 | ✅ 部分打通（2026-06-12：政策详情展开记录 `BrowseLog(targetType=policy)`；打开官方入口记录 `ExternalJumpLog(action=external_open)`；政策收藏 ✅；政策材料打印仍未实现，政策页无真实打印能力，「参保证明打印」等为 info 卡） | 政策材料打印待真实材料源 |
| 补贴指引 | `/renshi?tab=social` | 浏览记录、材料清单打印任务 | 我的文档、打印订单 | 部分打通 | 只做 info-only，不承诺到账/代办 |
| 档案/登记 | `/renshi?tab=register` | 浏览记录、材料清单打印任务 | 我的文档、打印订单 | 部分打通 | 只做说明与官方入口 |

### 3.7 AI 助手

| 入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| AI助手 | `/assistant` | AssistantConversation、功能跳转日志、政策问答记录 | AI服务记录、最近操作 | ❌ 未打通（核查 2026-06-12：会话不落库——schema 无 AssistantConversation 模型，对话仅会话内存；「我的」无问答记录） | 会话落库涉及隐私设计（TTL/脱敏），列 P2；当前如实不展示假记录 |

### 3.8 设备状态

| 入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 设备状态展示 | 首页状态区/设备状态区 | TerminalStatus、PrinterStatus；打印失败时关联 PrintTask | 打印订单、异常反馈记录 | ✅ 已打通（打印失败状态在「我的打印订单」可见 ✅；通用意见反馈 `FeedbackTicket` 已实现 ✅；2026-06-21：打印订单详情已接线快速关联反馈，`MyPrintOrdersPage` 携带 `relatedPrintTaskId` 直达 `/me/feedback`，提交时归属校验 ✅） | 保持回归；后续补打印状态实时追踪 UI |

### 3.9 「我的」账户与服务入口（P0a/P0b/P1 + 权益活动 P2 真实化，2026-06-19）

> 「我的」页「账户与服务 / 权益活动与服务套餐」分组入口的真实化状态。P0a 做低风险前端真实化与既有页面跳转；P0b 复用现有 `BenefitGrant` 底座打通「我的权益」只读页与 Admin 手动发放/撤销；P1 新增消息通知与意见反馈域；P2 在同一权益底座上打通权益活动领取闭环。仍不引入支付、套餐购买、招聘会扫码凭证、活动核销、现场签到或 Partner 自助配置。

| 入口 | 当前路由/状态 | 产生数据 | 「我的」归属 | 已打通状态 | 缺口/下一步 |
|---|---|---|---|---|---|
| 政策补贴指引 | `/renshi?tab=policy`（原建设中，2026-06-18 接既有政策页） | 浏览记录、收藏政策、官方入口打开记录、材料打印任务（复用政策页既有链路） | 我的收藏、浏览与跳转记录、我的文档、打印订单 | ✅ 跳转已打通（info-only：政策说明 / 材料清单 / 官方入口，不代办、不承诺到账） | 与 §3.6 就业政策同口径，政策材料真实打印待真实材料源 |
| 帮助中心 | `/help`（原建设中，2026-06-18 新增静态页） | 无（纯信息页，可点击跳转既有功能页） | — | ✅ 已打通（静态 FAQ，仅覆盖已上线能力；无后端、无数据沉淀） | 能力扩展时同步补充 FAQ；不承诺未实现功能 |
| 账号设置 | `/me/settings`（原建设中，2026-06-18 新增轻量版） | 无（只读账号状态 + 协议入口 + 退出/切换账号） | — | ✅ 已打通（展示脱敏手机号 / 登录态 / 公共终端会话说明 / 协议·隐私入口 / 退出登录；不做昵称修改 / 换绑 / 注销） | 换绑、注销涉及 PII 与 COS 物理删除，须单独合规设计，不并入轻量设置 |
| 身份切换 | `/me/settings`（原建设中，2026-06-18 收口到账号设置） | 无 | — | ✅ 已打通（定义为「退出当前账号后用另一手机号重新登录」；`logout()` 清空内存会话后跳 `/login`，不串号） | 不做多角色身份系统 |
| 我的权益 | `/me/benefits`（原建设中，2026-06-18 接 `BenefitGrant` 只读页） | BenefitGrant；Admin 手动 search/grant/revoke；权益活动领取生成的 BenefitGrant；AuditLog | 我的权益 | ✅ 已打通（Kiosk 本人只读；Admin 精确手机号搜索 + 手动发放/撤销；权益活动领取后进入本人权益；手机号脱敏；搜索/发放/撤销均审计；无支付/核销） | 套餐购买、额度消费、核销仍需独立支付/核销域，不并入本批 |
| 消息通知 | `/me/notifications`；Admin `/member-notifications` | `MemberNotification`、`SystemBroadcast`、`BroadcastReadState`、AuditLog | 消息通知 | ✅ 已打通（本人消息列表、未读筛选、全部已读、单条已读、删除个人消息/隐藏广播；Admin 创建/撤回系统广播；广播按用户读/隐藏状态隔离） | 暂不做 WebSocket/短信推送；后续如接实时推送需独立频控、退订与模板审核 |
| 意见反馈 | `/me/feedback`；Admin `/member-feedback` | `FeedbackTicket`、`FeedbackReply`、`MemberNotification`、AuditLog | 我的反馈/异常记录、消息通知 | ✅ 已打通（本人提交/查看/补充/关闭；Admin 筛选/查看/回复/改状态；回复后自动生成本人消息；联系电话加密存储、页面只显示脱敏；后台审计不写明文手机号） | 打印订单详情携带 `relatedPrintTaskId` 的快捷反馈入口已接线（2026-06-21）✅；不支持附件、富文本和匿名反馈 |
| 权益活动 | Kiosk `/activities`、`/activities?source=fair`、`/activities/:id`；Admin `/benefit-activities` | `BenefitActivity`、`BenefitClaim`、`BenefitGrant`、AuditLog | 我的权益 | ✅ 已打通（Admin 创建草稿、发布、结束、查看领取记录；Kiosk 活动列表/详情/登录后领取；领取成功写入 `BenefitClaim` 并生成 `BenefitGrant`，可在 `/me/benefits` 查看；合规词拦截；补贴资格提示仅信息展示） | 暂不做支付、套餐购买、活动核销、自动资格审核、Partner 自助配置、招聘会签到或凭证 |
| 求职打印套餐 / AI服务套餐 / 招聘会扫码凭证 | 仍建设中 | — | — | ❌ 未打通（套餐/支付/凭证域，本批不做） | 套餐 / 支付 / 凭证排到后续域，不伪造凭证 |

#### 3.9.1 页面-按钮-接口-数据-后台闭环矩阵（2026-06-19）

> 2026-06-19 百度云预生产补充验证：最终 `a4b1803a` 已部署到 `120.48.13.190`，PostgreSQL 迁移、服务器核心 verify、公网 HTTP 权益活动领取链路、反馈/广播通知链路均已通过；通知「全部已读」已修复超过 100 条广播未归零问题，公网样本 `unreadBefore=338` → `unreadAfter=0`。公网截图仍沿用本轮早前截图：`/tmp/cloud-kiosk-activities-9766bd2d.png`、`/tmp/cloud-admin-benefit-activities-9766bd2d.png`、`/tmp/cloud-admin-member-feedback-9766bd2d.png`。仍不包含 Windows 真机、真实腾讯短信、支付/套餐/核销。

| 前台页面 / 入口 | 用户操作 | API / 后端服务 | 数据表 / 存储 | 后台展示 / 管理 | 合作机构端 | 状态与验证 |
|---|---|---|---|---|---|---|
| `/profile` 我的权益 | 点击「我的权益」 | `GET /api/v1/me/benefits` → `MemberBenefitsService.list` | `BenefitGrant` | Admin `/member-benefits` 可按手机号搜索、查看、手动发放、撤销 | 不可见 | 未登录跳登录；空态诚实；`verify:member-benefits-admin` 覆盖本人隔离、脱敏、审计 |
| `/profile` 权益活动 | 点击「权益活动」 | `GET /api/v1/activities` → `BenefitActivitiesService.listVisible` | `BenefitActivity` | Admin `/benefit-activities` 创建/发布/结束活动 | 不可见，Partner 自助配置未开放 | mock 模式返回空，不造假；`verify:benefit-activities` 覆盖可见性 |
| `/activities/:id` | 点击「登录后领取 / 立即领取」 | `POST /api/v1/activities/:id/claim` → `BenefitActivitiesService.claim` | `BenefitClaim` + `BenefitGrant` + `AuditLog` | Admin `/benefit-activities` 领取记录只显示脱敏手机号 | 不可见 | 未登录跳 `/login`；重复领取/库存/下架/过期拒绝；本机 PG/HTTP/Chrome 与百度云公网 HTTP 均已验收 |
| `/activities/:id` | 点击「查看我的权益 / 我的权益」 | `GET /api/v1/me/benefits` | `BenefitGrant.sourceRef=activityId` | Admin `/member-benefits` 可看到同一用户权益 | 不可见 | 领取后回到 `/me/benefits` 可见；`verify:benefit-activities` 覆盖 |
| Admin `/benefit-activities` | 创建草稿、编辑、发布、结束、查看领取记录 | `/api/v1/admin/benefit-activities*` → `BenefitActivitiesService` | `BenefitActivity`、`BenefitClaim`、`AuditLog` | 当前页面即管理入口 | 不可见 | `JwtAuthGuard + RolesGuard + @Roles('admin')`；合规词拦截；手机号脱敏 |
| Admin `/member-benefits` | 搜索手机号、发放、撤销权益 | `/api/v1/admin/member-benefits*` → `AdminMemberBenefitsService` | `EndUser`、`BenefitGrant`、`AuditLog` | 当前页面即管理入口 | 不可见 | 精确手机号搜索；审计仅写 `phoneMasked`；`verify:member-benefits-admin` 覆盖 |
| `/profile` 消息通知 | 点击「消息通知」 | `GET /api/v1/me/notifications`、`PATCH /api/v1/me/notifications/*`、`DELETE /api/v1/me/notifications/*` → `MemberNotificationsService` | `MemberNotification`、`SystemBroadcast`、`BroadcastReadState` | Admin `/member-notifications` 创建/撤回系统广播；反馈回复自动生成本人消息 | 不可见 | 未登录跳登录；空态诚实；已读/全部已读/删除/隐藏广播按本人隔离；`verify:feedback-notifications` 覆盖 |
| `/profile` 意见反馈 | 点击「意见反馈」 | `GET/POST /api/v1/me/feedback*` → `MemberFeedbackService` | `FeedbackTicket`、`FeedbackReply`、`MemberNotification`、`AuditLog` | Admin `/member-feedback` 筛选、查看、回复、改状态 | 不可见 | 未登录跳登录；联系电话加密存储、只脱敏展示；Admin 回复后本人消息通知；`verify:feedback-notifications` 覆盖 |
| Admin `/member-notifications` | 创建系统广播、撤回系统广播 | `/api/v1/admin/notifications/broadcasts*` → `MemberNotificationsService` | `SystemBroadcast`、`BroadcastReadState`、`AuditLog` | 当前页面即管理入口 | 不可见 | `JwtAuthGuard + RolesGuard + @Roles('admin')`；合规词拦截；暂不做短信/WebSocket |
| Admin `/member-feedback` | 查看反馈、回复、调整状态 | `/api/v1/admin/feedback*` → `MemberFeedbackService` | `FeedbackTicket`、`FeedbackReply`、`MemberNotification`、`AuditLog` | 当前页面即管理入口 | 不可见 | 审计不写明文手机号；回复自动发本人消息 |
| `/profile` 我的文档 / 打印订单 / 浏览记录 / 外部跳转记录 | 点击对应入口 | 既有 `/api/v1/me/documents`、`/api/v1/me/print-orders`、`/api/v1/me/activity` 系列 | `FileObject`、`PrintTask`、`BrowseLog`、`ExternalJumpLog` | 文件/订单由 Admin 文件与订单页面承载；浏览/跳转仅本人侧查看 | 不可见 | 已在既有明细页真实化；不得记录投递/预约结果 |
| `/profile` 求职打印套餐 / AI 服务套餐 / 招聘会扫码凭证 | 点击建设中入口 | 无生产 API | 无 | 无 | 无 | 当前不打通，不用静态假数据冒充；后续套餐/支付/凭证域单独设计 |

---

## 四、用户数据分组与承载标准

> 整改后（2026-06-14）：下表是用户数据的**分类标准与必须支持的操作**，不再代表「我的」页的聚合分区。这些明细**归位到对应业务页面**展示（见顶部整改说明的归位对照），「我的」页只保留入口与概览，不再渲染独立「账号资产」分区。下表「分组」一列等价于「数据分类 / 承载业务页面」。

| 分组 | 应收纳的数据 | 必须支持的操作 |
|---|---|---|
| 我的简历 | 上传简历、诊断简历、生成简历、优化简历版本 | 查看、继续优化、岗位匹配、下载/打印、删除 |
| 我的文档 | 上传文件、扫描文件、AI 生成 PDF、报告 PDF、政策/招聘会资料 | 预览、下载、打印/再打印、删除 |
| AI服务记录 | 简历诊断、简历优化、简历生成、岗位匹配、模拟面试、职业规划、招聘会参会准备单、AI助手问答 | 查看结果、继续下一步、打印报告、删除 |
| 打印订单 | 所有打印任务，包括简历、扫描件、报告、政策/招聘会资料 | 查看状态、查看参数、再次打印、异常反馈 |
| 我的收藏 | 岗位、招聘会、政策 | 查看、取消收藏、继续匹配/打印/来源跳转 |
| 我的权益 | 优惠券、免费次数、套餐权益、补贴资格提示 | 查看、使用、过期说明；不得承诺补贴到账 |
| 浏览与跳转记录 | 岗位 / 招聘会 / 政策浏览记录；去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约 / 扫码前往来源平台签到 / 官方入口打开记录 | 查看岗位 / 查看招聘会 / 查看政策、再次打开来源平台 / 官方入口、删除；不得记录投递/预约/签到结果 |
| 我的反馈/异常记录 | 打印失败、设备异常、文件处理失败 | 查看处理状态、重新提交或回到订单详情 |

---

## 六、核查结论与缺口优先级（2026-06-12 代码级核查）

> 核查方式：逐入口对照实际路由 / Prisma 模型 / ProfilePage 资产组实现（基于 main `2cfd87d`）。

### 已完整打通（验收过，保持回归）

诊断 / 优化 / 生成 / 岗位匹配（2D）四条 AI 链路 → AI服务记录（含删除级联）；职业规划 → AI服务记录 / 我的文档 / 打印订单；文档上传与 AI 导出 PDF → 我的文档（预览/下载/再打印/删除）；打印任务 → 打印订单（状态/参数）；三类收藏（岗位/招聘会/政策）→ 我的收藏（含本机合并）；岗位 / 招聘会 / 政策浏览与外部入口打开记录 →「我的」浏览与跳转记录；招聘会资料打印 → 我的文档+打印订单；模拟面试 → 自有历史页（查看/删除/报告打印）。

### 缺口清单（按优先级）

| 优先级 | 缺口 | 现状 | 修正方向 |
|---|---|---|---|
| ~~P0-闭环~~ ✅ 已完成（2026-06-12） | 模拟面试记录接入「我的」AI服务记录口径 | AI服务记录组顶部并列「模拟面试报告」条目（复用 /me/mock-interviews，仅元数据：岗位/面试官/时间/状态；查看报告/两步删除）；`/interview/reports` ↔「我的」双向互链；零新模型 | 浏览器登录态验收通过 |
| ~~P0-2E~~ ✅ 已完成（2026-06-12） | 职业规划占位未真实化 | 首页既有「职业规划」磁贴已点亮，`AiResumeResult(kind=career_plan)` + PDF + PrintTask 闭环 | 保持回归 |
| ~~P1~~ ✅ 已完成（2026-06-12） | 浏览记录 / 外部跳转记录无模型 | 已新增 `BrowseLog`（targetType=job/job_fair/policy）+ `ExternalJumpLog`（action=external_apply/external_appointment/external_open）；仅登录会员落库；服务端从已发布目标补齐来源快照；「我的」原建设中入口接入真实「浏览与跳转记录」资产组 | 保持只记录浏览与打开入口，不记录投递/预约结果 |
| ~~P1~~ ✅ 已完成（2026-06-18） | 消息通知 / 意见反馈域未实现 | 已新增 `MemberNotification`、`SystemBroadcast`、`BroadcastReadState`、`FeedbackTicket`、`FeedbackReply`；Kiosk 本人消息与反馈页接真；Admin 广播与反馈处理页接真；Admin 回复自动生成本人消息；手机号脱敏、审计与合规词拦截已覆盖 | 打印订单详情关联反馈入口后续接线；不做推送、短信、附件和匿名反馈 |
| P1 | 打印状态实时追踪 UI | 订单状态靠刷新 | 后端持久化已就绪，补轮询/推送 UI |
| P2 | AI 助手会话不落库 | 无会话模型 | 隐私先行设计（TTL/脱敏/本人可删）后再建模，落 AI服务记录 |
| 依赖硬件 | 扫描/U盘/云打印/证件复印/证件照 | 前端占位或演示 | 对应硬件扩展链路完成真机验收前不接「我的」（不造假数据） |

### 执行顺序（替代"直接做 2E"）

```text
1. ✅ P0-闭环：面试记录进「我的」口径（2026-06-12 完成）
2. ✅ P0-2E：职业规划真实化（2026-06-12 完成，按 §五 落点全闭环）
3. ✅ P1：浏览/跳转记录建模 + 「我的」建设中入口接真（2026-06-12 完成）
```

---

## 五、2E 职业规划落点

2E 不新增首页功能入口。2E 的正确范围是：

```text
把首页 AI简历服务组中已有的「职业规划」卡片真实化。
```

建议闭环：

```text
职业规划入口 → 选择/确认简历与目标方向 → 生成职业规划建议 → 结果页 → 存入 AI服务记录 → 可导出/打印为我的文档和打印订单 → 可继续简历优化/模拟面试/岗位匹配
```

数据落点：

- AI 结果：`AiResumeResult(kind=career_plan)`。
- PDF 建议单：`FileObject`，进入「我的文档」。
- 打印：`PrintTask`，进入「打印订单」。
- 后续 CTA：继续简历优化、岗位匹配参考、模拟面试；这些是结果页链路，不新增首页入口。

合规边界：

- 只能给本人参考，不做就业承诺。
- 不判断人格/心理/敏感属性。
- 不承诺薪资、通过率或任何就业结果。
- 不编造学历、证书、项目、经历。
- 不向企业推荐候选人，不形成招聘闭环。
