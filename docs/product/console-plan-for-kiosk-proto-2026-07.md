# Admin / Partner 后台功能规划 —— 支撑 Kiosk 75 屏原型商用闭环

> 建立时间:2026-07-17
> 基准:`docs/design/kiosk-proto-2026-07/`(前台 75 屏定稿)+ 真实代码盘点(`apps/admin/src/routes/index.tsx`、`apps/partner/src/routes/index.tsx`,盘点基线 worktree `epic-nightingale-ebea54`)
> 关联:[CLAUDE.md](../../CLAUDE.md) §9/§10/§18 | [compliance-boundary.md](../compliance/compliance-boundary.md) | [next-tasks.md](../progress/next-tasks.md)
> 原则:**前台每个用户可见功能,都必须有对应的后台管理闭环**;后台只做「信息入口 + 工具服务 + 终端运营」管理,不做任何招聘闭环。

---

## 一、Admin 现有页面清单(来自 `apps/admin/src/routes/index.tsx`,共 28 个业务路由)

| 路由 | 功能 | 状态 |
|------|------|------|
| `/` | 工作台 Dashboard | 已接真 |
| `/devices`(+`/terminals` `/printers` `/peripherals` 重定向) | 终端 / 打印机 / 外设合并管理(Tab) | 已接真;终端设备档案生产验收待做(next-tasks P1) |
| `/orders` | 订单只读列表 / 详情 | 已接真;**只读**,无退款 / 标记支付写操作(页面明示) |
| `/print-scan` | 打印扫描运营(任务中心) | 已接真;首期统一任务中心扩展在 next-tasks「打印扫描首期收口」 |
| `/billing` | 计费与对账:价目配置(唯一合法改价路径,`/admin/billing/price-config`)+ 本地对账(只读,含退款差异清单) | 已接真(支付域 W-C) |
| `/files` | 文件管理 | 已接真 |
| `/job-materials` | 求职材料库管理 | 已接真 |
| `/ai-services` | AI 服务用量 / 记录 | 已接真 |
| `/ai-config` | AI 大模型配置(6 个功能键 × 厂商 / Key / 提示词 / 温度 / 开关,Key 不回显) | 已接真 |
| `/job-sources` `/fair-sources` `/policy-sources` | 岗位 / 招聘会 / 政策来源审核(pending→approved,发布动作) | 已接真 |
| `/fairs` | 招聘会运营(公司·展区 / **场馆导览 VenueGuideTab** / 物料 / 统计) | 已接真 |
| `/companies` | 企业展示 CompanyProfile 管理(指标开关) | 已接真 |
| `/partners` | 合作机构管理(含机构内 Partner 账号 tombstone 移除,PR #267 待合入) | 已接真 |
| `/users` | 会员用户管理 | 已接真 |
| `/benefit-activities` | 权益活动 CRUD + 领取记录(coupon / free_quota / package_entitlement / subsidy_eligibility_hint) | 已接真 |
| `/member-benefits` | 会员权益发放 / 查询(BenefitGrant,按会员搜索发放) | 已接真 |
| `/member-feedback` `/member-notifications` | 会员反馈 / 通知管理 | 已接真 |
| `/alerts` | 告警中心(实时派生告警) | 已接真 |
| `/permissions` `/audit` | 权限管理 / 日志审计 | 已接真 |
| `/import-batches` `/sync-sources` | 导入批次 / 数据源同步管理 | 已接真 |
| `/screensaver` | 待机宣传屏:素材上传(`/admin/ad-assets`)+ 外链视频 + 播放方案(`/admin/ad-playlists`)+ 终端配置;AI 海报为二期 stub(`/admin/ai-posters/status`) | 已接真(一期) |
| `/toolbox` | 百宝箱微应用:上架管理(`/admin/toolbox/apps`)+ 域名白名单 + 终端开关(`/admin/toolbox/terminals`) | 已接真;生产验收待做(next-tasks P1) |
| `/smart-campus` | 智慧校园按终端校方开关(`/admin/smart-campus/terminals`) | 已接真 |
| `/account-settings` | 管理员账号设置(改密 / 手机号绑定) | 已接真;严格首绑 PR #256 待发布 |

## 二、Partner 现有页面清单(来自 `apps/partner/src/routes/index.tsx`,共 12 个业务路由)

| 路由 | 功能 | 状态 |
|------|------|------|
| `/` | 工作台(真实聚合,含政策统计) | 已接真 |
| `/profile` | 机构资料(自助修改受 allowlist 限制,`verify:partner-org-self` 锁边界) | 已接真 |
| `/jobs` | 岗位信息管理(编辑一律回 pending+draft 强制重审) | 已接真 |
| `/companies` | 企业展示资料维护(本机构来源) | 已接真 |
| `/fairs` | 招聘会信息管理 | 已接真;**场馆导览配置入口缺失**(CLAUDE.md P1) |
| `/smart-campus` | 智慧校园内容维护(校方) | 已接真 |
| `/policy` | 政策公告管理 | 已接真 |
| `/terminals` | 终端数据 | 已接真 |
| `/stats` | 数据统计 | 已接真 |
| `/sources` | 数据源三轨接入(API / Webhook / Excel 字段映射) | 已接真 |
| `/sync-logs` | 同步日志 | 已接真 |
| `/account` | 账号权限 | 已接真 |

**盘点结论**：CLAUDE.md §9A 规定的两端核心页面范围已基本落地；招聘域剩余工作已从“补页面”转为“统一模型与治理”：线下机构 P0 已接真但仍使用 legacy 模型，线上招聘平台仍是 Kiosk 硬编码目录且没有 Admin 治理。其余缺口集中在退款操作、法务版本、FAQ 等商用运营细节。

---

## 三、缺口清单(前台能力 ↔ 后台管理面逐项核对)

### G1 线下招聘机构管理(74/75 屏)——P0 已接真，P1 模型待统一

- **现状**：Kiosk 列表/详情/岗位详情、Admin `/offline-agencies`、Nest CRUD/审核/发布和生产 HTTP 契约已接真；P0 已补编辑回待审、父机构停用阻断深链、驳回理由和审计门禁。
- **剩余结构问题**：`OfflineAgency / OfflineJob` 仍与 `Organization / JobSource / Job` 隔离；机构内容审核不能证明许可证有效，OfflineJob 也没有独立来源、审核、发布和真实用工企业字段。
- **P1 归位**：Organization 作为责任主体，新增 QualificationRecord、OfflineAgencyProfile 和 Branch；所有新线下岗位统一写 canonical Job，机构详情只展示关联岗位筛选，不保留第二套岗位编辑器。首期仍由 Admin 代管，Partner 不核验自身资质、不拥有发布权。
- **来源硬门禁**：正式合规契约当前仍要求岗位 `sourceUrl`。没有真实 employer、结构化 city 和合规 HTTPS 来源的 legacy OfflineJob 只能保持 `pending + draft` 或进入 blocker，不能用机构名/地址占位发布。
- **详细实施方案**：[招聘信息内容域统一模型与迁移方案](./recruitment-content-domain-model-2026-08.md)。
- **合规注意**：不得出现代收简历、代收费、预约登记、到店应聘办理；电话只作公开信息展示，距离和服务时间必须注明数据来源。

### G1A 线上招聘平台目录——P1 Admin 治理待建

- **现状**：Kiosk 页面仍由 4 个代码常量展示官方首页入口，没有数据库、审核发布、排序、归档、链接巡检或失效治理。
- **归属**：新建独立 `OnlinePlatformDirectory`，由 Admin 维护和发布；Partner 不拥有目录创建、审核或发布权。它可以选择关联 Organization，但不能与 JobSource 技术通道共用审批、启停或发布状态。
- **发布门禁**：核实平台运营主体、HTTPS 官方域名、重定向最终域、品牌展示依据和中性文案；不因目录发布自动授予数据接入权，也不把未建立书面关系的平台写成“合作平台”。
- **CTA 与日志**：目录使用“前往官方平台查看 / 扫码打开来源平台”，只记录 `external_open`，不记录第三方投递结果。
- **详细实施方案**：[招聘信息内容域统一模型与迁移方案](./recruitment-content-domain-model-2026-08.md)。

### G2 首页动态专区开关(01 屏底部:百宝箱 / 智慧校园)

- **现状**:管理面**已具备**——Admin `/toolbox`(上架 + 域名白名单 + 按终端开关)与 `/smart-campus`(按终端校方开关)均已接真;01 屏 `:only-child` 通栏规则由前台按两个开关状态渲染。
- **缺口**:① 百宝箱生产验收 + Phase 1B 管理体验(blocked reason / 修复建议展示)在 next-tasks P1 待做;② 首页动态专区「双开 / 单开 / 全关」三态与后台开关的联动需在 Kiosk 改版时做一次端到端验收。
- **优先级**:P1(验收与体验增强,非新建) | **归属端**:Admin
- **合规注意**:百宝箱第三方微应用上架必须过白名单与审核(高风险微应用先过法务,见 next-tasks);智慧校园仅校方开启后显示,不得默认开。

### G3 待机宣传屏素材管理(57 屏)

- **现状**:Admin `/screensaver` 一期**已具备**:图 / 视频上传、外链视频、播放方案、终端配置;AI 文生图为二期 stub(`AI_IMAGE_PROVIDER=disabled`,零外部费用)。
- **缺口**:① 素材「审核后播放」目前等价于「管理员上传即审」,页面无独立审核状态字段(待核实,若未来 Partner 可提交素材则必须补审核流);② 57 屏底部「进入待机自动退出登录并清除会话」属前台行为,无后台缺口;③ AI 海报生成二期(P2)。
- **优先级**:P2(现状够用) | **归属端**:Admin
- **合规注意**:宣传素材不得含「保面试 / 保录用 / 一键投递」类文案;价格表述统一「以现场公示为准」。

### G4 权益活动 / 权益发放管理(21 / 24 屏)

- **现状**:**已具备**——Admin `/benefit-activities`(活动 CRUD、四类权益类型、五类来源 platform/campus/gov/fair/partner、领取记录)+ `/member-benefits`(按会员发放 / 查询 BenefitGrant)。与 21/24 屏的券 / 免费次数 / 服务额度 / 政策资格提示四类完全对应。
- **缺口**:① 合作机构赞助活动(source_type=partner)目前由 Admin 代录,Partner 端无活动申请入口——建议保持 Admin 代录(赞助仅品牌露出,§8.3),Partner 自助申请列 P2;② 活动核销 / 抵扣与打印订单的联动在支付域 Wave 3(next-tasks「打印售后与权益单点闭环」),不在本规划重复立项。
- **优先级**:P2(Partner 申请入口) | **归属端**:Admin(现状)/ Partner(P2)
- **合规注意**:政策资格提示只做信息指引,后台表单禁止录入「到账金额 / 发放状态」类承诺字段;企业赞助不得换取任何求职者数据回流(§8.3)。

### G5 打印价目表管理与退款处理(32 收银台)

- **现状**:① 价目:Admin `/billing` 价目配置已是唯一合法改价路径(改价即时生效 + 审计),现有价目键仅 `print_bw_page` / `print_color_page`(`price-config.seed.ts`);② 退款:退款自动收敛、对账差异清单(含 4 类退款异常)已上线(支付域 W-C);**但 Admin `/orders` 为只读,无人工退款发起入口**(页面明示「不提供标记支付、退款或改状态操作」);32 屏明示「本机不提供自助退款,请联系现场工作人员」——即人工退款必须有后台入口承接。
- **缺口**:
  1. **Admin 订单退款操作入口**(P0,收费模式启用前阻塞):订单详情抽屉增加「发起退款」(全额 / 按行部分退款、原因必填、二次确认、幂等、审计),仅对 paid 且未履约 / 履约失败订单开放;沿用已有退款收敛与对账链路。⚠️ next-tasks 已记录该项前置:**须先修订 orders readonly 守卫并经用户确认**,不得绕过。
  2. **价目项覆盖度**(P1):32 屏出现「双面附加(本单不收取)」——如商用定价含双面 / 份数阶梯 / 简历彩打等新价目项,需扩展 PriceConfig key 集合与收银台价目明细行;当前仅黑白 / 彩色单页两键,待商用定价拍板后补。
- **优先级**:P0(退款入口)/ P1(价目项) | **归属端**:Admin
- **合规注意**:退款只在服务端处理且幂等落库(§8.5);不得把支付异常伪装成打印任务状态;免费模式(FREE_MODE)下退款入口应隐藏或禁用;金额展示一律「以现场公示价为准」。

### G6 帮助中心 FAQ / 法务文档版本管理(58 / 59 屏)

- **现状**:两者均**硬编码在 Kiosk 前端**——`HelpCenterPage.tsx` 内置 `SECTIONS` FAQ 数组;`LegalDocPage.tsx` 内置 `TERMS_SECTIONS` / `PRIVACY_SECTIONS` 与 `UPDATED_AT = '2026 年 6 月 22 日'` 常量。59 屏自身标注「试运营版本,正式运营前以法务审定版本为准」;next-tasks P0 含「法务合规:用户协议、隐私政策、AI 免责声明、来源免责声明审定」。
- **缺口**:
  1. **法务文档版本管理**(P0 最小版):建 `LegalDocVersion`(docKey / version / 生效日期 / 审定人 / 全文快照或结构化章节 / 状态 draft→published),Kiosk 59 屏改为读已发布版本;登录同意记录(useMemberPhoneLogin 的协议勾选)关联当时版本号——这是「继续使用即视为同意」条款可追溯的前提。Admin 侧一页即可:版本列表 + 新版本发布(二次确认)+ 历史版本只读。
  2. **FAQ 管理**(P2):硬编码可接受(内容稳定、随版本发布);若运营期需频繁调整再建 `FaqItem` 管理页,不提前建。
- **优先级**:P0(法务版本最小版,配合法务审定验收)/ P2(FAQ) | **归属端**:Admin
- **合规注意**:法务文档只能由 Admin 发布,发布动作必审计;版本切换不得追溯性修改用户已同意的历史版本记录。

### G7 岗位匹配三档口径与 AI 服务配置管理面(55 屏及全部 AI 能力)

- **现状**:① Admin `/ai-config` 已支持 6 个功能键(`assistant_chat` / `resume_diagnosis` / `resume_generate` / `resume_optimize` / `digital_human` / `poster_generation`)的厂商 / Key / 提示词 / 温度 / 开关配置;`/ai-services` 已有用量记录;② 岗位匹配(job_fit)、模拟面试、职业规划三个已上线 AI 能力**不在功能键列表内**(服务实现在 `services/api/src/ai/resume/`,模型配置来源待核实,疑走环境变量或复用简历管线配置)。
- **缺口**:
  1. **AI 功能键覆盖补齐**(P1):将 `job_fit` / `mock_interview` / `career_plan` 纳入 ai-config 功能键,统一「厂商 / Key / 启用开关 / 连通性测试」口径,避免生产换 Key 时部分能力游离在配置面之外。
  2. **三档口径本身不做后台可调**(明确决策):较高 / 中等 / 偏低三档为合规红线口径(禁止百分比,README §五、compliance §4.5),固化在代码与提示词模板中;**不提供**「切换为百分比 / 调整档位数量」的后台开关,防止运营侧误操作破线。仅可在 ai-config 的提示词字段内做表述微调,且守卫(verify:governed-job-fit)保持。
- **优先级**:P1 | **归属端**:Admin
- **合规注意**:任何 AI 配置变更不得使输出出现录用概率 / 百分比匹配;AI Key 只存服务端不回显(现状已满足)。

### G8 其余前台屏对照结论(无新增缺口,一句话归档)

- 62 手机上传 / 63 扫码登录:链路已上线,无后台缺口。
- 60 会话超时 / 61 断网异常:前台系统屏;超时时长如需可配,挂现有终端配置(P2,待核实是否有诉求)。
- 71/72 活动记录、16–20/22/23「我的」系列:对应 Admin users / member-feedback / member-notifications / files 已覆盖。
- 43–49 招聘会子页:Admin `/fairs` 五 Tab 已覆盖;唯 **Partner 场馆导览配置入口 + 展厅平面图图片** 为既有 P1 遗留(CLAUDE.md §16),归入落地顺序,不重复立项。
- 08/09/53/54 岗位与企业:job-sources / companies 审核发布链路已覆盖。

---

## 四、「不做」清单(两端共同红线,任何迭代不得突破)

1. **候选人管理 / 简历代收**:两端不建任何「收到的简历」「候选人池」「applicant」数据模型与页面;线下机构管理(G1)同样不做「到店登记名单」回流。
2. **面试邀约 / Offer 管理 / 企业筛选**:不做企业端任何招聘处理界面;模拟面试报告只给本人,后台只见用量不见内容明细(现状口径保持)。
3. **平台内投递闭环**:后台不配置、不统计「投递成功数」;只统计浏览 / 外部跳转(BrowseLog / ExternalJumpLog 口径)。
4. **违规文案配置能力**:活动、宣传屏、百宝箱、机构简介等一切后台可编辑文案入口,禁用词校验(一键投递 / 立即投递 / 保面试 / 保录用 / 补贴必到账等)服务端强制,不允许白名单豁免。
5. **岗位匹配百分比开关**(见 G7)。
6. **线下机构代收费 / 预约代办**:G1 不做任何费用、预约、报名字段。
7. **Partner 自助删除账号 / 越权改资料**:保持现有 allowlist 与 Admin tombstone 移除边界(PR #267 口径)。

---

## 五、落地顺序建议（以 next-tasks 当前状态为准）

后台招聘数据 P0 已发布；后续仍按独立分支、分波实施，不与上线前硬件、法务和生产验收混批：

| 批次 | 内容 | 前置 |
|------|------|------|
| 第 1 批（P1） | **招聘内容域 expand**：统一主体、数据源、平台目录、机构资料/门店/资质和 canonical Job；先修迁移门禁，不切页面读写 | P1 Wave 0 方案冻结 + 生产只读盘点授权 |
| 第 2 批(P0,收费模式启用前) | **G5-1 Admin 订单退款操作入口**(先修订 readonly 守卫并取得用户确认);**G6-1 法务文档版本管理最小版**(配合法务审定 P0 验收) | 支付域 Wave 3 排期、法务审定启动 |
| 第 3 批(P1) | G7 AI 功能键覆盖补齐;G5-2 商用价目项扩展;G2 百宝箱生产验收 + 首页动态专区端到端验收;Partner 场馆导览配置入口(既有 P1) | 商用定价拍板 |
| 第 4 批(P2) | G3 待机屏 AI 海报二期与素材审核流;G4 Partner 活动申请入口;G6-2 FAQ 管理页;会话超时可配 | 真实运营数据证明必要 |

每批开工前按 CLAUDE.md §8.1 写明任务边界(允许 / 禁止修改文件、验证门禁),并同步 `docs/progress/current-progress.md` 与 `next-tasks.md`。

---

## 附:待核实项汇总

- G1:终端与机构门店「直线距离」的计算来源(终端定位配置是否已有字段)。
- G3:ad-assets 是否已有独立审核状态字段(本次盘点未见「审核」相关 UI)。
- ~~G7:job_fit / 模拟面试 / 职业规划当前模型凭证的实际配置来源(环境变量或共享管线)。~~ **已核实(2026-07-31,见 §六)**:job_fit / 职业规划 / 招聘会拜访计划 / 岗位推荐 / 岗位解释 五项全部借用 `resume_optimize` 功能位;模拟面试有自己的 `mock_interview` 键。
- G8:会话超时时长是否有运营侧可配诉求。

---

## 六、2026-07-31 修订:双后台重排与商业化收口(基于真实代码复核 + Codex 交叉审查)

> 本节不替代 §三缺口清单,是把视角从「补缺口」升级为「重排 + 治理 + 商业化分轨」。
> 复核基线 worktree:`amazing-vaughan-f5cd33`。所有结论附文件行号,可复验。
> 上级执行框架仍以 [commercial-closure-and-console-redesign-plan-2026-07.md](./commercial-closure-and-console-redesign-plan-2026-07.md) 为准,本节不另起标准。

### 6.1 诊断

Kiosk 已按 6 个 AI 服务组组织(`apps/kiosk/src/pages/home/serviceGroups.ts`:简历 / 岗位 / 招聘会 / 打印扫描 / 面试 / 政策),Admin 侧栏仍是 **32 项平铺 / 5 组**(`apps/admin/src/layouts/AdminLayoutWrapper.tsx`,按「设备和表」组织)。Partner 侧栏 **12 项对 5 种机构类型完全一样**(`apps/partner/src/layouts/PartnerLayoutWrapper.tsx`)。

前后台逐项核对后,**真正缺失的运营页只有一个:面试训练运营**。`services/api/src/mock-interview/mock-interview.controller.ts` 有 12 条路由(含语音转写 / 报告 / 打印),`grep -rin "interview" apps/admin/src/` 无任何业务页面命中。其余全是「重新归组 + 补数据」,不是新建功能。**本轮结论因此是重排与治理,不是扩张。**

### 6.2 共用功能键:6 项能力挂在一个开关上(P0 隐蔽风险)

读 `getApiKey('resume_optimize')` 的全部位置(共 6 处,无第 7 处;**不写行号**,因为加注释本身就会让行号漂移。权威清单用检索命令复核):

```bash
grep -rn --include='*.ts' -E "get(ApiKey|Config)\('resume_optimize'\)" services/api/src
```

| 用户可见能力 | 位置 |
|---|---|
| AI 简历优化 | `llm-resume-optimize.service.ts`(两处,本键的名义归属) |
| 岗位大师 / 岗位匹配 | `llm-job-fit.service.ts` |
| 职业规划 | `llm-career-plan.service.ts`(`callLlm`) |
| 招聘会拜访计划 | `llm-fair-visit-plan.service.ts`(`callLlm`) |
| 岗位推荐(`jobRecommend`) | `job-ai-llm.service.ts`(`callLlm`) |
| 岗位解释(`jobExplain`) | `job-ai-llm.service.ts`(同一 `callLlm`) |

在 Admin「AI大模型」关掉「AI简历优化」或改错凭证,**上述 6 项同时失效**。运行端不会说明这层依赖(各能力只表现为「未配置 / 不可用」)。已在代码就地加警示注释,并把共用清单写进 `AI_MODEL_FEATURES` 的 `runtimeNote`——该字段渲染在 `apps/admin/src/routes/ai-config/index.tsx:207,210`,**因此 Admin 配置页现在有提示**,运营动开关时能直接看到。

治理方向:为后 5 项各建独立 feature key,**默认继承 `resume_optimize` 配置**(行为不变、可回滚),使开关与成本归属按能力隔离。

### 6.3 AI 成本可见性缺口(修正原判断)

`AiServiceLog` 的 `operation` 取值(后端 `AiOperation` 联合类型,9 个):`parseResume` / `optimizeResume` / `adjustResumeLayout` / `generateResume` / `chatAssistant` / `classifyIntent` / `jobRecommend` / `jobExplain` / `jobMatch`。

⚠️ 不要把这一组和 `JobAiSession.operation` 混为一谈——后者是另一张表的取值(`match` / `recommend` / `explain`,见 `job-ai/job-ai.service.ts`、`governed-job-fit.service.ts`),二者不同源。**已发现一处真实类型漂移**:前端 `apps/admin/src/services/api/types.ts:316` 的 `AiOperation` 只有 8 个值,漏了后端已有的 `adjustResumeLayout`,而 `costByOperation` 是 `Record<AiOperation, number>`——即「简历排版调整」的成本在 Admin 侧类型上无处归属。A-6 统一枚举时一并修。

**未写日志的能力**(`grep -c "aiLog|AiLogService"` 全为 0):

- 职业规划 `llm-career-plan.service.ts`
- 招聘会拜访计划 `llm-fair-visit-plan.service.ts`
- 模拟面试全链路 `mock-interview/*.service.ts`(含按时长计费的语音转写)

即这几项 AI 成本**完全不可见**,不是归类不准。

另两处已确认的口径与覆盖问题:

- **「今日」标签错**:`ai-log.service.ts:100` 是 `AI_USAGE_WINDOW_MS = 24 * 60 * 60 * 1000`(滚动 24 小时),但 `apps/admin/src/routes/ai-services/index.tsx` 写「今日概览」(标题 :224、`aria-label` :223)与「今日累计」(:229)——共 3 处文案需一起改。
- **限流覆盖不全**:`ai.controller.ts` 11 条路由仅 4 条有 `@Throttle`;`mock-interview.controller.ts` 12 条仅 7 条。且限流值并不统一(全仓 `limit:` 分布 5/6/10/12/20/30/60)。限流是**防滥用**,不是商业额度。

### 6.4 商业化闸门缺失

`ai.controller.ts:170-200` + `ai.service.ts:320-380` 的实际时序是:

```
查缓存(loadAuthorizedResult 'optimize')→ 命中即直接返回
  ↓ 未命中
parse 行门禁 → 取简历原文 → 调 LLM(成本在此发生)→ 仅 completed 才落库
  ↓ 回到 controller
客户端若显式传了可选 @Query benefitGrantId 且 status === 'completed' → 事后核销权益
```

三点结论:

1. **不存在服务端强制的事前额度闸门**——权益核销是事后、可选、由客户端参数触发。
2. **缓存命中也满足 `completed`**,同样会走核销分支;真正防止重复扣费的是幂等键 `hash(grant:resume_optimize:taskId)`,不是时序。
3. 因此后续做真实计费时,「缓存命中不重复扣费」必须显式设计,不能依赖当前偶然正确的幂等键。

`price-config.seed.ts` 只有 `print_bw_page` / `print_color_page` 两个键,**无任何 AI 价目键**(注:`serviceKey` 是开放字符串,种子只有 2 条不等于生产库只有 2 条,上线前需核实际配置)。

`PriceConfig.effectiveFrom` 是**无调度语义**的字段。准确表述:它由 `@default(now())` 自动填(两套 schema 均如此),`docs/operations/price-config-production.md:57` 的人工 SQL 也显式写 `NOW()`,Admin DTO(`admin-billing.service.ts:25,46,100`)与 mock 都带该字段——**并非「只由 seed 写入」**;真正缺的是读取方:`PricingService` 只按 `active` 报价,完全不读它。该状态**已被 verify 守卫锁定**(`verify-print-rollout-config.ts:186-195` 断言 `PricingService` 不得读 `effectiveFrom`),所以这不是失控项,而是已登记的「保留字段 + 禁用调度语义」。**不宜物理删除**:要动两套 Prisma schema + migration + DTO + 测试;且 `serviceKey @unique` 本身就存不了价格历史版本,真要做定时生效需先解开唯一约束。当前处置=Admin UI 标注「尚未启用」+ 保留字段与既有守卫。

**关键结论:`AiServiceLog` 不能当计费账本。** 它是 best-effort 写入(`ai-log.service.ts:152` 只 `.catch()` 打 warn 不阻断),且 `estimatedCostCny` 是估算值。适合运维观测,不适合做不可丢失的收入 / 履约 / 退款依据。

### 6.5 Partner 机构类型:两套概念必须分开建模

`Organization.type` 才是真实字段(`partnerType` 只是共享类型标识符),运行时有 14 处使用。存在两套并行概念:

| | 管什么 | 定义处 |
|---|---|---|
| `ORG_TYPE_MATRIX` | 该机构的**终端**开放哪些 Kiosk 能力(`sceneTemplate` + `allowedModules`,写入强校验) | `services/api/src/orgs/admin-orgs.service.ts:88-140` |
| 权限矩阵 | 该机构在 **Partner 后台**能管什么 | `docs/product/partner-permission-matrix.md` |

两者**不可互换**。实证:`licensed_hr_agency` 的 `allowedModules` 含 `job_fair`(终端可展示招聘会),但权限矩阵 §三「招聘会信息管理」整行对 `hr_agency` **全部 ❌**(后台不可管招聘会)。二者同时成立。

因此 Partner 侧栏**不能直接复用 `ORG_TYPE_MATRIX`**(它还是 service 内部常量,前端拿不到)。正确顺序:先建服务端权威的 Partner capability 投影 → API 与路由双重校验 → 侧栏只作为该投影的展示结果。**隐藏导航不等于权限控制。**

另需先定唯一事实源再动:`fair_organizer` 的企业资料应限定为招聘会关联企业;`enterprise_source` 只管本企业来源信息,不得演变为企业招聘后台;「校园招聘」目前无独立 Partner 页面,新增入口须先过入口冻结规则;`fair_organizer` / `enterprise_source` 的 `allowedModules` 当前是**空数组**,上线前需确认是有意(纯数据供给方)还是漏配。

### 6.6 可合并 / 可精简清单

**合并(仅合 IA,不合后端服务与状态机)**

| # | 现状 | 合并为 | 依据 |
|---|---|---|---|
| M1 | `/member-privacy`(213 行) + `/privacy-requests`(457 行) | 保留 `/privacy-requests` | 同一端点 `GET /admin/member-privacy/data-requests`,同样的重试 / 驳回动作,8 状态 × 3 类型映射表两份 |
| M2 | `job-sources` + `fair-sources` + `policy-sources` | 内容审核中心(3 个 type Tab) | 共用 `pending→reviewing→approved/rejected`。**只统一入口 / 状态词汇 / SLA 展示**;三者校验、发布规则、审计语义不同,不抽通用后端状态机 |
| M3 | `import-batches` + `sync-sources` | 数据接入 = **数据源 / 文件导入 / 同步记录** 三类 | `AccessMode` 有 6 个值(`api`/`excel`/`csv`/`json`/`webhook`/`manual`),不能只做 Excel + API 两 Tab |
| M4 | `orders` + `billing` | 订单与计费(订单 / 价目 / 对账 / 退款 Tab) | 同一财务域。**订单操作与财务对账权限不同,不合并服务与权限** |
| M5 | `benefit-activities` + `member-benefits` | 权益运营(活动 / 发放 Tab) | 模型是一条链 `BenefitActivity→BenefitClaim→BenefitGrant`。活动领取与人工发放语义不同,不合并状态 |
| M6 | `member-feedback` + `member-notifications` | 会员沟通(反馈 / 通知 Tab) | 反馈处理与通知发送不是同一工作流,只合入口 |

**精简**

- Admin `/permissions`(15 行 stub):**从侧栏摘掉,页面保留**。真实 RBAC 落地前不占「系统管理」头部位。
- Partner `/stats`、`/terminals`(各 15 行 stub):从侧栏摘掉。**不并入工作台**——工作台现有真实数据,没有真实聚合指标前不加空面板。12 项里 3 项死路(25%)对付费机构是直接可信度损失。
- Partner `/account`:接真(只读子账号列表 + 变更走平台联系入口)。
- Admin `/peripherals`:**保留不动**,它是 `devices/index.tsx:63` 的 Tab,侧栏本无此项。

净变化:**32 → 25 项**(合并省 7、摘 1 权限、加 1 面试运营)。

### 6.7 建议 Admin IA(6 域 25 项)

```
运营总览   工作台
服务运营   AI服务管理 / AI大模型 / 面试训练运营(新) / 打印扫描运维 / 招聘会运营 / 求职材料库
内容与来源 内容审核中心(M2) / 数据接入(M3) / 企业展示管理
会员与交易 用户管理 / 订单与计费(M4) / 权益运营(M5) / 会员沟通(M6)
终端运营   设备管理(含外设 Tab) / 告警中心 / 宣传屏 / 百宝箱 / 智慧校园
机构与治理 合作机构 / 线下机构 / 文件治理 / 数据权利工单(M1) / 法务文档版本 / 日志审计
```

改动落点:`AdminLayoutWrapper.tsx` 的 `NAV_ITEMS` / `PATH_TO_KEY` / `KEY_TO_PATH`。注意 `KEY_TO_PATH` 是 first-write-wins,调整顺序会改 active 高亮。**所有路由变更必须保留旧 URL 重定向**,避免书签 / 测试 / 文档链接失效。

### 6.8 分轨执行(修订原一次性排序)

原「W-1..W-6 一次收口」不可行:同时触碰 IA、数据库、AI 履约、计费、权限、隐私统计和结算,已不属于上线前收口,且最大风险是产出**半套 RBAC + 半套计费 + 不可审计扣费**——比不做更糟。改为:

| 轨道 | 内容 | 定位 |
|---|---|---|
| **A 后台 IA 减法** | A-1 M1 去重(留旧 URL 重定向);A-2 摘 stub 导航;A-3 六域重组(M2–M6,只动 `NAV_ITEMS` + 路由 + Tab 容器);A-4 `effectiveFrom` 标「尚未启用」不删字段 | 可逆、零新功能,属上线前收口 |
| **A+ AI 治理** | A-5 拆 5 个独立 feature key(默认继承);A-6 补职业规划 / 招聘会计划 / 模拟面试 / 语音转写日志 + 统一 `operation` 枚举;A-7 修「今日」口径 + 补 `@Throttle` 覆盖 + 超时 / 熔断 / 日预算;A-8 面试训练运营页(须在 A-6 有数据后) | 属收口。**成本看不见就无法定价**,是任何商业化的前置 |
| **B 商业化** | SKU 与价目版本(先解 `serviceKey @unique`)、原子履约账本(`reserve → LLM → commit`,失败 `release`,请求幂等 / 缓存命中不重复扣费 / 超时退款 / 匿名转会员归属)、合同生命周期、机构结算、完整 RBAC | **上线后独立立项**。不得在现有 AI GET 接口前直接挂扣费——那些接口兼具读取 / 生成 / 缓存 / 扣权益副作用 |
| **C Partner 自助** | 服务端 capability 投影 + API 路由双重校验 → 再按能力下发侧栏;Partner 聚合曝光统计(需动 schema) | 服务端授权必须先于动态侧栏 |

**顺序(2026-07-31 二次修订 —— 原写法有验收失效错误)**

原写的「P0 最终验收 → A → A+ → 上线」**是错的**:A / A+ 会改路由、导航、feature key、日志、限流与预算,若发生在最终验收之后,P0 证据就不再对应实际上线候选(候选已变,证据失效),违反本项目「冻结单一软件候选后再验收」的门禁口径。

只能二选一:

| 方案 | 顺序 | 适用 |
|---|---|---|
| **① 保持当前上线冻结(推荐)** | 完成剩余 P0(含 F1 D2′ / D3–D6、法务正文、PG/COS/真实服务、Windows 真机、试运营)→ **上线** → A → A+ → B、C | 后台 IA 与 AI 治理都不是上线阻塞项,不值得为它们推迟发布或作废已通过的 P0 证据 |
| **② A/A+ 随首发** | P0 前置检查 → A → A+ → **重新执行完整 P0 最终验收** → 上线 → B、C | 仅当业务上必须首发就交付新后台 IA 时才选;代价是完整重跑一次最终验收 |

依赖关系(两方案都成立):A-6 必须先于 A-8(无日志则运营页无数据);C 的服务端 capability 投影必须先于动态侧栏;**B 与 C 还有一个共同前置——先完成招聘信息发布 / 内容接入 / 曝光收费的许可边界审查**(见 compliance-boundary.md §8.8.1),许可结论未明确前不得实施任何按招聘内容计价的收费。

### 6.9 Partner 曝光统计的实现约束

`BrowseLog` / `ExternalJumpLog` 有 `targetType` + `targetId`,但**无 `sourceOrgId` 字段与对应索引**。要么 join 回 job / fair / policy 取 `sourceOrgId`(大数据量下慢),要么冗余一列 + 批量聚合。**归因快照不可变性**也是问题:内容后续换来源机构会导致历史统计漂移。

隐私约束(见 [compliance-boundary.md](../compliance/compliance-boundary.md) §8.8):只给聚合数据 + 最小样本阈值,不暴露 endUser 行为明细。

### 6.10 本次新增的「不做」条目(补 §四)

8. **机构结算不得按招聘成果计费**:不得按候选人数 / 投递量 / 面试量 / Offer 量向机构收费——那等于效果付费招聘中介,直接撞无人力资源服务许可证红线。详见 compliance-boundary.md §8.8。
9. **不得用 `AiServiceLog` 作为计费 / 退款依据**:它是 best-effort 写入 + 估算成本,只作运维观测。
10. **不得以「隐藏导航」代替权限控制**:Partner / Admin 任何按机构类型或角色的可见性收窄,必须有服务端 API 与路由校验兜底。
