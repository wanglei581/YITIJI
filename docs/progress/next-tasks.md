# 下一步任务

> 最后更新：2026-06-20
> 入口用途：当前任务池与执行顺序。历史任务长记录文本已归档到 `docs/progress/archive/2026-06-20-next-tasks-pre-normalization.md`；归档时行尾空格按仓库 whitespace 检查规范化。

## P0：项目规范化治理

- [x] **P0 治理基线**：保留现有 monorepo，不新建仓库；已新增 `docs/project-structure.md` 与 `.ccg/spec/guides/index.md`。
- [x] **主工作区分类规则**：已输出 `docs/reviews/project-normalization-p0-worktree-inventory.md`，明确 A/B/C/D/E 类处理口径。
- [x] **Codex + Claude 协作模式**：已输出 `docs/reviews/project-normalization-codex-claude-collaboration.md`，确认 Claude 只做草案/清单，Codex 落盘，Antigravity + Claude 双模型复审。
- [x] **T0 真值对齐**：已输出 `docs/reviews/project-normalization-truth-audit.md`，确认三层状态并存，不能整包同步或整包清理。
- [ ] **T1 进度文档收口**：当前任务。将入口文档短版化，保留历史归档，不迁入运行时代码。
- [ ] **T2 E 类本地工具状态 ignore 提案**：只新增提案文档，不直接改 `.gitignore`；等待确认 `.ccg/commander/`、`.product-pm/`、`.workbuddy/`、`.superpowers/*/state/` 是否仍被使用。
- [ ] **T3 C 类任务证据筛选**：只新增筛选清单；保留 plan / review / verify / deploy / audit；ack / advise / explain 等低价值记录不入库需用户确认。
- [ ] **T4 D 类外部材料索引**：为 `docs/business/`、`deliverables/`、`opc-doc/` 建摘要索引；PDF/PNG/PPT/DOCX/ZIP 是否入库先确认仓库外备份。

## P0：上线前真实验收

- [ ] 生产域名与 HTTPS：完成域名解析、证书、nginx 反代、上传限制和自动续期。
- [ ] PostgreSQL 生产实例：`migrate deploy`、seed、核心 verify、备份恢复演练通过。
- [ ] Redis 生产连接：队列/缓存配置、访问权限和内网隔离确认。
- [ ] COS 生产私有桶：CAM 最小权限、上传/下载/删除 live 冒烟。
- [ ] 腾讯短信：签名/模板审核、真实 CAM Key、真号登录 E2E 后才能启用 `SMS_PROVIDER=tencent`。
- [ ] 百度 OCR / AI / TRTC / ASR / TTS：生产 Key、权限、失败兜底和 live 冒烟按启用范围验收。
- [ ] Windows 真机：Terminal Agent、奔图打印机、打印真实出纸、扫描链路、断网/重启恢复逐项记录。
- [ ] 法务合规：用户协议、隐私政策、AI 免责声明、招聘信息来源免责声明审定。
- [ ] 小范围试运营：仅 1 台终端 + 1 台打印机先跑，问题记录按任务闭环处理。

## P1：渐进式重构首批业务闭环

首批业务闭环不按目录搬家，按可验收业务流推进。

- [ ] **我的页商用闭环**：会员权益、消息通知、意见反馈、我的文档/简历/打印订单/收藏/浏览跳转记录。明确旧入口、新目录、API client、状态、verify、浏览器验收和删除旧实现条件。
- [ ] **AI 简历上传 / 资产中心**：登录保存、退出本机清空展示、本人可查看/删除、未登录临时文件规则、平台不提供给企业。
- [ ] **招聘会 / 校园招聘**：Admin 审核、Partner 边界、Kiosk 本校优先、公开来源入口、外部跳转记录；继续禁止平台内投递和企业候选人管理。

## P1：工程质量门禁

- [ ] 每个新任务先写目标、非目标、允许修改文件、验证方式。
- [ ] 超过 30 行 diff 或跨模块任务必须 Claude + Antigravity 双模型审查。
- [ ] 500 行以上文件新增功能前评估拆分；800 行以上不得继续堆新功能；1000 行以上进入拆分清单。
- [ ] 删除旧页面/组件/脚本/文档前，必须确认无路由、import、测试/verify、当前文档、生产部署或硬件链路依赖。
- [ ] 构建产物、缓存、临时截图、录屏、数据库备份、密钥备份、可再生成文件不得进入 Git。

## 待用户确认

- [ ] 是否同意 E 类本地工具目录写入 ignore 但本地保留。
- [ ] 是否同意 C 类任务证据按价值筛选，不整包提交。
- [ ] 是否同意 D 类外部材料采用“仓库摘要 + 大文件仓库外归档”。
- [ ] 是否确认后续每个业务闭环都独立分支、独立验证、双模型审查后再推进。
