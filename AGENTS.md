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

当前物理目录仍采用标准 monorepo 结构；目录职责索引详见：[docs/project-structure.md](docs/project-structure.md)。当前阶段不做物理目录迁移。

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

## 跨模型接力规则

本项目不新增独立的 handoff / 交接记录文件，避免多模型读取时把临时记录误当成正式需求。

任意模型、任意设备接手前，必须先读取以下正式入口文档：

1. `AGENTS.md` 或 `CLAUDE.md`
2. `docs/progress/current-progress.md`
3. `docs/progress/next-tasks.md`
4. `docs/product/feature-scope.md`
5. `docs/compliance/compliance-boundary.md`
6. `.ccg/spec/guides/index.md`（若存在）

记录保存规则：

- 当前阶段、已完成内容、下一步任务：写入 `docs/progress/current-progress.md` 和 `docs/progress/next-tasks.md`
- Claude 当日开发摘要、协作收尾、demo 链路：写入 `docs/progress/today-claude.md`
- 删除、清理、移除页面或文件：必须写入 `docs/progress/current-progress.md` 的更新记录，并保留 Git commit
- 合规边界、角色边界、长期产品约束：写入 `docs/compliance/` 或 `docs/product/`
- 不把完整聊天记录写入仓库；只沉淀可执行结论、验证结果和关键决策

聊天记录、截图、临时总结只能作为辅助背景，不是项目事实来源。若文档之间存在冲突，以当前 Git 最新提交、`current-progress.md` 的当前阶段、以及实际代码验证结果为准；无法判断时先做审查报告，不直接写功能代码。

---

## 工程规模控制

详见：[.ccg/spec/guides/index.md](.ccg/spec/guides/index.md)

后续开发必须先确认任务范围和文件预算，再做方案审查，审查通过后才写代码。禁止为了“看起来完整”继续堆重复入口、占位页面、假数据闭环、临时脚本和无验证代码。

单文件体积按以下阈值控制：300 行以内为理想状态，500 行以上新增功能前必须评估拆分，800 行以上不得继续堆新功能，1000 行以上进入重构/拆分清单。生成文件、迁移快照和必要静态快照除外。

删除旧代码必须有证据：无路由引用、无 import 引用、无测试/verify 依赖、无当前文档声明、不会被生产部署或硬件链路使用。删除、隐藏、迁移页面或功能后必须同步 `docs/progress/current-progress.md`，并跑最小相关验证。

---

## 当前进度

详见：[docs/progress/current-progress.md](docs/progress/current-progress.md)  
下一步任务：[docs/progress/next-tasks.md](docs/progress/next-tasks.md)

当前阶段：上线前收口（2026-06-12）：只做验收、阻塞项修复建议、文档收口、部署准备、真机验证规划；不再新增非必要功能。

- Phase 1–7 已完成（设计系统、前台、后台、合作机构、API 设计）
- Phase 8 全部封板（2026-05-29，Mac 真实后端跨机 E2E 验证通过）：Phase 8.0 Spike / 8.1A–D Windows 真机出纸 / 8.2A Prisma 跨机 / 8.2B WMI / 8.2C 安全加固
- 图片打印路径：pdfkit 临时 PDF → Method B（pdf-to-printer/SumatraPDF）
- Agent 命令：`node dist/index.js agent` / `install-service` / `uninstall-service`
- W1/W2/W3 stacked 分支已 FF 合入 main（2026-06-01，`3f35caa`）：
  - W1：BE-1 文件签名 + Kiosk 上传 + K2 简历四步流 + Diff View
  - W2：BE-7 JobFair 8 端点切真 Prisma + audit + 校企合作详情端点
  - W3：JobSource 凭证加密落库 + Webhook 接收端（HMAC + 5min 时间窗 + nonce 防重放）+ Partner /sources 三轨入口（API/Webhook/Excel）
- Phase 7.11 R4 完成（2026-06-01）：`packages/shared` 新增 `PartnerDataSourceView`/`ConnStatus`，`SyncFrequency` 加 `weekly`；前后端 Partner 数据源 DTO 收紧为字面量；UI 零变化；E2E demo 复跑通过
- 阶段1 三端数据打通 1A–1F 已完成（2026-06-10）：Admin 招聘会 / 合作机构 / 订单告警、Partner 编辑与政策公告、Kiosk 招聘会与校园招聘 UI 均已接真。
- 阶段2 已完成：AI 简历生成 MVP、AI 简历优化真实化、真实模型联调与安全收口、招聘会场馆导览图、C-2D 会员资产中心真实管理。
- 2C 模拟面试 + 2C+ 语音增强已完成；2D 目标岗位定向优化 + 岗位匹配参考、2E 职业规划、P1 浏览/外部跳转记录接真已完成；第四阶段 PostgreSQL 生产数据底座已完成（Windows 生产实例待部署复验）。
- AI 数字人主体已完成：Kiosk `/assistant` 使用 TRTC 真人照片顾问「小青」+ 文字对话；早期 3D/SVG 数字人方案已被替代，不再作为下一步重做。
- Stage 3 真实 OCR 已完成（2026-06-11，百度智能云）：图片/扫描件简历真实进诊断闭环；上线前须轮换百度密钥。
- **入口稳定规则（2026-06-12 用户确认）**：当前首页与各业务板块里的功能入口已经定版；后续只做已有入口真实化、页面接真、按钮接线、状态补齐和「我的」数据闭环，不新增重复入口 / 同义卡片。详见 `docs/product/user-data-flow-matrix.md`。
- **上线前 P0**：按 `docs/device/production-deployment-and-windows-host-checklist.md` 完成生产服务器、PostgreSQL 生产实例、Windows 本地主机、Terminal Agent、打印扫描、密钥轮换、法务合规、线上浏览器闭环验收；最新部署提交必须保持 SQLite 主 CI 与 `postgres-readiness` 双 job 通过。
- **下一步**：① 上线前 P0 验收；② 打印任务状态实时追踪 UI；③ 择期补场馆导览扩展（Partner 配置入口 / 平面图图片）。

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
