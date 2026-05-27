# AI求职打印服务终端 - Codex 项目说明

> 本文件供 Codex 阅读。Claude Code 对应文件：CLAUDE.md

---

## 项目定位

AI求职打印服务终端 = AI简历服务 + 打印扫描 + 求职材料服务 + 第三方岗位信息入口 + 招聘会信息入口 + 线下一体机运营后台。

**不是招聘平台。公司暂无人力资源服务许可证。**

用户主要在 21.5 寸触控一体机上使用，兼容手机和桌面浏览器。

---

## 合规红线（每次开发前必读）

以下功能**绝对不能开发**：

1. 平台内一键投递
2. 平台内收取求职者简历给企业
3. 企业端候选人筛选
4. 企业端面试邀约
5. 企业端 Offer 管理
6. 候选人推荐给企业
7. 自营网络招聘闭环
8. 企业自主发布岗位并直接收简历

岗位和招聘会只能作为第三方/官方来源信息入口。

合规按钮文案：去来源平台投递 / 扫码投递 / 去来源平台预约 / 扫码预约  
禁止文案：一键投递 / 立即投递 / 平台投递

详见：[docs/compliance/compliance-boundary.md](docs/compliance/compliance-boundary.md)

---

## 技术栈

前端：React + Vite + TypeScript + Tailwind CSS + shadcn/ui + lucide-react  
后端：NestJS 或 FastAPI + PostgreSQL + Redis + BullMQ  
存储：MinIO / 阿里云 OSS / 腾讯 COS  
终端 Agent：Windows 本地 Node.js/.NET/Python

---

## 目录结构

```
apps/kiosk/          # 一体机前台
apps/admin/          # 管理员后台
apps/partner/        # 合作机构后台
apps/terminal-agent/ # Windows 本地 Agent
services/api/        # 后端 API
services/worker/     # 打印/AI/同步任务
packages/ui/         # 公共 UI 组件
packages/shared/     # 公共类型和工具
docs/                # 所有文档
legacy-miaoda/       # 旧秒哒项目（仅参考，不用于开发）
```

---

## AI 协作分工

| 角色 | 职责 |
|------|------|
| Claude Code | 主力开发（apps/、services/、packages/） |
| Codex | 方案审查、代码 review、需求整理、UI/UX 审查、关键问题修复、docs/ 维护 |

两者共用同一 Git 仓库，不分叉副本。

详见：[docs/decisions/ai-collaboration-rules.md](docs/decisions/ai-collaboration-rules.md)

---

## 当前进度

详见：[docs/progress/current-progress.md](docs/progress/current-progress.md)  
下一步任务：[docs/progress/next-tasks.md](docs/progress/next-tasks.md)

当前阶段：Phase 8.1A — Local Print MVP（进行中）

- Phase 1–7 已完成（设计系统、前台、后台、合作机构、API 设计）
- Phase 8.0.1 完成（2026-05-27）：QA-1 PDF Method B 已真实出纸 ✅
- Method A 图片打印假成功（根因：Windows 11 Photos app PrintTo verb 返回 0 但不打印）❌
- Phase 8.0.2 mspaint 排除（Windows 11 无 mspaint.exe）❌
- 图片打印路径确定：pdfkit 临时 PDF → Method B（pdf-to-printer/SumatraPDF）
- Phase 8.1A Local Print MVP：统一 print() + image-to-pdf(pdfkit) + 临时 PDF 清理

---

## 硬件

**打印机：奔图 CM2800/CM2820 系列彩色激光多功能一体机**

- Windows 驱动识别名称（真机确认）：`Pantum CM2800ADN Series`
- **代码中必须通过 `printerName` 配置项指定，禁止硬编码任何型号字符串**
- 硬件支持彩色打印；但奔图开放打印 API 的彩色 mode 取值 **TODO**（待厂家确认，不得假设为 `"color"`）

详见：[docs/device/pantum-cm2820adn.md](docs/device/pantum-cm2820adn.md)  
Agent 设计：[docs/device/windows-terminal-agent-design.md](docs/device/windows-terminal-agent-design.md)  
奔图 API 规范（预留）：[docs/device/pantum-api-design.md](docs/device/pantum-api-design.md)

---

## 重要提醒

- 不要在旧秒哒项目（legacy-miaoda/）里改代码。
- 不要假设打印机支持 A3 或云端远程扫描。
- 每次修改后更新 docs/progress/current-progress.md。
