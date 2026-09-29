# 第一次发布时各开关的取值表（给全功能模拟走查按发布配置跑）

依据：候选 6f473f211 的 `docs/progress/next-tasks.md`「第一次发布」清单与代码；#1078 补的 9/29 拍板。
「走查怎么设」一列是本地演示包（scripts/demo）里要设成的值；演示包默认 NODE_ENV=development，并且会剔掉 AI_、LEGAL_、MAINTENANCE_、POLICY_、RESUME_ 等前缀的父环境变量，所以下面凡是和默认不同的，都要在 demo-config 里显式写。

| 项 | 第一次发布取值 | 在哪设 | 走查怎么设 | 代码依据 |
|---|---|---|---|---|
| 招聘内容托管 | 关（不设） | 服务器 .env `RECRUITMENT_CONTENT_HOSTING_ENABLED` | `false`（演示包已是） | 托管 a |
| 打印价目 | 黑白、彩色两行都 0 元，说明「免费试运营」 | 后台价目 | 演示种子已改 0 元（19013edc8） | 报价 0 走免费单：`print-jobs.service.ts:527`、`:562` |
| 简历导出价目 `resume_export` | 0 元、启用 | 后台价目 | 种子已是 0 | `price-config.seed.ts` |
| 法务文档 | 用户服务协议、隐私政策、AI 服务免责声明三份已激活；经营者信息发布后再加 | 后台法务文档 | 演示种子 4 份都已激活；另要测一次「没激活时拦住登录」 | — |
| 协议必须已发布才能登录 | 开（生产默认） | .env `LEGAL_DOCS_REQUIRE_PUBLISHED`（生产不设即开） | **显式设 `true`**：演示是 development，不设就是关 | `member-auth/legal-docs-published-guard.ts` `legalDocsRequirePublished()` |
| 一体机正式版不回落草稿 | 正式构建生效 | 构建方式 | vite dev 下不生效；要验这一条得用 `vite build` 后的产物 | `apps/kiosk/src/services/auth/legalConsentVersions.ts:28` |
| AI 登录档位 | off（第一次发布不开） | 后台「AI 服务管理」开关面板（Redis）或 .env `AI_LOGIN_GATE` | off；第二次发布那轮再测 `before_generate` | `ai-access/ai-access.service.ts:12-45` |
| AI 使用声明强制 | 关 | 同上，`AI_DECLARATION_ENFORCEMENT` | 关；第二次发布那轮再测 on | 同上 |
| AI 一键暂停 | 关 | 后台开关面板 / `AI_PAUSED` | 关；第 15 条旅程时临时打开再关 | 同上 |
| 全机维护 | 关 | 后台开关面板 / `MAINTENANCE_MODE` | 关；同上 | 同上 |
| 政策显示范围 | 全部（第一次发布不开 org） | .env `POLICY_SCOPE` | 不设；第二次发布那轮测 `org` | `policies/policy-public-visibility.ts:16` |
| 简历导出可见 AI 标识 | 关（9/29 拍板） | .env `RESUME_EXPORT_VISIBLE_LABEL` | 不设 | `common/pdf/aigc-label.ts:16` |
| 不带标识版本申请 | 关 | .env `RESUME_EXPORT_UNLABELED_OPTION` | 不设 | `aigc-label.ts:24` |
| 隐式标识「服务提供者」 | 「职易达（统一社会信用代码）」，代码由产品负责人填 | .env `AIGC_CONTENT_PRODUCER` | 写「职易达（演示）」之类演示值，不写真实代码 | `production-runtime-gates.ts:213-216` 只在生产检查 |
| 签名盖章 | 关（未登记即拒） | 终端能力逐台 | 不登记 | `DEFAULT_DENY_CAPABILITY_KEYS` |
| 彩色打印、自动双面 | 未登记即拒；真机逐台验过才开 | 终端能力逐台 | 默认不登记；要测彩色另起一轮，并先确认价目描述 | 同上；CLAUDE.md §3 |
| 大模型 | 15 个功能位只用 DeepSeek / 通义千问 | 后台 AI 服务管理 | 走查用 mock；抽第 6、9 条用真模型，由产品负责人在服务器跑 | `ai/llm/llm-config.service.ts` |
| 手机上传二维码地址 | 一体机正式域名 https | .env `KIOSK_PUBLIC_BASE_URL` | `http://127.0.0.1:<一体机端口>`（演示包已设，19013edc8） | `upload-sessions.controller.ts:126-139` |
| 告警推送 | 企业微信群机器人 | .env `ALERT_WEBHOOK_URL` | 置空；告警只看后台告警中心 | — |

注意：
- 后台「AI 服务管理」的四个开关存在 Redis（`system:ai-access:*`），演示包 `demo:reset` 不清 Redis 11 号库。上一轮走查切过的开关会留到下一轮，每轮开始前先在后台把四个开关看一遍，或清掉这四个键。
- 服务端开关有 30 秒缓存（`ai-access.service.ts` 的 `expiresAt`），切完等半分钟再测。
