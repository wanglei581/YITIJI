# 青序流光 2.0 · 页面状态

渲染自审 = 协调方用 Playwright 按 1080×1920 真尺寸渲染，与原稿并排看过，并跑探针（小于 20px 的文字数、y<500 的可点元素、圆角框数）。

| 页 | 谁做 | 渲染自审 | 用的状态参数 | 备注 |
|---|---|---|---|---|
| 00-standby | Claude | 通过 | `capture=1` | Grok、Codex、Agy 复核意见已改入 |
| 01-home | Claude | 通过 | `capture=1` | 同上；小程序码等有真实码再加 |
| 15-print-fulfill | Claude | 通过 | `capture=1` | 只改字阶与断行、补本步 AI 帮助 |
| 22-resume-report | Claude | 通过 | `capture=1&state=report&taskId=demo123` | 轻优化（结构不动）；`22-resume-report.proposal.html` 是重排结构的提案，待产品负责人定 |
| 10-print-hub | Codex | 通过 | `capture=1&state=default` | |
| 11-arrival-code | Codex | 通过 | `capture=1` | |
| 12-file-source | Codex | 通过 | `capture=1&state=local-ready` | |
| 13-print-desk | Codex | 通过 | `capture=1&state=preview` | |
| 14-print-confirm | Codex | 通过（两轮返工） | `flat=1&state=quoting` | 报价中的灰色禁用主按钮沿用原稿，留到实现阶段统一禁用态 |
| 33-pickup-code | Codex | 通过 | `capture=1` | |
| 21-resume-triage | Codex | 通过 | `capture=1&state=summary&source=usb` | |
| 23-resume-optimize | Codex | 通过 | `capture=1&state=ready&screen=compare&taskId=qx2-example&i=1` | |
| 24-resume-generate | Codex | 通过（一轮返工） | `capture=1&state=review` | |
| 25-material-workshop | Codex | 通过（两轮返工） | `capture=1&state=select&auth=out` | 「生成后 1→2→3」条放在标题下，顶部只读 |
| 02-services | Grok | 通过 | `capture=1` | |
| 05-ai-cockpit | Grok | 通过 | `capture=1&state=reply-real` | |
| 29-interview-training | Grok | 通过 | `capture=1&state=report-ready` | |
| 30-my-profile | Grok | 通过 | `capture=1&state=ready` | |
| 03-login-gate | Grok | 通过（一轮返工） | `capture=1&state=phone-code-sent` | |
| 06-help | Grok | 通过（一轮返工） | `capture=1&topic=account` | |
| 16-service-hubs | Grok | 通过（一轮返工） | `capture=1&hub=resume` | 第八项是「简历对照」（AI 对照本人填写的岗位要求） |
| 32-cashier | Grok | 通过（一轮返工） | `capture=1&state=pending` | |
| 45-online-platform-directory | Grok | 通过（一轮返工） | `capture=1&state=ready` | 本机构官方渠道；机构名与二维码是标明的示例；带本目录的 `directory-workspaces.js` |
| 48-policy-workspace | Grok | 通过（一轮返工） | `capture=1&state=policy-ready` | 带本目录的 `policy-workspace.js` |
| 其余 | 未开始 | | | 托管 a 下 26、27、28、42、43、44（岗位、招聘会、企业）在我们云上不显示，不做 2.0 |

没有列在这里的页面以原稿目录为准。
