# 岗位信息 AI 预生产 / 真机执行记录模板

> PENDING REAL-EVIDENCE
> 本文件是脱敏摘要模板，不得填写真实手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
> 原始截图、命令日志、SQL 输出、真机照片和打印实物照片必须保存在仓库外证据目录。

## Environment Snapshot

| 项 | 脱敏记录 |
| --- | --- |
| 执行时间 | `PENDING` |
| 执行人 | `PENDING` |
| 部署 commit | `PENDING` |
| Kiosk URL | `PENDING` |
| Admin URL | `PENDING` |
| Partner URL | `PENDING` |
| API health | `PENDING` |
| 数据库 | `PENDING: PostgreSQL / not checked` |
| Redis | `PENDING: set / unset` |
| COS | `PENDING: region + bucket digest` |
| LLM | `PENDING: vendor/model only` |
| 百度 OCR | `PENDING: live pass / not used / blocked` |
| 证据目录 | `PENDING: repository-external path` |

## Customer Job Sample Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G1-01 | Not Passed Yet | 客户真实岗位样本来源、导入方式、样本数量 |
| JAI-G1-02 | Not Passed Yet | `sourceOrgId`、`externalId`、`sourceName`、`sourceUrl` 四要素抽样 |
| JAI-G1-03 | Not Passed Yet | `JobDataQualitySnapshot` ready / partial / insufficient 摘要 |
| JAI-G1-04 | Not Passed Yet | Admin 岗位来源质量摘要截图或脱敏摘要 |
| JAI-G1-05 | Not Passed Yet | Partner 本机构岗位质量摘要，确认无法看到其他机构 |
| JAI-G1-06 | Not Passed Yet | Kiosk `/jobs` 和 `/jobs/:id` 展示真实已发布岗位 |

判定：

```text
Customer Job Sample Gate: Not Passed Yet
阻塞项：
```

## Preproduction Browser Gate

会话来源方式：

- [ ] `SESSION-A_REAL_SMS`
- [ ] `SESSION-B_REDIS_TEST_CODE`
- [ ] `SESSION-C_CONTROLLED_SESSION`

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-G0 | Not Passed Yet | 本地静态门禁 `verify:job-info-ai-real-acceptance` |
| JAI-G2-01 | Not Passed Yet | `verify:production-runtime-gates` |
| JAI-G2-02 | Not Passed Yet | `verify:production-db-guard` |
| JAI-G2-03 | Not Passed Yet | `verify:llm-connectivity -- --all` |
| JAI-G2-04 | Not Passed Yet | `verify:ocr-baidu-live` 或本轮不参与说明 |
| JAI-G2-05 | Not Passed Yet | `verify:job-ai-backend` / `verify:job-ai-privacy` / `verify:job-ai-ops-dashboard` |
| JAI-G3-01 | Not Passed Yet | 会员登录并进入 `/jobs` |
| JAI-G3-02 | Not Passed Yet | 确认 `job_ai` 授权 |
| JAI-G3-03 | Not Passed Yet | 选择本人真实已解析简历并生成 AI 推荐 |
| JAI-G3-04 | Not Passed Yet | 打开真实岗位详情并完成 AI 解读 |
| JAI-G3-05 | Not Passed Yet | 完成岗位匹配参考，不出现百分比或录用承诺 |
| JAI-G3-06 | Not Passed Yet | 打开来源二维码 / 外链，只记录 `external_apply` 打开动作 |
| JAI-G3-07 | Not Passed Yet | `/me/ai-records` 展示本人 Job AI 会话元数据 |
| JAI-G3-08 | Not Passed Yet | `/me/settings` 撤回 `job_ai` 授权 |
| JAI-G3-09 | Not Passed Yet | 抽样确认 `JobAiSession`、`JobAiRecommendation`、`AiServiceLog` 元数据和清理状态 |

判定：

```text
Preproduction Browser Gate: Not Passed Yet
阻塞项：
```

## Hardware Gate

| 证据 ID | 状态 | 摘要 |
| --- | --- | --- |
| JAI-H1-01 | Not Passed Yet | Windows 版本、Kiosk 浏览器、竖屏分辨率 |
| JAI-H1-02 | Not Passed Yet | Windows Terminal Agent 版本、terminalId、在线心跳 |
| JAI-H1-03 | Not Passed Yet | Pantum 打印机 Windows 真实识别名 |
| JAI-H2-01 | Not Passed Yet | 27 寸竖屏 `/jobs` 触控、筛选、搜索 |
| JAI-H2-02 | Not Passed Yet | `/jobs/:id`、AI 推荐、AI 解读、岗位匹配参考触控状态 |
| JAI-H2-03 | Not Passed Yet | 来源二维码 / 外链展示可识别 |
| JAI-H3-01 | Not Passed Yet | 生成真实 FileObject 与 PrintTask |
| JAI-H3-02 | Not Passed Yet | Agent 只 claim 本机 terminalId 的 PrintTask |
| JAI-H3-03 | Not Passed Yet | Pantum 真实出纸，纸张和色彩 / 双面模式记录 |
| JAI-H3-04 | Not Passed Yet | 打印完成 / 失败 / 断网恢复状态回传 |
| JAI-H3-05 | Not Passed Yet | 打印后本地缓存 TTL 清理 |

判定：

```text
Hardware Gate: Not Passed Yet
阻塞项：
```

## Evidence Index

| 证据 ID | 仓库外路径 / 摘要 | 脱敏检查 |
| --- | --- | --- |
| JAI-G0 | `PENDING` | `PENDING` |
| JAI-G1 | `PENDING` | `PENDING` |
| JAI-G2 | `PENDING` | `PENDING` |
| JAI-G3 | `PENDING` | `PENDING` |
| JAI-H1 | `PENDING` | `PENDING` |
| JAI-H2 | `PENDING` | `PENDING` |
| JAI-H3 | `PENDING` | `PENDING` |

## Stop Conditions

如出现以下任一项，记录后立即停止：

- 禁止链路文案出现在 Kiosk、Admin、Partner 或 AI 输出中。
- AI 输出出现百分比化推荐、通过承诺或录用承诺。
- Partner 看到用户个人信息、个人 AI 明细或其他机构数据。
- 会员 B 能访问会员 A 的 Job AI 会话。
- 日志或截图出现手机号明文、验证码、cookie、JWT、签名 URL、简历正文或密钥。
- 预生产仍使用 mock、disabled OCR、local file storage 或非 PostgreSQL。
- Agent claim 到非本 terminalId 的打印任务。
- 真机未出纸但任务状态为 completed。
- 打印缓存 TTL 后仍能打开用户文件。

## Residual Risks

```text
Not Passed Yet
- 客户真实岗位样本：
- 预生产公网浏览器：
- 一体机真机：
- 生产上线前必须复验：
```

## Final Decision

```text
岗位信息 AI 真实验收结论：Not Passed Yet
是否允许宣称生产商用完成：否
是否允许进入小范围试运营：否
签字 / 确认人：
日期：
```
