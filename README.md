# AI求职打印服务终端

面向线下就业服务场景的自助一体机系统：**AI 简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 运营后台**。

主要终端形态为 27 寸竖屏触控一体机（1080×1920），同时兼容手机与桌面浏览器。

> **本项目不是招聘平台。** 不做企业招聘闭环：不提供平台内投递、不代收简历给企业、不做候选人筛选 / 面试邀约 / Offer 管理。
> 岗位与招聘会一律只作为**第三方 / 官方来源的信息入口**。详见 [合规边界](docs/compliance/compliance-boundary.md)。

---

## 当前状态

项目仍处于上线前收口，商业上线结论以正式状态表和交付阻塞清单为准，不在 README 复制容易过期的阶段数字。

- 当前阶段与已完成事项：[docs/progress/current-progress.md](docs/progress/current-progress.md) 顶部活动快照。
- 唯一交付阻塞与下一步：[docs/progress/next-tasks.md](docs/progress/next-tasks.md) 顶部清单。
- Miniapp / Kiosk / Admin / Partner / API / Agent 的实现、开放和线上状态：[docs/product/feature-scope.md](docs/product/feature-scope.md) §1.2。
- 生产事实只认服务器 `DEPLOY_SOURCE.txt`、PM2、nginx Web Root 与健康检查；CI 通过不等于已部署。

部署工作流会构建 API、Kiosk、Admin、Partner，但只有 CI 全绿且 `DEPLOY_API_ENABLED=true` 才进入部署；Admin / Partner 未配置各自 Web Root 时保持线上现状。微信小程序唯一发布源是 `apps/miniapp/`，是否上传或发布须单独验收。

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

**环境要求**：Node.js `>=22.13 <23` · pnpm `>=11.2.2 <12`（锁定 `pnpm@11.2.2`）· Git

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

## 本地演示环境（给销售）

一条命令在自己电脑上起一套完整的演示：服务端 + 一体机前台 + 管理员后台 + 机构后台，已灌好演示数据。Windows 10/11 与 macOS 都能用。

**前提（只装一次）**：

1. Node.js 22（22.13 及以上的 22.x）和 pnpm 11.2.2（`npm install -g pnpm@11.2.2`）。
2. Redis 在本机 6379 端口运行：macOS 用 `brew install redis && brew services start redis`；Windows 装 Docker Desktop 后运行 `docker run -d --name demo-redis -p 6379:6379 redis:7-alpine`（或安装 Memurai）。已有别的 Redis 时设置 `DEMO_REDIS_URL`（例如 `redis://127.0.0.1:6380/11`）。演示默认用 11 号库，不碰开发常用的 0 号库。
3. 在仓库根目录运行一次 `pnpm install`。

**启动**：

```bash
pnpm demo          # 体检 → 建演示库 → 灌演示数据 → 起四个服务，最后打印地址与演示账号
                   # 按 Ctrl+C 一次，全部服务一起停止
pnpm demo:sim      # 同上，另开「（演示）模拟打印机」，打印能走到「打印完成」（不会真的出纸）
pnpm demo:reset    # 删除全部演示数据与演示口令；下次 pnpm demo 重新生成
```

**模拟打印机（可选，默认关闭）**：`pnpm demo:sim`（等同 `node scripts/demo/demo.mjs start --sim-printer`，或设置环境变量 `DEMO_SIM_PRINTER=1` 后运行 `pnpm demo`）。它按真实终端程序的协议给演示终端 `DEMO-001` 发心跳、领打印任务、把文件下载下来做 SHA-256 校验、回写任务状态，唯独不调用打印机：每一单只在终端窗口打印一行「（演示）模拟打印机：任务 xxx 已模拟出纸，未真实打印」。**不会真的出纸**，一体机和后台上的「打印完成」都只是模拟结果；后台终端列表的「Agent 版本」一栏会显示「（演示）模拟打印机，不会真实出纸」。

- 模拟缺纸：在仓库的 `.demo` 文件夹里新建一个名为 `sim-printer-paper-empty` 的空文件，约 1 秒后心跳改报缺纸，一体机停止接打印单，管理员后台「告警中心」出现「打印机缺纸」；删掉这个文件即恢复有纸，告警随之消失（告警是按最新心跳实时算出来的）。
- 手机扫码上传的二维码指向 `127.0.0.1`，只有这台电脑自己能打开；真手机扫不到。演示时可在同一台电脑的另一个浏览器窗口打开那个地址代替手机（该窗口不能连到本机演示网桥，否则页面会把自己当成一体机、不让选文件）。

启动一次约 2–4 分钟（服务端要编译）。启动成功后终端会打印四个地址（端口被占时会自动顺延，以终端打印的为准）：

| 服务 | 默认地址 | 登录 |
|---|---|---|
| 一体机前台 | http://127.0.0.1:5373/ | 不用登录，自动以演示终端 `DEMO-001` 身份连上本地服务端 |
| 管理员后台 | http://127.0.0.1:5374/ | 账号 `demo-admin` |
| 机构后台 | http://127.0.0.1:5375/ | 账号 `demo-partner` |
| 服务端 | http://127.0.0.1:3310/api/v1/health | — |

**演示口令在哪**：首次启动时随机生成，打印在终端上，同时写进仓库里的 `.demo/演示账号.txt`。`.demo/` 被 git 忽略，口令不会进仓库；`pnpm demo:reset` 会删掉它，下次启动换一组新口令。

**演示数据**：机构、终端、政策、法务文档、价目说明都带「演示」字样，终端编号以 `DEMO-` 开头。演示库是 `.demo/demo.db`，与开发库 `services/api/prisma/dev.db` 完全分开；上传的文件也只存在 `.demo/storage/`。演示不读 `services/api/.env`，电脑上配过的真实密钥不会被用到。

**已知限制（给客户看之前先知道）**：

- AI 没有接真实服务（`AI_PROVIDER=mock`，不花钱、不需要密钥）：简历诊断返回演示报告，页面标明是演示报告、不基于上传内容；AI 助手对话、模拟面试等需要大模型的功能没有配置模型，会提示暂不可用；数字人、OCR、语音也都未接。
- 没有连接打印机和扫描仪：用 `pnpm demo` 启动时一体机上会如实显示「打印机离线」，不会真的出纸，也不会显示「已打印」；用 `pnpm demo:sim` 启动时由模拟打印机接单，一体机会显示「打印完成」，但同样不会真的出纸。
- 线上支付未开通，走不到付款成功这一步。
- 岗位、招聘会、企业信息按我们云上的口径关闭，一体机上不显示这些入口。
- 一体机按真实终端的规则运行，不弹浏览器文件选择框；U 盘、扫码登录等依赖本机终端程序的功能在演示中不可用。
- 手机号验证码登录：验证码不会发到手机，而是显示在运行 `pnpm demo` 的终端窗口里。
- 一体机首页的品牌区是固定文案，没有「演示」字样；演示标记出现在政策、后台、法务文档等数据上。

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
| [docs/README.md](docs/README.md) | 正式文档、原型和取证导航 |
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
