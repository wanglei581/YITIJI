# Kiosk 测试「断言不存在」静态审计（2026-09-08）

## 为什么做这次审计

`kiosk-visible-actions-truth.spec.ts:327` 原本写着：

```ts
expect(payload.factsConfirmedAt).toBeUndefined()
```

用例已经勾完事实核对墙、点了「确认导出」，页面也确实把时间戳传给了
`exportGeneratedResume(..., { factsConfirmedAt })`。而规格（`ResumeGenerateExportDto`）
写的是**登录用户导出必填**。适配层当时漏发了这个字段，写用例的人**照着观察到的行为**
把它固化成了期望值。结果所有登录会员的简历优化导出 100% 失败，一路绿着活到今天
（根因与修复见 PR #946 与 `interaction-sweep-2026-09-08.md` 的 D1）。

**这不是「测试没覆盖」，是「测试覆盖了，但覆盖的是错的那一面」。** 所以要问一遍：
kiosk 测试里还有多少条「断言某东西不存在」，其实是照着当时行为写的？

## 范围与口径

只读扫 `apps/kiosk/tests/` 下全部 **28** 个 `.spec.ts`，不改任何文件。

命中口径：断言「某个请求 payload / 响应字段 / DOM 属性 / 会话状态不存在或为空」。
含 `toBeUndefined()`、`toBeNull()`、`toHaveCount(0)`、`toBeHidden()`、`toEqual([])`、
`not.toHaveProperty`、`not.toHaveAttribute`、`not.toContain*`，以及项目里等价的
`toBe(false)`（溢出 / 禁用 / token 未持久化）。已排除 `not.toBeNull()`、
`not.toHaveCount(0)` 这类**在断言存在**的。

分类：
- **A** —— 规格本来就要求不存在（合规禁词、隐私字段、fail-closed），正当。
- **B** —— 看不出规格依据，像是照着当时行为写的。
- **C** —— 网撒得比规格宽，可能连带把「该有的没有」也冻成绿，需要人按产品意图判。

## 结论

| 分类 | 条数 |
|---|---|
| A 正当缺席 | 309 |
| **B 可疑** | **1**（已修） |
| C 需人判 | 2 |
| 合计（按行去重） | 312 |

按匹配器分布：`toHaveCount(0)` 189、`toEqual([])` 67（约 66 条是 pageerror / 泄漏 /
空请求）、`toBeNull()` 13、`not.toContain*` / `not.toHaveText` 17、`toBe(false)` 10、
`not.toHaveAttribute` 7、**`toBeUndefined()` 6**、`toBeHidden()` 2、`not.toHaveProperty` 1。

**B 类只有 1 条，就是已修的 `factsConfirmedAt`。** kiosk 测试里没有第二处把
「适配层漏发的业务字段」写成期望值；`benefitGrantId` 等收费字段根本没有被断言为
undefined。这条结论本身是好消息 —— 说明这是个别失误，不是系统性习惯。

## C 类两条（留给产品判断，本次不动）

### 1. `apps/kiosk/tests/visual/print-done-truth.spec.ts:136`

```ts
await expect(page.getByRole('group', { name: '满意度评分' })).toHaveCount(0)
```

实现注释写「满意度只在确认完成时收」，评分分组在反馈弹层里，且
`showSatisfaction={resultState === 'completed'}`。这条用例确认的是**完成态**，
却从未打开反馈弹层，然后断言分组为 0。

它可能只是在说「评分不能裸露在完成页主界面」（那是 A），**也可能把「完成路径根本没
把评分面露出来」冻成了绿**。要对照的产品问题是：完成页是否必须能收到分？

### 2. `apps/kiosk/tests/visual/career-plan-materials.spec.ts:119`

```ts
await expect(materials.getByRole('button')).toHaveCount(0)
```

同一用例已经正向锁了「登录后可看到你已保存的材料」、不得写「0 份」、且不打
`/me/resumes` —— 那些都是 A。但「整列 0 个 button」**网撒得太宽**：如果规格要求这列
给匿名用户一个「去登录」入口，这条断言会把「缺登录 CTA」也一并冻绿。

## 该记住的一条

写「断言某东西不存在」时，先问自己一句：**这条是照着规格写的，还是照着我刚看到的行为写的？**
两者在当下长得一模一样，但前者会在缺陷出现时转红，后者会在缺陷出现时保持绿。

配套的另一面见同批 PR：光查「没说错话」（黑名单）不够，还得查「该说的说了」（正向断言）。
两条合起来才是完整的走查判据。
