# 青序流光 2.0 · 页面状态

渲染自审 = 协调方用 Playwright 按 1080×1920 真尺寸渲染，与原稿并排看过，并跑探针（小于 20px 的文字数、y<500 的可点元素、圆角框数）。

| 页 | 谁做 | 渲染自审 | 用的状态参数 | 备注 |
|---|---|---|---|---|
| 00-standby | Claude | 通过 | `capture=1` | Grok、Codex、Agy 复核意见已改入 |
| 01-home | Claude | 通过 | `capture=1` | 同上；小程序码等有真实码再加 |
| 15-print-fulfill | Claude | 通过 | `capture=1` | 只改字阶与断行、补本步 AI 帮助 |
| 22-resume-report | Claude | 通过 | `capture=1&state=report&taskId=demo123` | 轻优化（结构不动）；`22-resume-report.proposal.html` 是重排结构的提案，待产品负责人定 |
| 10-print-hub | Codex | 通过 | `capture=1&state=default` | 9/28 修了重叠：带提示条的状态里证件照横卡不再压住「02 已下过单」 |
| 11-arrival-code | Codex | 通过 | `capture=1` | 9/28 修了重叠：「码找不到了？」不再压住底部「上一步 / 问小青」 |
| 12-file-source | Codex | 通过 | `capture=1&state=local-ready` | 9/28 修了重叠：来源选择、取消相关状态的步骤说明不再压住下一行 |
| 13-print-desk | Codex | 通过 | `capture=1&state=preview` | 9/28 按运行能力修订：无跳过、遮挡生成新文件。已去掉 check-skip-confirm。同日第二遍：遮挡的完整解释只留一处，决定列表底部标签不再被裁 |
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
| 18-scan-workbench | Grok G1 | 通过 | `capture=1&flat=1` | 内部链路说明换成用户三步：放纸 → 面板上按扫描 → 文件回到这台机器 |
| 19-img2pdf | Grok G1 | 通过（一轮返工） | `capture=1&flat=1&state=ready-three` | |
| 20-sign-stamp | Grok G1 | 通过（一轮返工） | `capture=1&flat=1&state=placement-default` | 只引导本人手写签名；预览工具条在画面下方，顶部只读 |
| 37-pay-states | Grok G1 | 通过（一轮返工） | `capture=1&flat=1&state=pending` | 金额仍是空位，不编价格 |
| 10–15、32、33 用词 | Grok G1 | 通过 | | 英文眉题改中文；彩色、双面写「本机暂未开通」；「让服务端报价」改「核对价格」 |
| 04-session-guard | Grok G2 | 通过 | `capture=1&state=warning&from=%2Fresume%2Foptimize` | 顶栏不放返回，避免没清场就离开 |
| 07-session-resume | Grok G2 | 通过 | `capture=1&state=payment-unpaid&fixture=1` | 每单按钮带订单尾号，不再一排相同文案 |
| 08-legal | Grok G2 | 通过 | `capture=1&doc=user&state=ready` | |
| 09-system-state | Grok G2 | 通过 | `capture=1&state=partial` | 没检测过的项不写成正常 |
| 51-phone-relay | Grok G2 | 通过 | `capture=1&screen=qr-login&state=code-sent`（390×844） | 手机字阶，不套 27 寸 |
| 00–03、05、06 用词 | Grok G2 | 通过 | | 03 协议勾选挪到首屏；工程词换白话 |
| 31-benefits | Grok G3 | 通过 | `capture=1&state=list` | |
| 35-notifications | Grok G3 | 通过（一轮返工） | `capture=1&state=ready-all` | 底部操作条在首屏 |
| 38-member-assets | Grok G3 | 通过 | `capture=1&state=documents-ready` | 文档 / 订单切换在 y=517 |
| 39-member-records | Grok G3 | 通过（一轮返工） | `capture=1&view=ai-records&state=ready` | 失败、处理中只留删除并写原因；**实现时「我的」分类页签统一按 38 放在 y≥500**（本稿在 y≈324） |
| 40-member-feedback | Grok G3 | 通过（一轮返工） | `capture=1&state=form-list` | 「提交反馈」在首屏，未填够时灰掉并写原因 |
| 41-member-privacy | Grok G3 | 通过 | `capture=1&state=history-ready` | |
| 30 用词 | Grok G3 | 通过 | | |
| 34-self-assessment | Grok G4 | 通过 | `capture=1&state=intro` | 不显示题库版本 |
| 46-resume-decision-workspace | Grok G4 | 通过 | `capture=1&screen=job-fit&state=result-high` | 岗位要求只由本人填写或粘贴 |
| 47-contract-review-workspace | Grok G4 | 通过 | `capture=1&screen=result&state=ready` | 功能开关默认关 |
| 50-capability-zone-workspace | Grok G4 | 通过 | `capture=1&screen=toolbox&state=ready` | 不展示终端编号 |
| 52-advisor-artifact | Grok G4 | 通过 | `capture=1&state=qa-pins` | 「打印带走」进打印；底部导航统一为「AI 顾问」（协调方合并时改） |
| 16、21–25、29、45、48 用词 | Grok G4 | 通过 | | |
| 其余 | 不做 | | | 托管 a 下 26、27、28、42、43、44（岗位、招聘会、企业、线下机构）与 49（校园招聘）在我们云上不显示，不做 2.0；36 是原型索引页 |

没有列在这里的页面以原稿目录为准。
