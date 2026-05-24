# AI求职打印服务终端

AI简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 线下一体机运营后台。

**本项目不是招聘平台**，不做企业招聘闭环。

---

## 目录结构

```
AI求职打印服务终端/
  CLAUDE.md              # 给 Claude Code 的项目说明
  AGENTS.md              # 给 Codex 的项目说明
  README.md

  apps/
    kiosk/               # 一体机前台（React + Vite + TypeScript）
    admin/               # 管理员后台
    partner/             # 合作机构后台
    terminal-agent/      # Windows 本地 Agent（打印机/扫描仪硬件交互）

  services/
    api/                 # 后端 API（NestJS 或 FastAPI）
    worker/              # 打印/AI/同步任务队列

  packages/
    ui/                  # 公共 UI 组件
    shared/              # 公共类型和工具函数

  docs/
    product/             # 产品定位、功能范围
    design/              # 页面风格、设计系统规范
    device/              # 奔图 CM2820ADN、硬件资料
    api/                 # 接口文档
    compliance/          # 合规边界（必读）
    progress/            # 当前进度、下一步任务
    decisions/           # 重要决策记录
    reviews/             # Codex 审查记录

  legacy-miaoda/
    screenshots/         # 秒哒截图（仅参考）
    exported-code/       # 秒哒导出代码（仅参考，不用于开发）
```

---

## AI 协作

| AI | 职责 |
|----|------|
| Claude Code | 主力开发（apps/、services/、packages/） |
| Codex | 方案审查、需求整理、UI/UX 审查、docs/ 维护 |

两者共用同一 Git 仓库，不分叉副本。  
协作规则：[docs/decisions/ai-collaboration-rules.md](docs/decisions/ai-collaboration-rules.md)

---

## 关键文档

| 文档 | 说明 |
|------|------|
| [CLAUDE.md](CLAUDE.md) | 完整开发说明（Claude Code 必读） |
| [AGENTS.md](AGENTS.md) | 简洁项目说明（Codex 必读） |
| [docs/product/feature-scope.md](docs/product/feature-scope.md) | 功能范围和优先级 |
| [docs/compliance/compliance-boundary.md](docs/compliance/compliance-boundary.md) | 合规边界（开发前必读） |
| [docs/device/pantum-cm2820adn.md](docs/device/pantum-cm2820adn.md) | 打印机设备文档 |
| [docs/progress/current-progress.md](docs/progress/current-progress.md) | 当前进度 |
| [docs/progress/next-tasks.md](docs/progress/next-tasks.md) | 下一步任务 |

---

## 运行环境

| 环境 | 说明 |
|------|------|
| macOS | 开发环境（VS Code / Claude Code / Codex） |
| Windows（服务器/云） | 前端应用和后台管理系统访问 |
| Windows 一体机 | 运行前台页面 + Terminal Agent 硬件交互 |

---

## macOS 开发说明

**环境要求：**

- Node.js ≥ 20
- pnpm ≥ 9（推荐）或 npm ≥ 10
- Git

**启动开发服务器：**

```bash
# 安装依赖（首次）
pnpm install

# 同时启动所有前端应用
pnpm dev

# 只启动一体机前台
pnpm --filter kiosk dev

# 只启动管理员后台
pnpm --filter admin dev

# 只启动合作机构后台
pnpm --filter partner dev
```

**注意：** 所有 npm scripts 已配置跨平台兼容，使用 `rimraf`、`cross-env`、`concurrently`，在 Windows 上同样可以运行。

---

## Windows 运行说明

前端应用和后台管理系统均可在 Windows 上正常运行和访问：

**方式 A：通过浏览器访问已部署服务**

直接在 Windows Chrome / Edge 中访问部署好的 URL 即可，无需本地启动。

**方式 B：Windows 本地开发启动**

```powershell
# 安装依赖
pnpm install

# 启动开发服务器（同 macOS 命令，跨平台兼容）
pnpm dev
```

**注意事项：**

- 不要在 Windows 上手动执行 `rm -rf` 或 `export` 等 Unix 命令
- 所有 scripts 已使用 `rimraf` / `cross-env` 处理跨平台兼容
- 建议使用 Windows Terminal + PowerShell 7

---

## Windows 一体机部署说明（占位）

> 本节待第 3 阶段（一体机前台开发完成）后详细补充。

**目标架构：**

```
Windows 一体机
  ├── Chrome / Edge（Kiosk 模式）
  │     └── 访问一体机前台页面（apps/kiosk）
  └── Terminal Agent（后台服务）
        ├── 与打印机通信（奔图 CM2820ADN 驱动）
        ├── 监听扫描目录 / U盘
        ├── 与后端 API 通信（HTTP/WebSocket）
        └── 上报设备心跳和告警
```

**Terminal Agent 文档：** [docs/device/terminal-agent-windows.md](docs/device/terminal-agent-windows.md)

---

## 当前阶段

**第 0 阶段：项目初始化**（进行中）

- [x] 文档体系建立
- [x] 跨平台要求明确
- [ ] monorepo 项目结构搭建
- [ ] React + Vite + TypeScript 初始化
- [ ] 设计系统建立
