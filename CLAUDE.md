# AI求职打印服务终端开发说明

## 1. 项目定位

项目名称：AI求职打印服务终端

本项目不是自营招聘平台，不做企业招聘闭环。  
当前公司暂无人力资源服务许可证，因此产品边界必须控制清楚。

核心定位：

AI求职打印服务终端 = AI简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 线下一体机运营后台。

用户主要在 21.5 寸触控一体机上使用，也兼容手机和桌面浏览器。

## 2. 不能做的功能

当前阶段禁止设计以下功能：

1. 平台内一键投递
2. 平台内收取求职者简历给企业
3. 企业端候选人筛选
4. 企业端面试邀约
5. 企业端 Offer 管理
6. 候选人推荐给企业
7. 自营网络招聘闭环
8. 企业自主发布岗位并直接收简历

岗位和招聘会只能作为第三方/官方来源信息入口。

按钮文案必须使用：

- 查看岗位
- 去来源平台投递
- 扫码投递
- 查看招聘会
- 去来源平台预约
- 扫码预约

不要使用：

- 一键投递
- 立即投递
- 平台投递
- 企业收简历
- 候选人管理

## 3. 已确定硬件

打印机型号：奔图 CM2800/CM2820 系列彩色激光多功能一体机  
Windows 驱动识别名称（真机确认）：`Pantum CM2800ADN Series`

> 代码和配置文件中必须使用可配置项 `printerName`，**禁止硬编码任何具体型号字符串**。

### 硬件能力（已确认）

- 黑白激光打印
- 彩色激光打印
- A4 幅面（不支持 A3）
- 自动双面打印
- 复印
- 扫描
- USB / 有线网络（无 WiFi）
- 50 页 ADF 自动输稿器
- U盘打印
- 扫描到 PC / Email / FTP / U盘 / SMB
- 支持 PDF、PDF/A、OFD、JPEG、PNG、TIFF 等扫描格式

### 硬件能力 vs 开放打印 API 能力（必须分开描述）

硬件支持彩色打印，**不代表**奔图开放打印 API 的彩色参数已确认可用。

| 能力 | 硬件（本地驱动，Phase 8.1 主方案） | Pantum 开放打印 API（未来预留） |
|------|-----------------------------------|-------------------------------|
| 黑白打印 | ✅ 已确认 | ✅ `mode:"bw"` 已确认 |
| 彩色打印 | ✅ 硬件支持，Phase 8.1 驱动控制待真机验证 | ⚠️ TODO：彩色 mode 取值待奔图厂家确认 |
| 自动双面 | ✅ 硬件支持，Phase 8.1 DEVMODE 控制待验证 | ⚠️ 待确认 |
| 份数控制 | ✅ 已验证 | ✅ copies 字段已确认 |

### Pantum 开放打印 API 安全规则（服务端必须遵守）

签名算法（不是 HMAC，是 MD5）：
```
sign = md5Hex(body + "&nonce=" + nonce + "&timeStamp=" + timeStamp + "&" + appSecret).toUpperCase()
```

- `appKey` 放 Header，**不参与签名**
- `appSecret` **只允许保存在后端**，Kiosk / Agent / 前端不得保存
- 回调必须验签；timeStamp 建议限制 5 分钟窗口；nonce 必须防重放；回调处理必须幂等

### 注意事项

1. 不要假设支持 A3。
2. 不要假设开放打印 API 可以云端远程发起扫描（该机器无云打印能力）。
3. 云打印架构：云端任务队列 → Windows Agent 主动 claim → 本地驱动打印（不是打印机自己云打印）。
4. 扫描功能应设计为：
   - Windows 本地终端调用扫描驱动（TWAIN/WIA）；
   - 或打印机扫描到 SMB/FTP 文件夹，系统监听；
   - 或用户扫描到 U盘后上传。

## 4. 秒哒旧项目使用方式

秒哒旧项目只作为参考库，不作为正式工程继续开发。

可以参考：

- 页面功能结构
- 首页业务入口
- 打印扫描流程
- 管理员后台模块
- 合作机构后台模块
- 部分卡片和状态样式

不要直接照搬：

- 秒哒生成的路由结构
- 秒哒生成的重复样式
- 混乱的 Mock 数据
- 旧的企业端后台
- AI工具箱旧结构
- 大面积渐变和毛玻璃风格

正式项目应从新项目重新搭建。

## 5. 推荐技术栈

前端：

- React
- Vite
- TypeScript
- Tailwind CSS
- shadcn/ui
- lucide-react

后端：

- NestJS 或 FastAPI
- PostgreSQL
- Redis
- BullMQ / 任务队列
- 对象存储：MinIO / 阿里云 OSS / 腾讯 COS

终端本地服务：

- Windows Terminal Agent
- 可用 Node.js / .NET / Python 开发
- 负责打印机、扫描仪、U盘、扫码器、摄像头等硬件交互
- **必须在 Windows 10/11 x64 上独立运行，不依赖 macOS 环境**

跨平台工具（第 0 阶段必须引入）：

- `rimraf`：跨平台删除目录（替代 `rm -rf`）
- `cross-env`：跨平台环境变量设置（替代 `export VAR=xxx`）
- `concurrently` 或 `turbo`：跨平台并行启动多应用

## 6. 推荐项目结构

```text
ai-job-print-terminal/
  apps/
    kiosk/              # 一体机前台
    admin/              # 管理员后台
    partner/            # 合作机构后台
    terminal-agent/     # Windows 本地终端 Agent

  services/
    api/                # 后端 API
    worker/             # 打印任务、AI任务、同步任务

  packages/
    ui/                 # 公共 UI 组件
    shared/             # 公共类型和工具函数

  docs/
    product/
    api/
    device/
    design/
    compliance/
    progress/

  legacy-miaoda/
    screenshots/
    exported-code/
```

## 7. 跨模型接力规则

不要新增独立的 handoff / 交接记录文件。本项目的进度、需求和合规边界只写入现有正式文档，避免 Claude、Codex、Mavis 或 Windows 端读取到互相矛盾的临时文档。

每次换设备、换模型或恢复上下文时，先读取：

1. `CLAUDE.md` 或 `AGENTS.md`
2. `docs/progress/current-progress.md`
3. `docs/progress/next-tasks.md`
4. `docs/product/feature-scope.md`
5. `docs/compliance/compliance-boundary.md`

记录保存规则：

- 当前阶段、已完成内容、下一步任务：写入 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`
- Claude 当日开发摘要、协作收尾、demo 链路：写入 `docs/progress/today-claude.md`
- 删除、清理、移除页面或文件：必须写入 `docs/progress/current-progress.md` 的更新记录，并保留 Git commit
- 合规边界、角色边界、长期产品约束：写入 `docs/compliance/` 或 `docs/product/`
- 不把完整聊天记录写入仓库；只沉淀可执行结论、验证结果和关键决策

聊天记录、截图、临时总结只能作为辅助背景，不作为需求来源。若文档状态和代码实现不一致，先执行审查与验证，更新正式进度文档后再继续开发。

## 8. 页面风格要求

整体风格：

真实、克制、清晰、可信赖、触控友好。

不要做成：

- AI创业官网
- 大量渐变卡片
- 每个模块都发光
- 毛玻璃堆叠
- 大圆角卡片堆砌
- 只有入口没有业务状态的假页面

前台一体机风格：

- 大按钮
- 少层级
- 路径短
- 状态明确
- 适合 21.5 寸触控屏
- 主按钮触控区域不小于 56px
- 所有可点击区域不小于 48px

后台风格：

- 专业运营系统
- 左侧菜单
- 顶部搜索/通知/账号
- 表格
- 筛选
- 状态标签
- 详情抽屉
- 日志
- 告警
- 权限

合作机构后台风格：

- 数据管理工具
- 上传、同步、审核、外部链接管理
- 不做企业招聘端视觉

## 9. 设计系统要求

开发前先建立 design system，不要直接写页面。

需要定义：

- 色彩系统
- 字体系统
- 间距系统
- 圆角系统
- 阴影系统
- 按钮规范
- 卡片规范
- 状态标签规范
- 表格规范
- 表单规范
- 空状态
- 加载状态
- 错误状态
- 暗黑模式规范

建议：

- 主色：科技蓝
- 成功：绿色
- 警告：橙色
- 错误：红色
- 背景：浅灰
- 卡片：白底 + 1px 边框 + 轻阴影
- 卡片圆角：8px - 12px
- 不使用 emoji 作为图标
- 统一使用 lucide-react 图标

## 9. 核心页面范围

### 一体机前台

**首页**
- AI简历服务
- 打印扫描
- 岗位信息
- 招聘会信息
- 政策服务
- 我的记录
- 设备状态

**AI简历服务**
- 简历上传
- 纸质简历扫描
- AI解析
- AI诊断
- 简历优化
- 简历打印

**打印扫描**
- 上传文件
- 扫码上传
- U盘导入
- 扫描原件
- 打印预览
- 打印参数
- 确认打印
- 打印进度
- 完成反馈

**岗位信息**
- 第三方岗位列表
- 岗位详情
- 来源机构
- 同步时间
- 外部ID
- 去来源平台投递
- 扫码投递

**招聘会信息**
- 招聘会列表
- 招聘会详情
- 来源机构
- 外部预约入口
- 展位导览
- 活动资料打印

**AI助手**
- 自然语言咨询
- 引导用户跳转功能
- 简历建议
- 打印帮助
- 政策问答

**我的**
- 我的简历
- 我的文档
- 打印订单
- AI服务记录
- 外部岗位浏览/跳转记录
- 招聘会预约记录
- 账号设置

### 管理员后台

- 工作台
- 终端管理
- 打印机管理
- 外设管理
- 订单管理
- 文件管理
- AI服务管理
- 岗位信息源
- 招聘会信息源
- 合作机构管理
- 用户管理
- 告警中心
- 权限管理
- 日志审计

### 合作机构后台

- 工作台
- 机构资料
- 岗位信息管理
- 招聘会信息管理
- 政策公告管理
- 终端数据
- 数据统计
- 数据源管理
- 同步日志
- 账号权限

## 10. 数据边界

所有外部岗位和招聘会数据必须包含：

- source_org_id
- external_id
- source_name
- source_url
- sync_time
- review_status
- publish_status

岗位详情必须展示：

- 来源机构
- 同步时间
- 外部ID
- 外部投递链接
- 数据来源说明

系统只记录：

- 浏览
- 收藏
- 外部跳转
- 打印
- AI服务调用

系统不记录企业筛选结果，不保存企业端招聘闭环数据。

## 11. 文件安全要求

用户文件包括：

- 简历 PDF
- 扫描文件
- 证件照
- 身份证复印件
- 求职材料

要求：

- 文件使用临时签名 URL。
- 敏感文件设置有效期。
- 支持自动清理。
- 管理员访问文件必须记录日志。
- 不长期保存身份证、简历等敏感文件。
- 文件删除后需要保留删除日志。

## 12. 打印接口安全要求

奔图 appKey / appSecret 只能保存在服务端。

禁止：

- 前端保存 appSecret
- 前端生成奔图 API 签名
- 文件 URL 长期公开
- 回调不验签
- 回调不做幂等

要求：

- 服务端生成奔图 API 签名。
- 接收回调时必须验签。
- 回调处理必须幂等。
- 打印文件必须使用临时签名链接。
- 打印任务状态必须落库。
- 所有管理员操作记录日志。

## 13. 开发顺序

### 第 0 阶段：项目初始化

目标：搭建干净工程。

任务：

- 创建 monorepo 项目结构（pnpm workspace 或 Turborepo）
- 初始化 React + Vite + TypeScript
- 初始化 Tailwind CSS
- 初始化 shadcn/ui
- 初始化 ESLint / Prettier
- 建立 docs 文档目录
- 创建 CLAUDE.md
- 创建 .env.example
- 引入跨平台工具：rimraf、cross-env、concurrently

跨平台要求（第 0 阶段强制）：

- `package.json` scripts 不能包含 `rm -rf`、`cp -r`、`export VAR=xxx` 等 Unix 专用命令
- 删除目录使用 `rimraf`
- 设置环境变量使用 `cross-env`
- 并行启动多个应用使用 `concurrently` 或 `turbo`
- 所有文件路径处理使用 `path.join` / `path.resolve`，不硬编码 `/Users/...` 或 `C:\...` 绝对路径
- 环境变量必须通过 `.env` / `.env.example` 管理，不写死本机路径

验收：

- 项目可以在 macOS 和 Windows 上同样启动
- 页面能正常访问
- 基础布局可用
- `npm run dev`（或 pnpm）命令在 Windows 上不报错

### 第 1 阶段：设计系统

目标：先定 UI 规范。

任务：

- 建立颜色 token
- 建立字体规范
- 建立按钮规范
- 建立卡片规范
- 建立表格规范
- 建立状态标签规范
- 建立空状态/加载/错误状态
- 建立暗黑模式基础

验收：

- 不直接写业务页面
- 先完成公共 UI 规范和组件

### 第 2 阶段：公共组件

目标：提高复用，避免页面混乱。

组件：

- KioskLayout
- AdminLayout
- PartnerLayout
- PageHeader
- MetricCard
- StatusBadge
- DeviceStatusCard
- DataTable
- ActionBar
- ConfirmDialog
- EmptyState
- LoadingState
- ErrorState

验收：

- 所有后续页面必须使用公共组件
- 不允许页面里大量重复样式

### 第 3 阶段：一体机前台

优先开发：

- 首页
- 打印扫描
- AI简历服务
- 我的

验收：

- 适配 21.5 寸触控屏
- 按钮足够大
- 操作路径不超过 3 步
- 有设备状态
- 有空状态和错误状态

### 第 4 阶段：岗位和招聘会信息

开发：

- 岗位信息列表
- 岗位详情
- 招聘会列表
- 招聘会详情
- 外部投递/预约跳转
- 二维码展示

验收：

- 展示来源机构
- 展示同步时间
- 展示外部ID
- 不出现一键投递
- 不出现平台内收简历

### 第 5 阶段：管理员后台

开发：

- 工作台
- 终端管理
- 打印机管理
- 订单管理
- 文件管理
- AI服务管理
- 告警中心
- 日志审计

验收：

- 后台像真实管理系统
- 表格可筛选
- 状态清晰
- 有详情抽屉
- 有操作日志

### 第 6 阶段：合作机构后台

开发：

- 工作台
- 机构资料
- 岗位信息管理
- 招聘会信息管理
- 数据源管理
- 同步日志
- 数据统计
- 账号权限

验收：

- 不做候选人管理
- 不做简历筛选
- 不做面试邀约
- 只做外部资源数据管理

### 第 7 阶段：后端 API

开发：

- 用户登录
- 文件上传
- 打印任务
- 设备状态
- 外部岗位数据
- 外部招聘会数据
- 合作机构数据源
- 日志审计
- 权限系统

接口统一使用：`/api/v1`

### 第 8 阶段：Windows Terminal Agent

开发：

- 开机自启动
- 拉取打印任务
- 调用打印机驱动
- 监听扫描目录
- 监听 U盘
- 上报终端心跳
- 上报打印机状态
- 上报告警

验收：

- Windows 一体机可以真实打印
- 可以扫描生成 PDF
- 可以上报在线/离线/故障状态

## 14. 每次开发要求

Claude Code 每次开发前必须：

1. 先阅读 `CLAUDE.md`
2. 先阅读 `docs/product/feature-scope.md`
3. 确认当前模块是否涉及合规边界
4. 不擅自新增企业招聘闭环功能
5. 不擅自改产品定位

每次开发后必须：

1. 运行 lint
2. 检查页面是否能打开
3. 检查移动端和大屏布局
4. 检查按钮文案是否合规
5. 记录更新到 `docs/progress/current-progress.md`

## 15. 当前前期开发记录摘要

已经确认（产品定位与硬件，长期不变）：

- 项目定位为 AI求职打印服务终端，不是招聘平台。
- 底部导航：首页、AI助手、我的。AI工具箱不作为一级导航。
- 当前首页与各业务板块里的功能入口已经定版；后续只做已有入口真实化、页面接真、按钮接线、状态补齐和「我的」数据闭环，不新增重复入口 / 同义卡片。详见 `docs/product/user-data-flow-matrix.md`。
- 企业招聘端删除；合作机构后台只做数据与运营后台；管理员后台管理整个终端运营体系。
- 打印机：奔图 CM2800/CM2820 系列彩色激光多功能一体机，Windows 驱动识别名 `Pantum CM2800ADN Series`，代码必须通过 `printerName` 配置项指定。
- 岗位/招聘会只做第三方/官方来源信息入口。
- 秒哒旧项目作为参考库，不作为正式工程继续开发。

当前阶段（2026-06-12，**写完代码改这里 + docs/progress/current-progress.md**）：

- Phase 1–7（设计系统、前台、后台、合作机构、API 设计、AI Provider 骨架、岗位/招聘会真实 API）全部完成
- **Phase 8 全部封板（2026-05-29）**：Phase 8.0 Spike / 8.1A–D Windows 真机出纸 / 8.2A Prisma 跨机 / 8.2B WMI 状态 / 8.2C 安全加固，全部 Mac 真实后端跨机 E2E 通过
- **W1/W2/W3 stacked 分支已 FF 合入 main（2026-06-01，`3f35caa`）**：
  - W1：BE-1 文件签名 + Kiosk 上传 + K2 简历四步流 + ReactDiffViewer
  - W2：BE-7 JobFair 8 端点切真 Prisma + audit + 校企合作详情端点
  - W3：JobSource 凭证加密落库（AES-256-GCM）+ Webhook 接收端（HMAC + 5min 时间窗 + nonce LRU 防重放）+ Partner /sources 三轨入口（API/Webhook/Excel）+ Phase 7.11 R4 类型对齐 `packages/shared/PartnerDataSourceView`
- E2E demo（Partner → Webhook → Admin 审核 → Kiosk 展示）已跑通；防重放/错签名 401、候选人字段注入 400、webhookSecret 创建后 GET 不再回显 全部通过
- **阶段1 三端数据打通 1A–1F 已完成（2026-06-10）**：Admin 招聘会/合作机构/订单告警、Partner 编辑与政策公告、Kiosk 招聘会与校园招聘新版 UI 均已接真。
- **阶段2 已完成（2026-06-10 ~ 2026-06-12）**：AI 简历生成 MVP、AI 简历优化真实化、真实模型联调 + 安全收口、招聘会场馆导览图、C-2D 会员资产中心真实管理、2C 模拟面试 + 2C+ 语音增强、2D 岗位匹配参考。
- **Stage 3 真实 OCR 已完成（2026-06-11，百度智能云）**：图片简历与扫描版 PDF（受控 ≤3 页）经 `OCR_PROVIDER=baidu` 真实识别进诊断闭环；低置信度报告页提示复核；OCR 失败不调 LLM；密钥仅服务端、原文不落日志。**上线前须在百度控制台重建应用轮换密钥（曾在聊天暴露）。**
- **第四阶段 PostgreSQL 生产数据底座已完成（2026-06-12）**：`@prisma/adapter-pg`、PG schema 机械同步、干净 `0_init` 基线、空库 deploy、SQLite→PG 迁移演练、`postgres-readiness` CI 守门均已通过；Windows 生产实例仍需部署复验后再宣称生产就绪。
- **AI 数字人主体已完成**：Kiosk `/assistant` 为 TRTC 真人照片顾问「小青」+ 文字对话；早期 3D/SVG 数字人引导员方案已被实际方案取代，不再作为下一步重做。

## 16. 当前最高优先级

**P0（next）：**

- 先按 `docs/product/user-data-flow-matrix.md` 审查首页入口 ↔「我的」数据归属 ↔ 操作闭环，禁止继续堆重复入口。（P0-闭环「模拟面试记录接入『我的』AI服务记录口径」已于 2026-06-12 完成）
- 2E 职业规划建议：**真实化现有「职业规划」入口**，结果进入 AI服务记录 / 我的文档 / 打印订单；不新增「职业规划建议」卡片。
- 择期补：场馆导览 Partner 配置入口 / 展厅平面图图片

**已完成（保留作为基线）：**

- 一体机首页 / 打印扫描核心流程 / 管理员后台基础框架 / 岗位/招聘会外部来源展示
- AI简历服务 / 合作机构后台 P0 / 数据源同步骨架（W3 Webhook、Excel 字段映射、BullMQ API 拉取 worker 均已落地）
- Windows Terminal Agent（Phase 8 全部封板，含 DPAPI/SQLite/WMI/单实例/断网重试/Windows 服务）
- 待机宣传屏一期（`feature/kiosk-screensaver-ads`）：管理员上传图/视频 + 播放方案 + 终端配置；Kiosk 无操作进入全屏轮播、触摸唤醒、忙碌态豁免。AI 文生图为二期（一期 stub，`AI_IMAGE_PROVIDER=disabled`，零外部费用）。详见 docs/progress/current-progress.md
- Excel 字段映射 service 层接入、BullMQ API 拉取 worker、Phase 9.1–9.5 AI 助手/数字人相关收口均已完成或被新方案替代；不要按旧待办重复开发。

**P1（择期）：**

- 文件自动清理调度（清理策略骨架已具备）
- 打印任务状态实时追踪 UI（后端持久化已就绪）
- 奔图开放打印 API 对接（云打印彩色 mode 取值仍 TODO，待厂家确认）

**P2：**

- 扫描目录监听 / 告警中心 / 数据统计报表

## 17. 跨平台运行要求

### 运行环境说明

| 环境 | 用途 |
|------|------|
| macOS | 开发环境（VS Code / Claude Code / Codex） |
| Windows（服务器/云） | 前端应用和后台管理系统的运行和访问 |
| Windows 一体机 | 一体机前台页面 + Terminal Agent 硬件交互 |

### 代码层面要求

1. **路径处理**：所有文件路径必须使用 `path.join()` / `path.resolve()`，不允许硬编码 `/Users/...`、`C:\...` 等绝对路径。
2. **环境变量**：使用 `.env` 和 `.env.example`，不写死本机路径或密钥。
3. **npm scripts**：禁止使用以下 Unix 专用命令：
   - `rm -rf` → 改用 `rimraf`
   - `cp -r` → 改用 `cpx` 或 Node.js 脚本
   - `export VAR=xxx` → 改用 `cross-env`
   - `&&` 连接命令时注意 Windows 兼容性
4. **并行启动**：多应用并行启动使用 `concurrently` 或 `turbo`。
5. **换行符**：配置 `.gitattributes`，统一使用 LF（`* text=auto eol=lf`）。

### 一体机前台 Kiosk 模式

一体机前台页面必须支持在 Windows Edge / Chrome 全屏 Kiosk 模式下运行：

- 不依赖系统通知、系统剪贴板等需要权限的浏览器 API
- 触控事件优先于鼠标事件
- 不出现系统级弹窗（如浏览器文件选择框）阻断流程
- 必要时通过 Terminal Agent 中转文件操作

### Terminal Agent 要求

Windows Terminal Agent 后续单独开发（第 8 阶段），须遵守：

- 不依赖任何 macOS 专有 API 或命令
- 可以在 Windows 10/11 x64 上独立运行和自启动
- 与后端 API 通过 HTTP/WebSocket 通信，不直接访问数据库
- 详见：[docs/device/terminal-agent-windows.md](docs/device/terminal-agent-windows.md)

## 18. 外部数据源接入架构

详细设计见：`docs/product/external-data-source-design.md`

核心设计原则：

1. **统一数据模型**：所有外部数据源通过 `DataSourceConfig` + 字段映射，标准化为 `ExternalJob` / `ExternalJobFair`
2. **双维度分类**：`sourceKind`（来源种类）× `accessMode`（接入方式），不再使用扁平的 `DataSourceType`
3. **审核流程**：所有外部数据默认 `reviewStatus: pending`，需管理员审核（→ reviewing → approved / rejected）后才能展示
4. **发布状态独立**：`publishStatus` 与审核状态解耦，取值 `draft / published / unpublished / expired`
5. **合作机构自主管理**：partner 后台提供数据源接入 UI，不需要懂技术也能配置
6. **服务端保存凭证**：`apiSecret` / `accessToken` 等敏感信息只存服务端，**禁止出现在前端共享类型**；前端只读 `credentialConfigured: boolean` 判断是否已配置

类型约束（`packages/shared/src/types/job.ts`）：

- `ReviewStatus`: `'pending' | 'reviewing' | 'approved' | 'rejected'`
- `PublishStatus`: `'draft' | 'published' | 'unpublished' | 'expired'`
- `SourceKind`: `'job_platform' | 'hr_company' | 'school' | 'fair_organizer' | 'aggregator' | 'manual'`
- `AccessMode`: `'api' | 'excel' | 'csv' | 'json' | 'webhook' | 'manual'`
- `AuthType`: `'bearer' | 'oauth2' | 'api_key' | 'basic' | 'custom'`（禁止写 `key`）

合规边界（所有数据源接入必须遵守）：

- 只接入岗位/招聘会**公开或授权**的展示信息
- **不接收求职者简历**，不同步候选人数据
- **不提供**企业筛选、面试邀约、Offer 管理功能
- 所有导入数据默认 `reviewStatus: pending`，管理员审核通过后才展示

当前优先级：

- [x] DataSourceConfig / SourceKind / AccessMode / ReviewStatus / PublishStatus 类型定义
- [x] ImportBatch / ImportRecord / FieldMappingRule / MappingValidationError 类型定义
- [x] 合作机构后台数据源管理页面（Phase 6 P0）
- [x] 同步日志展示（Phase 6 P0）
- [ ] Excel 导入 + 字段映射 UI（Phase 6 P1）
- [ ] 字段映射引擎（服务端）
- [ ] 管理员后台审核页面

## 19. 重要提醒

不要追求一次性做完全部功能。

正确节奏：

> 先做干净架构 → 再做设计系统 → 再做核心页面 → 再接后端 → 再接打印机 → 再上线测试。

- 不要在旧秒哒项目里继续堆功能。
- 不要把秒哒导出的代码作为正式主项目。
