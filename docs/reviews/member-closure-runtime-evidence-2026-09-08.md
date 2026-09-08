# 会员态「简历优化 → 导出 PDF → 我的文档」运行期证据（2026-09-08）

对应上线前清单 [§4.2](../device/production-deployment-and-windows-host-checklist.md) 第二条。
本页只记**本地隔离环境**的运行期证据；生产域名复验仍待做，两者不可互相替代。

## 结论

**PASS（本地真实后端，非 mock、非桩）。** 这是 [#946](https://github.com/wanglei581/YITIJI/pull/946) 修复的反面证据：
缺陷期该链路对登录会员 100% 失败（0 文件 0 审计），修复后同一条链路走通并留下归属正确的产物。

## 决定性判据：会员本人名下的导出稿

```
filename            assetCategory  endUserId                    createdBy           createdAt
AI简历_演示用户.pdf   optimized      cmtsgtlf60000pgyb1p5xliuk    ai_resume_generate  09:43:12
```

`endUserId` 是本人会员 —— 而缺陷期这条记录**根本不存在**（12 条 optimized 全为匿名，会员侧 0 条）。

## 完整审计链（一次不间断的真人旅程）

```
09:43:03  file.upload              kiosk     会员上传简历原件
09:43:09  resume.parse_submitted   kiosk     诊断
09:43:09  resume.optimize_requested kiosk    优化
09:43:12  resume.generate_exported kiosk     ★ 导出成功（缺陷期这条是 0 次）
09:43:16  member.ai_record_delete  enduser   会员在「我的」删除 AI 记录
09:43:21  file.delete              enduser   会员在「我的文档」删除文件
```

**最后两条 `actorRole=enduser` 是闭环的证明**：会员必须先在「我的文档」里**看见**这份文件，
才可能点删除。删除动作本身就是「可见」的最强证据，比截图更难伪造。

用例结果：`1 passed (29.5s)`。对比缺陷期同一用例 `1 passed (8.4s)` —— **8.4 秒那次是假绿**，见下。

## 这轮真正的收获：走查脚本自己不可信

修复验证过程中连撞四层环境/脚本问题，每一层都**不报错、不变红**：

| # | 真实断因 | 脚本表现 |
|---|---|---|
| 1 | 读不到开发验证码 | 记一条「未覆盖」note，然后 `return` —— **用例 PASS，8.4 秒，零覆盖** |
| 2 | 夹具 PDF 随 `/tmp` 清空丢失 | `recordStep` 吞掉 ENOENT，继续走 |
| 3 | 存储后端 env 名写错（`STORAGE_DRIVER` ≠ `FILE_STORAGE_DRIVER`） | 上传 500，页面显示「服务器内部错误」，脚本继续走 |
| 4 | 上面任一层导致没有「开始 AI 诊断」按钮 | 十步之后在一句没加守卫的点击上超时，报「找不到『我的』按钮」—— **误导性错误** |

根子在 `sweep-harness.ts` 的 `recordStep`：**它 catch 每一步的异常、记 note、继续走**。
这对「记录型」扫描是**正确设计**（要走完全程、把死控件都记下来），
但它被包在 `test()` 里当成了「判定型」门禁。

> **记录型工具报绿，只说明它走完了，不说明它验到了。**

### 修法：保留吞异常，在阶段交界处插硬断言

不改 `recordStep`（扫描行为要保留），只在会员旅程的决策点加检查：

- 读不到验证码 → `test.skip()`，结果显示 **skipped 而不是 passed**，一眼看得出这轮没验会员态
- 走不到 `/resume/report` / `/resume/optimize` → **当场失败，并在断言消息里写出最可能的原因**
- 优化页没有导出按钮 → 直接报「会员导出闭环无法验证」

实测：硬化后它红在**真正的断点**上，而不是十步之后。

## 本地环境配方（下次照抄，省一小时）

API 启动必需，缺任一项都以**运行期 500** 而非启动失败的形式出现：

| 变量 | 缺失后果 |
|---|---|
| `SECRET_ENCRYPTION_KEY` | `hashPhone` 抛错 → 短信验证码接口 500 → 登录不了 |
| `REDIS_URL` | member-auth 启动即拒（`REDIS_DISABLED=true` **不顶用**，C 端会话/验证码都走 Redis） |
| `TERMINAL_ADMIN_SECRET` / `TERMINAL_ACTION_TOKEN_SECRET` | 启动即失败 |
| `FILE_STORAGE_DRIVER` / `FILE_STORAGE_DIR` / `FILE_SIGNING_SECRET` | 上传 500（**注意不是 `STORAGE_DRIVER`**，名字写错不会有任何提示） |

其它：

- kiosk 必须显式 `VITE_API_PROXY_TARGET=http://127.0.0.1:3010` ——
  只给 `VITE_API_BASE_URL=/api/v1` 时 `resolveApiProxyTarget` 会把它正则替换成**空串**，
  代理静默失效、所有请求 000，而**页面照常打开**。
- API 日志必须落在 `/tmp/sweep-api.log`（harness 硬编码读它取开发验证码）。
- 夹具在 `/tmp/sweep-fixtures/valid-2p.pdf`，`/tmp` 被清空后要补。
- 先 `npx prisma generate` 再 seed，否则 `Cannot find module '../generated/prisma/client'`。

## 不能由本页推出的结论

- **不能**据此勾生产域名的 §4.2。本页是本地 SQLite + 本地存储 + `AI_PROVIDER=mock`。
- **不能**据此判断真实 LLM / OCR 行为。
- 打印链路未覆盖（本机无 Agent、打印机离线）。

## 附：§4.3「打印/文件闭环」本地取证（同一套环境，2026-09-08）

脚本 `apps/kiosk/scripts/probe-file-closure-43.mjs`，一次跑完文件的完整生命周期。
**11 项断言全 PASS**：

```
PASS  上传                fileId=ecb29a69…
PASS  我的文档可见         列表 1 条，含本次上传
PASS  预览短期签名 URL     sig=true  TTL=1800s（要求 >0 且 ≤1800s）
PASS  下载成功            200 / 75867 字节与原件一致 / content-type=application/pdf
PASS  再打印入口          reprintable=true
PASS  Word 能力诚实        wordToPdf=false engine=none reason="服务端未配置转换引擎"
PASS  删除请求            200
PASS  删除后 DB 状态       FileObject.status=deleted
PASS  删除审计存在         近 2 分钟 file.delete 审计 2 条
PASS  物理文件已清理       /tmp/sweep-storage 残留 0 个
PASS  旧签名 URL 已失效     删除前铸的签名链接现在 404
```

**最后一条是这组里最有价值的**：它证明删除不是「只把 DB 里的 status 改成 deleted」——
删除前已经发出去的签名链接会当场失效。只查 DB 状态的断言，对「字段改了但文件还能下」这种缺陷是瞎的。

**11 PASS / 0 FAIL 做过阳性对照**（否则不敢信）：
往存储目录塞一个同 id 的残留文件，`find` 命中 1 个 → 物理清理断言判 FAIL；
拿一条 `status=active` 的行问同一条 SQL → 状态断言判 FAIL。**这些断言不是恒真的。**

### 过程中修正的一次自己的误判

探针最初按「列表里内嵌签名 URL」写，报了 FAIL。查下去发现列表给的是
`previewUrlPath` / `downloadUrlPath`，**签名 URL 按需铸造** ——
这是比内嵌**更好**的设计（暴露窗口更短）。差点把一个正确设计报成缺陷。
**探针报 FAIL 时，先怀疑探针的假设，再怀疑被测对象。**

### §4.3 本地证不了的部分（如实列出，不算 PASS）

| 条目 | 为什么本地证不了 |
|---|---|
| 证据包（PostgreSQL + COS + 真会员） | 本地是 SQLite + 本地存储，架构不同构 |
| Word 转换后的界面文案与确认流 | 需要 `wordToPdf=true`，本机无 soffice |
| Word 打印任务关联派生 PDF（`createdBy=document_conversion`） | 同上 |
| 打印任务进入打印订单、状态展示 | 本机无 Terminal Agent、打印机离线 |

注意第 2、3 条与「Word 能力诚实」那条 PASS 的关系：**本机 `wordToPdf=false` 正是能验「能力为假时诚实置灰」的原因，
也正是验不了「能力为真时的转换流程」的原因。** 同一个条件，一条能验一条不能，不要混为一谈。

## 附二：§4.4「岗位收藏 / 浏览与跳转记录」本地取证（2026-09-08）

脚本 `apps/kiosk/scripts/probe-activity-favorites-44.mjs`。**9 项断言全 PASS**：

```
PASS  岗位收藏进入我的收藏        收藏 1 条，含 job-uni-0041
PASS  取消收藏生效               剩 0 条
PASS  浏览记录可见               1 条
PASS  浏览记录可删除             删后剩 0 条
PASS  跳转记录可见               1 条 action=external_apply
PASS  跳转记录可删除             删后剩 0 条
PASS  BrowseLog 无结果字段        11 个字段，无结果类
PASS  ExternalJumpLog 无结果字段  12 个字段，无结果类
PASS  跳转 action 只记打开入口     external_apply / external_appointment / external_checkin_open / external_open
PASS  招聘会收藏 / 浏览 / 跳转       fair-hr-1k-2026q2，action=external_appointment
SKIP  政策收藏 / 浏览 / 跳转         本地夹具 PolicyPost 0 行，未实测
```

**三类目标（岗位 / 招聘会 / 政策）走同一套 `targetType` 通道，但逐类实测过才算数。**
只测 `job` 会留下「同代码路径所以应该也行」的推断，而**推断不是证据**。
政策类本地夹具是 0 行 —— 拿一个合成 id 也能让端点返回 200、凑出一个 PASS，
但那证明的是「通道能收任意字符串」，不是「政策收藏可用」。**所以如实记 SKIP。**

### 后三项才是这组的重点

前六项是功能项 —— **坏了用户会发现**。后三项钉的是 [CLAUDE.md §10](../../CLAUDE.md) 的合规红线
「系统只记录浏览 / 收藏 / 外部跳转，**不记录第三方后续结果**」，**越界了没有人会发现**，
因为它表现为「多了一个很有用的字段」，而不是「某个功能坏了」。

两条机械判据：

1. `BrowseLog` / `ExternalJumpLog` 的**列名**不得命中
   `status|result|outcome|stage|applied|interview|offer|hired|progress`。
2. `ActivityJumpAction` 的**取值**必须全部是 `external_*` 打开语义，且同样不得命中上面的结果词。
   当前四个取值 `external_apply / external_appointment / external_checkin_open / external_open`
   全部是「打开了外部入口」，没有一个表示「投递成功 / 进入面试 / 拿到 offer」。
   **`external_apply` 记的是「用户点开了来源平台的投递页」，不是「用户投递了」** —— 这个区别就是许可证边界。

### 阳性对照（证明这三条不是恒真）

```
同一条列名规则打在 FileObject  → 命中 [status]              → 判 FAIL ✔
同一条列名规则打在 PrintTask   → 命中 [status,printOutcome]  → 判 FAIL ✔
action 规则打在 [external_apply, apply_succeeded]   → 判 FAIL ✔
action 规则打在 [external_open, interview_scheduled] → 判 FAIL ✔
```

**合规类断言尤其需要阳性对照** —— 一条永远为真的合规断言，比没有断言更危险：
它会让人以为这条红线被守着。

### §4.4 本地证不了的部分

招聘会资料打印进我的文档 + 打印订单（需打印链路）、政策材料打印（需真实材料源，当前 info-only）、
政策类的收藏与记录（本地 `PolicyPost` 0 行，seed 未覆盖）。

## 附三：§4.5「AI / 外部服务」失败诚实性本地取证（2026-09-08）

脚本 `apps/kiosk/scripts/probe-ai-failure-honesty-45.mjs`。

清单 4.5 每条都有两半：「真实调用成功」和「失败时诚实」。前一半需要真 LLM / OCR 密钥，本地做不到；
**后一半本地做得到，而且它才是安全关键的那一半 —— 调用成功了用户自己看得见，伪造成功了没有人看得见。**

### 必须跑两种配置才算数

| 配置 | 三条「失败诚实」断言的期望 |
|---|---|
| A：`AI_PROVIDER=openai` + 假密钥（provider 必失败） | **必须 PASS** |
| B：`AI_PROVIDER=mock`（provider 可用） | **必须 FAIL** |

B 是阳性对照。**只跑 A 的话，一条恒真断言也会全绿。**

实测：

```
配置 A（注入失败）
  PASS  LLM 失败诚实报错        status=501 code=Not Implemented
  PASS  失败不写假结果          AI 结果行 5→5（新增 0），AI 产出文件 2→2（新增 0）
  PASS  服务日志如实记失败       parseResume/failed/NotImplementedException
  PASS  语音能力如实上报         asrEnabled=false ttsEnabled=false
  PASS  语音关闭不阻断文字路径    创建会话 status=400（不是 404/501）

配置 B（阳性对照，provider 可用）
  FAIL  LLM 失败诚实报错        status=201          ← 调用成功了，断言正确地转红
  FAIL  失败不写假结果          AI 结果行 5→6      ← 真写了结果行
  FAIL  服务日志如实记失败       parseResume/success ← 日志记的是成功
  PASS  语音能力如实上报         （与 provider 无关，仍应 PASS）
  PASS  语音关闭不阻断文字路径    （同上）
```

**三条断言在两种配置下给出相反结论 —— 这就是它们能分辨真假的证明。**

### 写这个探针时踩的三个坑，全都指向「假 PASS」

| 坑 | 为什么危险 |
|---|---|
| 请求体不合法，被 DTO 挡在 LLM 之前 | 返回 `400 VALIDATION_FAILED`，我的「有错误码就算诚实」判据**照样 PASS** —— 测到的根本不是 LLM 失败。已收紧为「错误码不得是 `VALIDATION_FAILED`」。 |
| 按 `status='success'` 过滤 AI 结果行 | 该表 status 词表里**只有 `completed`**，没有 `success`。这条过滤永远返回 0，断言恒真。 |
| 用 `createdAt > datetime('now','-2 minutes')` 过滤 | `createdAt` 存 ISO（`2026-09-08T10:51:41.250+00:00`），`datetime('now')` 出 `2026-09-08 12:36:44`。字符串比较里 `'T'(0x54) > ' '(0x20)`，于是**每一行都命中**，时间过滤等于没写。 |

后两个坑**都朝同一个方向出错 —— 让断言更容易 PASS**。改用「前后计数差」之后不依赖任何格式假设。
另外第一版把探针自己上传的原件也算成了「伪造结果」，改为只数 `createdBy LIKE 'ai_%'` 的 AI 流水线产出。

**SQL 里的字符串比较与枚举值假设，是断言恒真的高发区。** 写完先问一句：
这条 `WHERE` 在什么情况下会命中？答不上来就先去数一遍。

### §4.5 本地证不了的部分

「LLM 真实调用成功」「OCR 图片 / 扫描 PDF 成功、低置信度提示复核」「ASR/TTS 在支持环境可用」
—— 三条的「成功半边」都需要真实密钥与真实环境，本地一律不记。

## 附四：§4.2「AI 简历与『我的』闭环」剩余条目本地取证（2026-09-08）

脚本 `apps/kiosk/scripts/probe-ai-resume-closure-42.mjs`。**7 PASS / 0 FAIL / 1 如实 SKIP**：

```
PASS  AI 授权前置成功            resume_ai granted=true
PASS  诊断提交成功               taskId=mock-ai-…
PASS  诊断进入 AI 服务记录        记录 1 条：parse
PASS  岗位匹配需独立授权          job_ai 授权成功（与 resume_ai 分开）
SKIP  岗位匹配进入 AI 服务记录     本地 job-fit provider 未配置（503 AI_NOT_CONFIGURED）
PASS  AI 简历生成成功            taskId=mock-ai-…
PASS  生成稿导出进我的文档         导出 201，我的文档 1→2
PASS  删除后不残留幽灵记录         删除 200，列表少一条，直连读取 404
```

### 「幽灵记录」这条要看两处，不能只看列表

清单写的是「删除 AI 记录后不残留幽灵记录」。**只断言「列表里没有了」是不够的** ——
记录可能只是从列表查询里被过滤掉，直连 `GET /resume/records/:taskId` 仍然读得到内容。
所以这条同时验两处：**列表少一条 + 直连读取 404**。

阳性对照：对一条**未删除**的记录做同样的直连读取 → `200`，幽灵条件成立、断言会判 FAIL。
**证明这条断言分辨得了「删了」和「没删」**，不是恒真。

### 一个正确的隐私设计，差点被我误报成缺陷

岗位匹配走的是 **`job_ai`** 这个 consent scope，不是简历诊断的 `resume_ai`。
探针只授权了 `resume_ai` 时，job-fit 回 `403 USER_AI_CONSENT_REQUIRED`。

这是**有意的颗粒度设计**：用户同意「AI 分析我的简历」不等于同意「拿它去匹配岗位」。
如果按「诊断能用、匹配不能用」记一条缺陷，就会推动去掉一道正确的隐私边界。
**探针遇到 403，先问是不是自己少走了一步授权。**

### 写这轮探针踩的两个坑（都让断言假 FAIL 或假 PASS）

| 坑 | 症状 |
|---|---|
| 前置步骤用 `.catch(() => {})` | 授权请求 body 多带一个字段 → 400 被静默吞掉 → 授权从未生效，失败以「诊断 403」的形式出现在十几行之后。**setup 步骤也必须断言。** |
| 响应信封不一致 | `j()` 返回 `{s,b}` 包装，`items()` 却要裸 body。传错之后 `d.data` 恒为 undefined、恒返回 `[]`，两条断言因此**假 FAIL**，差点被记成「记录不可见」的产品缺陷。 |

第二个坑值得单记：**同一个后端里，`/resume/parse` 直接返回结果对象（无 `success/data` 信封），
`/me/ai-records` 返回 `{data:{items:[]}}`。** 探针里凡是取字段，都要按端点实际形状取，
不能假设整套 API 信封一致。

### §4.2 本地证不了的部分

岗位匹配闭环（本地 provider 未配置）、模拟面试闭环（同样依赖未配置的语音 / LLM 路径）。
两条都不按 PASS 记。

## 附五：§4.1「账号与资产」本地取证（2026-09-08）

### 一、空闲退出 / 忙碌豁免 —— **不用新写，既有 CI 套件已覆盖**

动手前先查了既有资产：`apps/kiosk/tests/visual/kiosk-privacy-timeout.spec.ts`，**23 条用例**，
配置 idle 3s + 忙碌锁顺延 2s（`VITE_KIOSK_PRIVACY_BUSY_DEFER_SEC`），
由 `ci.yml:1053-1054` 的 `test:browser:privacy` 与 `test:browser:warning` 两条 job 在 CI 里跑。

覆盖面比清单那两条更宽：

```
member report hard-replaces a clean homepage after the privacy deadline
member privacy clear sends the original bearer and blocks authenticated re-entry
manual profile logout clears token-bearing cashier history
legal documents cannot suspend an authenticated kiosk privacy deadline
anonymous interview state is hard-cleared and browser back cannot restore it
older sensitive history entries are sanitized after a privacy boundary
privacy clear truncates sensitive forward history after the user went back
privacy clear remains fail-closed when session storage rejects the boundary write
```

**本地复跑：`23 passed (2.4m)`。**

**所以没有新写用例。** 重复覆盖只增加维护面，还会让人误以为多了一层保障。
**动手前先查既有资产，是比写得快更重要的一步。**

### 二、会话闭环 —— 脚本 `apps/kiosk/scripts/probe-member-session-41.mjs`，5 PASS

```
PASS  手机号登录成功            201，拿到 token
PASS  登录态可读本人资产        GET /me/documents 200
PASS  验证码不可重放            重放同一码 → 401 SMS_CODE_EXPIRED
PASS  登出后旧 token 立即失效    logout 201，之后同一请求 401
PASS  未登录不返回数量          401，响应里 0 个计数字段
```

第 2 项是第 4 项的**内建阳性对照**：同一个 `GET /me/documents`，登出前 200、登出后 401。
**这才证明第 4 项分辨得了「登出了」和「没登出」**，而不是那个接口本来就总是 401。

### 三、两个「不是缺陷」的失败，值得记

| 现象 | 真相 |
|---|---|
| 登录连续 401 | `SMS_IP_LIMIT` —— 一天的探针把短信接口 IP 小时配额打满了。**这是频控在正常工作**。本地隔离环境清 `member:sms:ip:*` 计数键即可，做法写进脚本注释。 |
| 登录莫名 401（另一种） | 探针按 `codes.at(-1)` 从**共享日志**取验证码，而并行探针与上一轮残留都往同一个日志写，经常拿到别人的码。**症状像「登录坏了」，实际是探针取错了值。** 改为按本次手机号掩码（`138****9179`）匹配。 |

第二条是本轮第三次同形错误：**探针从共享资源里取「最后一条」，而共享资源有别的写者。**

### §4.1 本地证不了的部分

QR 扫码登录、二维码基址可被手机访问 —— 需要真手机与 Terminal Agent，不记。
