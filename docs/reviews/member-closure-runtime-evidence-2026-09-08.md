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
