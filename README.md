# AI求职打印服务终端

面向线下就业服务场景的自助一体机系统：**AI 简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 运营后台**。

主要终端形态为 27 寸竖屏触控一体机（1080×1920），同时兼容手机与桌面浏览器。

> **本项目不是招聘平台。** 不做企业招聘闭环：不提供平台内投递、不代收简历给企业、不做候选人筛选 / 面试邀约 / Offer 管理。
> 岗位与招聘会一律只作为**第三方 / 官方来源的信息入口**。详见 [合规边界](docs/compliance/compliance-boundary.md)。

---

## 当前状态

| 项 | 状态 |
|---|---|
| Phase 1–8 | 已封板（设计系统、一体机前台、管理员后台、合作机构后台、后端 API、AI 能力、岗位/招聘会真实接口、Windows Terminal Agent） |
| 生产环境 | 已部署至 `zyidai.cn`（nginx + HTTPS，API 在线，数据库为 PostgreSQL） |
| 持续部署 | main 分支 CI 全绿后自动部署（`.github/workflows/deploy.yml`，仅发布 Kiosk 前端） |
| 微信小程序 | M0 阶段进行中（四 Tab 骨架、登录、公开浏览页已合入） |
| 上线验收 | **进行中，尚未对外服务**。逐项进度见 [上线验收清单](docs/device/production-deployment-and-windows-host-checklist.md) |

> 实时进度以 [docs/progress/current-progress.md](docs/progress/current-progress.md) 为唯一信源；本表只作概览。
>
> 已知上线前阻塞：生产库岗位 / 招聘会 / 政策内容为空；API 发布路径尚未纳入自动化；法务文本与部分生产密钥待确认。

---

## 技术栈

**前端**：React · Vite · TypeScript · Tailwind CSS · shadcn/ui · lucide-react
**后端**：NestJS · Prisma · PostgreSQL · Redis · BullMQ
**对象存储**：腾讯云 COS
**终端硬件**：Windows Terminal Agent（打印机 / 扫描仪 / U盘 / 扫码器交互）
**包管理**：pnpm 11 workspace（monorepo）

---

## 目录结构

```
apps/
  kiosk/               # 一体机前台（主终端，1080×1920 竖屏触控）
  admin/               # 管理员后台（终端、订单、文件、AI、告警、审计）
  partner/             # 合作机构后台（数据源、岗位/招聘会信息管理）
  miniapp/             # 微信小程序唯一发布源（原生）
  terminal-agent/      # Windows 本地 Agent（硬件交互，独立运行于 Win10/11 x64）

services/
  api/                 # 后端 API（NestJS，接口前缀 /api/v1）
  worker/              # 打印任务、AI 任务、数据同步队列

packages/
  ui/                  # 公共 UI 组件
  shared/              # 公共类型与工具函数
  refresh/             # 刷新/同步相关包

docs/
  product/             # 产品定位与功能范围
  compliance/          # 合规边界（开发前必读）
  device/              # 硬件、部署与验收清单
  design/              # 设计原型与视觉方案
  progress/            # 当前进度与下一步任务
  api/ business/ decisions/ governance/ operations/ reviews/ acceptance/ patent/
```

目录职责索引：[docs/project-structure.md](docs/project-structure.md)

---

## 硬件

打印机：**奔图 CM2800/CM2820 系列**彩色激光多功能一体机
Windows 驱动识别名（真机确认）：`Pantum CM2800ADN Series`

能力：黑白 / 彩色激光打印、A4（不支持 A3）、自动双面、复印、扫描、50 页 ADF、U盘打印、扫描到 PC/Email/FTP/U盘/SMB。

> 代码与配置中必须使用可配置项 `printerName`，**禁止硬编码具体型号字符串**。

---

## 本地开发

**环境要求**：Node.js ≥ 20 · pnpm 11（见 `packageManager`）· Git

```bash
pnpm install          # 安装依赖
pnpm dev              # 并行启动前端应用
pnpm dev:kiosk        # 只启动一体机前台
pnpm dev:admin        # 只启动管理员后台
pnpm dev:partner      # 只启动合作机构后台
```

**质量门禁**：

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm verify:compliance-copy       # 合规文案禁词扫描
pnpm verify:dependency-security   # 依赖安全检查
```

---

## 跨平台要求

项目须在 macOS 开发、Windows 运行，因此：

- npm scripts 禁止 `rm -rf` / `cp -r` / `export VAR=xxx`，统一使用 `rimraf`、`cross-env`、`concurrently`
- 路径一律用 `path.join()` / `path.resolve()`，不硬编码 `/Users/...` 或 `C:\...`
- 换行符统一 LF（`.gitattributes`）
- Terminal Agent 不依赖任何 macOS 专有 API，可在 Windows 10/11 x64 独立运行与自启动

| 环境 | 用途 |
|------|------|
| macOS | 开发 |
| Linux 服务器 | 生产部署（nginx + API + PostgreSQL + Redis） |
| Windows 一体机 | Kiosk 全屏前台 + Terminal Agent 硬件交互 |

---

## 合规红线

用户可见按钮文案只允许：`查看岗位` / `去来源平台投递` / `扫码投递` / `查看招聘会` / `去来源平台预约` / `扫码预约`。

禁止出现：一键投递、立即投递、平台投递、企业收简历、候选人管理。

其他长期约束：

- 所有外部岗位/招聘会数据须带 `source_org_id`、`external_id`、`source_name`、`source_url`、`sync_time`、`review_status`、`publish_status`，默认 `pending` 待管理员审核后才展示
- 只记录浏览 / 收藏 / 外部跳转 / 打印 / AI 服务调用，**不记录投递或预约结果**
- 不伪造能力：没有真实数据、接口、硬件状态或保存结果时，页面不得显示已完成、已保存、已打印、设备正常
- 敏感文件使用临时签名 URL + 有效期 + 自动清理；管理员访问文件必须留日志
- 打印接口 `appKey` / `appSecret` 只存服务端，回调必须验签且幂等

完整口径：[docs/compliance/compliance-boundary.md](docs/compliance/compliance-boundary.md)

---

## 关键文档

| 文档 | 说明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 完整开发说明（Claude Code 必读） |
| [AGENTS.md](AGENTS.md) | 项目说明（Codex 必读） |
| [docs/compliance/compliance-boundary.md](docs/compliance/compliance-boundary.md) | 合规边界（开发前必读） |
| [docs/product/feature-scope.md](docs/product/feature-scope.md) | 功能范围与优先级 |
| [docs/progress/current-progress.md](docs/progress/current-progress.md) | 当前进度（唯一信源） |
| [docs/progress/next-tasks.md](docs/progress/next-tasks.md) | 下一步任务 |
| [docs/device/production-deployment-and-windows-host-checklist.md](docs/device/production-deployment-and-windows-host-checklist.md) | 生产部署与换机验收清单 |
| [docs/device/terminal-agent-windows.md](docs/device/terminal-agent-windows.md) | Windows Terminal Agent |
| [docs/project-structure.md](docs/project-structure.md) | 目录职责索引 |

---

## AI 协作

| AI | 职责 |
|----|------|
| Claude Code | 主力开发（apps/、services/、packages/） |
| Codex | 方案审查、需求整理、UI/UX 审查、docs/ 维护 |

共用同一 Git 仓库，不分叉副本。协作规则：[docs/decisions/ai-collaboration-rules.md](docs/decisions/ai-collaboration-rules.md)

进度、需求与合规结论只写入正式文档（`docs/progress/`、`docs/compliance/`、`docs/product/`），不新增独立的 handoff / 交接文件。
