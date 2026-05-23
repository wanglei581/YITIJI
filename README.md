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

## 当前阶段

**第 0 阶段：项目初始化**（进行中）

- [x] 文档体系建立
- [ ] monorepo 项目结构搭建
- [ ] React + Vite + TypeScript 初始化
- [ ] 设计系统建立
