# 任务包：会话生命周期四页迁入青序流光

一体机前台正在从 V6 壳迁到「青序流光」51 页新稿。本批做**会话生命周期**这条链，
四页一起做（它们共享同一套会话状态，拆开会互相踩）。

工作目录就是当前目录。分支 `feat/qx-session-lifecycle`，已从最新 `origin/main` 建好。

## 四页 ↔ 稿 ↔ 路由

| 稿 | 路由 | 现有页面 |
|---|---|---|
| `00-standby` | `/screensaver` | `src/pages/screensaver/ScreensaverPage.tsx` |
| `03-login-gate` | `/login` | `src/pages/auth/LoginPage.tsx` |
| `04-session-guard` | （无独立路由，是守卫态） | 见 `src/auth/` |
| `07-session-resume` | `/session-timeout` | 见路由表 |

稿在 `docs/design/kiosk-redesign-2026-08/`。**看稿要带 `?capture=1`**，
裸 `?state=` 会 fail-closed 成空态（夹具门）。

## 绝对禁止改的路径（越界判 FAIL）

- `apps/miniapp/**`、`.github/**`、仓库根 `scripts/verify-*`
- `services/api/**`
- `apps/kiosk/src/pages/resume/**` 与 `apps/kiosk/src/pages/profile/me/MyDocumentsPage.tsx`（另一会话的 lane）

`apps/kiosk/scripts/verify-*` 可以改，但**只许同强度替换**：
`git diff origin/main...HEAD -- apps/kiosk/scripts/ | grep -c '^-.*assert\.'` 删掉的每一条
都要有等价或更强的替代，并在提交里逐条说明。

## 先照着两个已合的先例看，别自己发明

从 `origin/main` 拉下来读：
- 打印台：`src/pages/print/PrintDeskPage.tsx` + `printDeskModel.ts`
- 面试台：`src/pages/interview/InterviewWorkbenchPage.tsx` + `interviewWorkbenchModel.ts`
- 扫描台：见 PR #984 分支 `feat/qx-scan-merge`

形态统一：**小编排页 + 每阶段一个子组件 + 一个纯函数的阶段模型（模型有单测）**。

## 六条硬验收（缺一不合入）

① 按对应稿实现 + 1080×1920 截图对照；主按钮 ≥56px，可点区 ≥48px
② 每个按钮有真实去向或动作，无死按钮无占位
③ 读真实接口，空/错/载三态齐全；**不伪造「已完成/已保存/已登录」**
④ 该页承诺的产出真的产生
⑤ 按钮文案在合规白名单内
⑥ 路由 E2E 用例 + 该页专属断言进 CI

## 这批特有的三条（比上面还硬）

**⑦ 每一页都要能离开。** 一体机没有浏览器后退键、没有手势返回。
2026-09-08 已经出过事：15 个已迁页全都没有返回键、收银台丢了「退出支付」，
CI 全绿、评审通过，用户点进去出不来。所以每页先回答：
「从这页怎么回上一步」「有没有『什么都不做就走人』的出口」。
终态页除外（出口是它自己的主行动）。
`QxPageFrame` 有 `back={{ label, onBack }}` 槽，落点取自稿里的 `data-route`。

**⑧ 这四页是公共终端的隐私边界，不许放松。**
- `/screensaver` 唤醒后**不得**残留上一个人的任何内容
- `/login` 是登录门本身，不许出现「已登录」的伪造态
- 会话守卫 fail-closed 之后**必须有归途**，不能只是拦住
- 清场走 `src/auth/kioskSensitiveSession.ts` 的**集中式**清理，
  **不许改成挂组件销毁**（漏一个分支下一个排队的人就看到上一个人的数据）

**⑨ 不许为了过门禁改文案。** 撞到禁词扫描先看是不是免责声明
（门禁已能剥离否认句），是的话说明判据、不要改措辞。

## 判据

- 先按 CLAUDE.md §14 查图谱：`node scripts/project-graph-query.mjs file <路径>` / `route <路由>`
  图谱是预筛不是权威，最后跑 kiosk 全量 verify。
- 门禁从 **`apps/kiosk` 目录**跑（`cd apps/kiosk && node scripts/verify-xxx.mjs`），
  在仓库根跑会因为读错 `package.json` 误判。
- 加了新断言必须**反向变异验证它真能红**：把被测行为改成错的，用例应转红；
  不红说明断言是空的。注意门禁按顺序执行，前一条会遮蔽后一条，
  验新断言要让前面的先通过。

做完 commit + push + `gh pr create`，不要问我。PR 描述要有「旧控件 → 新落点」对照表。
