# Kiosk 高保真原型 · Wave P 冻结清单

**冻结日期**：2026-07-23  
**分支**：claude/keen-merkle-ebec7f  
**冻结提交**：引入本文件的提交（PR #325）；该提交 tree 即冻结基准，后续修订须在本文件追加修订记录  
**阶段**：P5 · 双模型审查 + Critical/High 全部清零 → 冻结  

---

## 冻结文件统计

| 类型 | 数量 |
|------|------|
| 原型 HTML（77 UNIQUE_PAGE + 4 变体 + 1 子状态） | 82 |
| 导航索引 | 1（index.html） |
| 共享样式 | 1（shared.css） |
| 共享脚本 | 1（shared.js） |
| **合计** | **85** |

86 path 收口：77 UNIQUE_PAGE + 5 REDIRECT_ALIAS + 4 FALLBACK_PLACEHOLDER  
= 74 已有原型 + 3 P3 缺图补充（76/77/22B）+ 4 P3 状态变体（15A/32A/34A/76A）+ 1 子状态（73-assistant-call，不计入 86）

---

## P5 审查发现与处置

### Critical（已清零）

| # | 发现 | 处置 |
|---|------|------|
| C-1 | 72 页「打印机正常·A4纸充足」为纯静态文案，无 Terminal Agent 绑定 | index.html 说明块加入⚠️**生产绑定合约**，明确此为原型示例，生产必须对接 Terminal Agent 心跳遥测，断线时诚实降级 |
| C-2 | 同 C-1，设备在线态均无真实 API 连接 | 同 C-1（同一合约覆盖） |
| C-3 | 14-profile.html 「我的资产」标题违反 2026-06-14 IA 整改决定 | 标题改为「我的记录与资料」，副文案改为「快速进入，明细在对应业务页查看」，CSS 类 `.asset-grid` → `.entry-grid` |

### High（已清零）

| # | 发现 | 处置 |
|---|------|------|
| H-4 | index.html + WAVE-P2-FLOWS.md 中 AI服务记录 proto 编号错为 (22)，应为 (19) | 两个文件均已修正；WAVE-P2-FLOWS.md 全文替换（4 处） |
| H-9（冻结后补正，跨会话审查发现） | index.html 将 60/61（会话超时/网络异常）标注为「生产 placeholder，1:1 落地属新增功能」——**与生产事实不符**：`SessionTimeoutPage`/`ErrorOfflinePage` 组件已在 `origin/main`（commit ff09a692）真实实现（30s 倒计时登出、`/api/v1/health` 轮询重连），违反硬诚实性 | 已改为「页面组件已在 main 真实实现；当前尚无自动触发接线（idle 走屏保/静默登出，断网仅置首页设备标志），生产需补接触发路由」；index.html 校验和随之更新为 `4978c0a9…90ebf9`。**真实缺口重定性**：不是「页面缺实现」，而是「触发路由未接线」 |

### Medium（已清零）

| # | 发现 | 处置 |
|---|------|------|
| M-5 | index.html token 与 shared.css 漂移（--wheat-soft / --r-sm） | 已对齐：`--wheat-soft:#f2ead6`，`--r-sm:14px` |
| M-6 | Flow 1 描述「主链路九步」实列 8 项 | 改为「主链路八步」并补全 proto 编号（77→31→64→03→65→32→04→33） |
| M-7 | 覆盖表 Flow 11 行「[feedback]」占位未替换 | 已替换为 22B |

### Low（已降级/保留注释）

| # | 发现 | 处置 |
|---|------|------|
| L-8 | 53-companies.html / 50-campus.html CTA 文案需确认白名单 | 经查 compliance-boundary.md §4.5 已明确授权「去来源平台查看」，无需改动；注释保留 |

---

## 生产实现强制合约

### 设备状态绑定（对应 C-1/C-2）

原型中所有「打印机正常」「设备在线」「A4纸充足」均为**静态示例**，不与任何 API 连接。  
生产实现 **必须**：
- 将上述状态芯片替换为 Terminal Agent `/heartbeat` 遥测的实时数据
- Agent 心跳未就绪或连接断开时显示「设备状态未知」或「连接中」
- 禁止在真实设备离线/未知时继续显示「正常」态
- 约束来源：CLAUDE.md §3「不伪造硬件状态」；docs/compliance/compliance-boundary.md

### 「我的」页信息架构（对应 C-3）

14-profile.html 现状：入口 + 概览 + 本次记录，**不聚合资产明细**。  
生产实现 **必须**：
- 「我的」页（ProfilePage.tsx）保持入口 + 概览，不重建「账号资产/资产中心」聚合区
- 各数据分类明细（简历/文档/AI记录/打印订单等）在对应业务页独立展示
- 不新增 AccountAssetsPanel 或等价聚合组件
- 决策来源：docs/product/feature-scope.md 2026-06-14 IA 整改条目

---

## SHA-256 文件存证

```
07044df6043e0ff345121f692e3ff4829c33b30a2aa3a3f99b20faef8cac84b4  50-campus.html
09f91108c289fd905115c405b4c98b0a4a44fdcaf31f46cc04896022c688f08d  22-me-notifications.html
0b978a5a0354059d2fea6863a5ab38df5f189d3ae489aa8c609fcb8958715549  44-fair-companies.html
0d7cbd8b6e9991f74ff748a9709a3302db70cdcaceac3f1a50ec4af608559e0e  04-print-progress.html
0f300912120ea190082bb24de132fc6ffab3cabd89f668ddef8f936b65fc70de  68-print-scan-feature.html
149f8be37d1bd92a8765f0bbd58c865fb2e6a6d5f465c900da74b40208a237fc  02-print-hub.html
1827b444f14b48c5dca23f9a4eea437770623a0a01254580f67e15093b5cb84c  01-home.html
183e377ea59a1d47f11e0b1df44138cc16570932780b6d9a0a003038ee6627a6  61-error-offline.html
1888af78ff2350d5b8abe424cea5b4a380f919b17dad6919c0a641437d3e7873  12-policy.html
1b278a3a1280a71ae61d4535c29d5ebea79e54129a0dff2195a0bdfb2d5f9cfc  42-interview-reports.html
1d9e77c571003e251f1faa31b994efe2cef1585885da14347c191417fecd1509  59-legal.html
1dd202fd63e732d9b83b343f6fb70b9735f6c9d657fe39551ab0ae8830ee0d02  27-resume-parse.html
2532c60ca05f8c83fa53da6c6637d983d529e9df6cc8511b0d2682ffe2eeab12  03-print-settings.html
258f230f8ea64e21751039e966f8221179b30adba5184a582ad3b8e4d205b46e  37-scan-result.html
26a83f94d140c5c7021c47d6fc11cbcad7107e21fff184504722cbe4f5135569  23-me-settings.html
2e91923d55d842124ea25a1149f264d82f4017960a29e6df20a7649aebfd8415  07-resume-optimize.html
2f987e8bed72d6a9c24720e0c9c95139b185b54c6abf6e402d509e5ff0a203fe  20-me-favorites.html
3019392e42efe986c146c3a4ee3d027e789fe66044d236b58419afee510021a8  17-me-documents.html
331cb9bbc03d8f6d5df2e247c82a1906e643ad8853ef9e8ca7243db86c7de10a  24-activities.html
363b9d369facd6807a382f28d731f373b578c6e91c5e5c2c0ae143651041444e  14-profile.html
3776a3b5309bdf5e335643e76b6e20854c2dff776ff7d3e157b878fedd92b493  52-smart-campus-service.html
385a9db72d39d15308671ee4659a55a3dcf1ace6c000dd7111999ef86d665d18  26-resume-generate-preview.html
3cb488fbca985ee74989a535eef270571adc7f3ed80c77f692ded72da95d67f1  32-print-cashier.html
3f9f3c5b0d63a186424f08a7c95020150b4c8946ffaeb751c82dc0f60be01611  71-me-activity.html
4245f1348000037fa90bc6ecf162ec5cd1d6ae2701eda494f3aaf7d4e13f71d6  69-smart-campus-welcome.html
450ecdc03483178d5e615824ad59717e9f4a11a71bc7607910662f7ca275f3ed  76-toolbox-zone.html
46e2ffd16098a53c22bf6b12d14c9ab5536790e6b07e6f3e95ac3469c9ff1cf6  56-career-plan.html
4aeb3859adc0e786ac755c271d3f3efdcc3159550ec8b3b61fcae6bf72110ad5  30-resume-materials.html
4b253d23da9f6ea109c4acd45907ad32dc049bde2f1c74982dd93a86d436b031  08-jobs-list.html
5651dc2ddcb14487c6eac9e5ded859b525dabd1a21a63ef8e2cdc384df32557b  38-interview-setup.html
57cbfebb415f4581b6ae61571fb0b94b54289eced46c8d1040b11f2a612079a1  58-help.html
59efd16c79e9b0c5bf0c4e51212dd92c9129338e4e99eb0c1e70b66a3b61aa50  75-offline-agencies.html
59fb80b65101895a56fd5107e8932e6d31daaa172b70f618207a2d0213a6cc95  63-qr-login-mobile.html
5bd8a0d7253b7bd0d5d3856dfbe68f84363a8b1adbf6c9d88f4b34aa4c175f54  06-resume-diagnosis.html
6d198a4cec59b8a10d9bb37e55ef6f01539d9d8283fd7f5644b4ba19651e7302  34-scan-start.html
76a5fe9a3d3a26df1ca8bf9b10651327ee84793891fef7c985ff8bd80abe153d  53-companies.html
77e4606bec29c710fa89b5b26c40dc9d738ee226ed13ec9e82640187af379174  49-fair-stats.html
7869f8e64fceba6d7b041847fc744dd334993bda92c23e1628521433673ad0ef  40-interview-report.html
7b304d55c9549be9a14c3194e11b88de3744b3ae8a357f5c7d0089023248024b  66-print-scan-convert.html
7c9272c0a95bfa242a15ba96171ecb31258c266a5546d6a0561e0698bb10c344  10-fairs-list.html
7db29d2854193cb7ef281498a1fcc34b79ac516fcad99656609fe0449d2c5445  31-print-material-check.html
8167069684a77bfe4df4dae44f87901abfd155f842f2c4c97a36c9545633919f  77-print-upload.html
822f902b2557e8656b2547e33921d92f6e6b95bd1d6146ce586d98e59adf6751  28-resume-export.html
8389d9fe39b02ea253ee62e82a74d45da2cd92aaf90a153f31ee788a564f296e  54-company-detail.html
84e353b3d042d930c39270e03622d580b1416a0ba018f2236198f7015c7e748c  51-smart-campus.html
86b03d3b6373b3abf375d4ab4133681b0b88e2f6907ae254bf95633eeee26a8c  shared.js
882675efba6c72047812fd8567286d6b1b9397c47c009c97bf060762bdff4741  19-me-ai-records.html
895f186906db07a8bc2900924f70af65e56d669653c5d4315694ecd8d24e774d  22B-me-feedback.html
8b0d6abfbe2b5ec36317a0615c5e98943f55f22c906f600cded556ecc85db976  34A-scan-offline.html
8e04af61fb45bccd05273c95219a4772735933e48f387a7d995e995474a229d1  05-resume-source.html
8e6494e43b374adb8ca076ce4890db29c84d805e5b469c901c765e8b0093cc34  15A-login-error.html
8faad768d778602b1cdc3114b6cecef4f0e436279a29ef93b686f78868fbaa19  55-job-fit.html
8fcfda363bf4652caeb019a7ce932150e3176dc93ba3e4fb6dac11da259fd787  21-me-benefits.html
9b00b902feed6004a1d4c778ebdf5a5d7144db57db5b9c8c726776fa6ea814d1  76A-toolbox-empty.html
a1978fe24d76b1caaae1bbb521c52723ba4f3ce92b157ba1dcc3b2533c226b41  39-interview-session.html
a449b159f1b4b2a727206062eb58e063be5ab85694a1f5a95395142abc810285  67-print-scan-sign.html
a47d4549e19494db6be9b91d9478793c16fa6b9ef61631f75c89bd86c2d4c700  32A-cashier-failed.html
a4e888da08c4d89d62f9d14d46f8f2450106a2cc73c35d093d7e2bc49006c804  11-fair-detail.html
a52ca0dfee86ce7dea20ebed0879c74719ad659e6fd1911a6d7efc18e2d278e7  36-scan-progress.html
a63c1033d59205b1af5cd3a0a23def3ec455dbe1d63082dc3d38d0e04e48f849  41-interview-tips.html
a8a367108f71eaf9b01dc7a6d41fa2367aaa177a1b9993ee8f57d7c2fb369daa  16-me-resumes.html
a9a14838dafe321c0a82645aac1c0279c37f3088df97db8502224d11946f4e97  18-me-print-orders.html
a9d5fe5436894c0495b94eb85eedc374a0103bbd597eaf250a2bd6b247afb3b9  shared.css
aa4fa7d0b5a31bda3f38f70c4db7057afd0a9dffabdc39a7f1138374b595f284  25-resume-generate.html
aec2a60a58cd83f4b94c2514b7b262450851cef6a38b2b57aed3c4e26163029e  48-fair-visit-plan.html
af5b9256938a639ca6fbf5d294579f059aab8a4fcf51f0281d73505080033291  70-freshman-insights.html
b2f18ee24c41e05f54ea564f8ce8740bb58655944aaa986502deb5d8cd1882d7  73-assistant-call.html
bc8b266d9d01e49921b020e8c39d045b4e2d31b09e946b96f6e87e77b963d64a  15-login.html
c029e3d646fff8d16659ae0cdcd5804f1ce10999d7748ec50df10d1531d31860  35-scan-settings.html
c053962731ec204aecf251d8095c144ad461592dd5b45061e71902b655d51f3f  62-phone-upload.html
c560afae2d1c9408a9bc41415741602b3fe6f1e111d29cd7d4c085c327c27aa6  46-fair-map.html
c9172efefc01b89da95baf85745f87004130753378bef9b7e24a067e41340bc1  64-print-preview.html
cc4abc1e4ff0351c4fd03ed6d2cbaaaf98b08952e21b1fd5e1b0acda0125f69b  13-assistant.html
d11e49b58b8df11a68faa42154fba1b6f166ff8d2a085c2a5aedc6d88637bc6f  72-activity-detail.html
d66a934ac13f70722c58e121119c42c1df9fe20c55df2a0ddef5127a323be9ac  60-session-timeout.html
d753e7bb92daa548219be5b01ff4a0d7a6d3a1a85ac892cd0481b34c593e71e0  45-fair-company-detail.html
d986f8ee85c76d2f047fbdda2cba8715a76496a211a2d3c0852b0c810e243f80  09-job-detail.html
d9fe6ffc1b3d7efc35db3f1963468ba31d0b9f66eab1d09b47e73cb629dadc3c  65-print-confirm.html
4978c0a9eaa21f063d3635b2e383bc590ea5570b669108fd02d236023590ebf9  index.html
ddb5479f393d1788540cd5f3b6d05729d2990cde8a8545cd04cae11331767c66  47-fair-materials.html
e93fcace7cf8ff577faa479dd85656faf9dfe00cb1ab9432ad539ca008611c8a  33-print-done.html
eecfcde8b051558940caf94894667b4e1b9e7a5769df93bbee3a6b69dc08ef4c  57-screensaver.html
f07e1d6a017b61b0014694be637279b9390014684e95618ad83d5e726a036ba0  29-resume-templates.html
f12432538c116b262ab4ee2720eeeec2427dfe8e7a437352ff9280bad507aa4d  43-fair-checkin.html
f4d14f4e34d520585474a0c4b6f7eeb74b7f14a5c543046448e52dd601ea4fac  74-job-detail-offline.html
```

---

## 冻结约束

**冻结后禁止事项（直至下次版本变更记录）：**
1. 禁止修改本目录中任何已冻结原型文件的视觉布局或流程跳转
2. 禁止新增不在 WAVE-P-CLOSURE.md 86-path 收口清单中的新原型页
3. 禁止将原型中的任何「诚实降级」或「即将上线」标注替换为假完成态
4. 生产 Kiosk UI 改动必须以本目录为视觉与流程基准，不得偏离
5. 任何对原型的后续修订须更新本文件的 SHA-256 存证并注明修订原因

**允许（不破坏冻结）：**
- 在 index.html 的说明段添加纯文字注释/澄清（不改 proto 文件）
- 生产代码以本原型为规范进行1:1实现
- 在新版本分支（非本目录）进行实验性迭代
