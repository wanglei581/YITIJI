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

**盘点结论**:CLAUDE.md §9 规定的两端核心页面范围已全部落地且接真;缺口集中在 75 屏原型**新增规划**(74/75 线下机构)与**商用运营细节**(退款操作、法务版本、FAQ)上。

---

## 三、缺口清单(前台能力 ↔ 后台管理面逐项核对)

### G1 线下招聘机构管理(74/75 屏,新设计)——完全缺失

- **现状**:代码零支持。`apps/admin` `apps/partner` `services/api` `packages/shared` 中无 offline agency / 门店模型;仅 `SourceKind` 已含 `'hr_company'` 可复用。前台 74/75 屏为原型超出现状的新增规划(README §六明示)。
- **优先级**:**P0(与 Kiosk 74/75 屏前台实现同批立项;前台先行则无数据可展示)**
- **归属端**:**Admin 代管为主,Partner 不开放自助(首期)**。理由:
  1. 线下人力资源机构(街边门店)多数无 IT 运营能力,不适合走 Partner 三轨数据源体系;
  2. 74/75 屏强调「机构资质核验后收录」,核验责任必须收在运营方(Admin)手上;
  3. 现有 Partner 账号体系面向「数据源机构」,若未来某线下机构确有能力,可为其开 Partner 账号并复用 `/jobs`(sourceKind=hr_company),不必新造第二套端。
- **Admin 页面草案**(建议新路由 `/offline-agencies`):
  - **机构目录**:列表(区域 / 服务标签筛选)+ CRUD;字段:机构名、统一社会信用代码、门店名、地址、与终端直线距离(按终端定位计算或人工录入,待核实定位来源)、服务时间、公开咨询电话、服务标签(岗位推荐 / 用工咨询 / 劳务派遣 / 入职登记指引)、营业状态(正常 / 临时休息)、来源机构编号(ORG-xxxx)。
  - **资质核验记录**:每机构挂核验记录(人力资源服务许可证 / 营业执照编号、核验人、核验时间、证照影像 FileObject、到期提醒);未核验通过不得发布。核验影像按 §五文件安全走临时签名 URL + 访问日志。
  - **在招岗位关联**:线下岗位复用 `ExternalJob`(sourceKind=hr_company),新增「线下轨」标记(无 source_url 时以门店信息替代外部投递链接),岗位详情(74 屏)从机构门店信息带出地址 / 电话 / 服务时间;沿用现有 job-sources 审核流(pending→approved→published)。
  - **审核发布**:机构与岗位双层审核;机构下架时其岗位自动不可见。
- **合规注意**:页面与数据模型不得出现「代收简历 / 代收费 / 预约登记」;电话仅作展示(「本终端不接听或转接」);距离 / 服务时间必须标注「机构提供 / 直线距离」不造假;74 屏免责文案(不代收简历、不代收费用、收费以门店依法公示为准)由后台模板统一输出,不可被机构自定义覆盖。

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

## 五、落地顺序建议(不与 next-tasks 现有 P0 冲突)

当前 next-tasks 的 P0 是上线前真实验收(F1 发布链、PostgreSQL、短信、法务审定等)与用户中心 Wave 1;本规划全部按「其后排队、独立分支、一波一分支」执行:

| 批次 | 内容 | 前置 |
|------|------|------|
| 第 1 批(P0,随 Kiosk 75 屏前台开发同批) | **G1 线下招聘机构 Admin 管理闭环**(模型 + 审核 + 目录 + 资质核验)——74/75 屏前台依赖它才有真数据 | Kiosk 75 屏实现立项 |
| 第 2 批(P0,收费模式启用前) | **G5-1 Admin 订单退款操作入口**(先修订 readonly 守卫并取得用户确认);**G6-1 法务文档版本管理最小版**(配合法务审定 P0 验收) | 支付域 Wave 3 排期、法务审定启动 |
| 第 3 批(P1) | G7 AI 功能键覆盖补齐;G5-2 商用价目项扩展;G2 百宝箱生产验收 + 首页动态专区端到端验收;Partner 场馆导览配置入口(既有 P1) | 商用定价拍板 |
| 第 4 批(P2) | G3 待机屏 AI 海报二期与素材审核流;G4 Partner 活动申请入口;G6-2 FAQ 管理页;会话超时可配 | 真实运营数据证明必要 |

每批开工前按 CLAUDE.md §8.1 写明任务边界(允许 / 禁止修改文件、验证门禁),并同步 `docs/progress/current-progress.md` 与 `next-tasks.md`。

---

## 附:待核实项汇总

- G1:终端与机构门店「直线距离」的计算来源(终端定位配置是否已有字段)。
- G3:ad-assets 是否已有独立审核状态字段(本次盘点未见「审核」相关 UI)。
- G7:job_fit / 模拟面试 / 职业规划当前模型凭证的实际配置来源(环境变量或共享管线)。
- G8:会话超时时长是否有运营侧可配诉求。
