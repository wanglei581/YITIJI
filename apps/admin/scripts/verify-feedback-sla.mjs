// C3「AI 内容投诉」答复时限门禁。
//
// 真执行 apps/admin/src/routes/member-feedback/feedbackSla.ts（typescript transpileModule
// 后在纯 node 下求值），不是搜源码字符串。断言的期望值都从 2026 年国务院节假日安排
// （国办发明电〔2025〕7号）手算得出，写在每条断言旁边，改日历或改算法算错一天都会红。
//
// 另有少量静态断言：意见反馈页确实在用这份纯函数（而不是自己再算一遍），
// 告警页的 AI 内容投诉告警能一键跳到按分类筛好的反馈页。

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const SLA = 'src/routes/member-feedback/feedbackSla.ts'
const PAGE = 'src/routes/member-feedback/index.tsx'
const BADGES = 'src/routes/member-feedback/FeedbackSlaBadges.tsx'
const ALERTS = 'src/routes/alerts/index.tsx'

let passed = 0
const failures = []
function check(condition, label, detail) {
  if (condition) {
    passed += 1
    console.log(`  PASS ${label}`)
  } else {
    failures.push(label)
    console.error(`  FAIL ${label}${detail ? `\n       → ${detail}` : ''}`)
  }
}
function read(rel) {
  const abs = join(appRoot, rel)
  if (!existsSync(abs)) {
    console.error(`  FAIL 文件不存在：${rel}`)
    process.exit(1)
  }
  return readFileSync(abs, 'utf8')
}

console.log('\n=== AI 内容投诉答复时限（feedbackSla）===')

// ── 0. 在纯 node 下加载（同时证明它零 import）──────────────────────────────
const transpiled = ts.transpileModule(read(SLA), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const mod = { exports: {} }
new Function('exports', 'require', 'module', transpiled)(
  mod.exports,
  (spec) => {
    throw new Error(`${SLA} 不得 import 任何模块（本门禁在纯 node 下执行它），实际 import 了 ${spec}`)
  },
  mod,
)
const sla = mod.exports
for (const name of ['AI_CONTENT_COMPLAINT_SLA_WORKDAYS', 'aiComplaintDeadline', 'aiComplaintSla', 'workdayInfo', 'shanghaiDayIndex']) {
  if (sla[name] === undefined) {
    console.error(`  FAIL ${SLA} 未导出 ${name}`)
    process.exit(1)
  }
}
check(sla.AI_CONTENT_COMPLAINT_SLA_WORKDAYS === 5, '时限常量为 5 个工作日（集中在一处）')

const deadlineOf = (iso) => sla.aiComplaintDeadline(iso)

// ── 1. 截止日 ────────────────────────────────────────────────────────────────
{
  // 9/29（周二，上海 10:00）提交：9/30① → 10/1–10/7 国庆 → 10/8② 10/9③ → 10/10（周六调休上班）④
  // → 10/11 周日 → 10/12（周一）⑤
  const d = deadlineOf('2026-09-29T02:00:00.000Z')
  check(d.deadlineDate === '2026-10-12' && d.estimated === false, '9/29（周二）提交 → 10/12（周一）截止，跨国庆且计入 10/10 调休', JSON.stringify(d))
  check(
    d.deadlineAt.toISOString() === '2026-10-12T15:59:59.000Z',
    '截止时刻是截止日上海时间 23:59:59',
    d.deadlineAt.toISOString(),
  )
}
{
  // 9/19（周六）提交：9/20（周日调休上班）① 9/21② 9/22③ 9/23④ 9/24⑤；9/25 起中秋放假不影响
  const d = deadlineOf('2026-09-19T04:00:00.000Z')
  check(d.deadlineDate === '2026-09-24', '9/19（周六）提交 → 9/20（周日调休）算第 1 个工作日，9/24 截止', JSON.stringify(d))
  check(sla.workdayInfo(sla.shanghaiDayIndex(new Date('2026-09-20T04:00:00.000Z'))).workday === true, '9/20（周日）是调休上班日')
  check(sla.workdayInfo(sla.shanghaiDayIndex(new Date('2026-10-10T04:00:00.000Z'))).workday === true, '10/10（周六）是调休上班日')
  check(sla.workdayInfo(sla.shanghaiDayIndex(new Date('2026-02-14T04:00:00.000Z'))).workday === true, '2/14（周六）是调休上班日')
  check(sla.workdayInfo(sla.shanghaiDayIndex(new Date('2026-10-05T04:00:00.000Z'))).workday === false, '10/5（周一）是国庆假期')
  check(sla.workdayInfo(sla.shanghaiDayIndex(new Date('2026-02-23T04:00:00.000Z'))).workday === false, '2/23（周一）是春节假期')
}
{
  // 3/6（普通周五）提交：3/7、3/8 周末跳过 → 3/9① … 3/13（周五）⑤
  const d = deadlineOf('2026-03-06T08:00:00.000Z')
  check(d.deadlineDate === '2026-03-13', '普通周五提交跨周末 → 下周五截止', JSON.stringify(d))
}
{
  // 提交当天不算：同一天上班时间提交也从下一个工作日起数
  const morning = deadlineOf('2026-03-09T00:30:00.000Z') // 上海 3/9 08:30（周一）
  check(morning.deadlineDate === '2026-03-16', '提交当天不算：周一上午提交 → 下周一截止', JSON.stringify(morning))
}
{
  // 时区：UTC 9/28 16:30 = 上海 9/29 00:30 → 按 9/29 算 → 10/12；
  //       UTC 9/28 15:30 = 上海 9/28 23:30 → 按 9/28 算：9/29① 9/30② 10/8③ 10/9④ 10/10⑤
  const afterMidnight = deadlineOf('2026-09-28T16:30:00.000Z')
  const beforeMidnight = deadlineOf('2026-09-28T15:30:00.000Z')
  check(afterMidnight.deadlineDate === '2026-10-12', 'UTC 16:30 按上海次日算（9/28 16:30Z → 9/29 → 10/12）', JSON.stringify(afterMidnight))
  check(beforeMidnight.deadlineDate === '2026-10-10', 'UTC 15:30 仍是上海当日（9/28 15:30Z → 9/28 → 10/10）', JSON.stringify(beforeMidnight))
}
{
  // 2027 年：安排未公布，按周一至周五估算。12/31（周四）提交：2027-01-01（周五）① 1/4② 1/5③ 1/6④ 1/7⑤
  const d = deadlineOf('2026-12-31T04:00:00.000Z')
  check(d.deadlineDate === '2027-01-07' && d.estimated === true && d.estimatedYear === 2027, '跨入 2027 年按周一至周五估算并打上估算标记', JSON.stringify(d))
  const view = sla.aiComplaintSla({ category: 'ai_content', status: 'pending', createdAt: '2026-12-31T04:00:00.000Z' }, new Date('2026-12-31T05:00:00.000Z'))
  check(
    view?.kind === 'running' && view.detailLabel.includes('2027 年节假日安排尚未公布，按周一至周五估算'),
    '详情说明写出「2027 年节假日安排尚未公布，按周一至周五估算」',
    view && view.kind === 'running' ? view.detailLabel : JSON.stringify(view),
  )
  const plain = deadlineOf('2026-03-06T08:00:00.000Z')
  check(plain.estimated === false && plain.estimatedYear === null, '2026 年内的计算不带估算标记')
}

// ── 2. 状态与列表标签 ────────────────────────────────────────────────────────
{
  const createdAt = '2026-09-29T02:00:00.000Z' // 截止 10/12
  const at = (iso, status = 'pending') => sla.aiComplaintSla({ category: 'ai_content', status, createdAt }, new Date(iso))

  const first = at('2026-09-29T03:00:00.000Z')
  check(first?.kind === 'running' && first.listLabel === '剩 5 个工作日' && first.urgency === 'normal', '提交当天显示「剩 5 个工作日」', JSON.stringify(first))
  const lastBefore = at('2026-10-10T03:00:00.000Z', 'processing')
  check(lastBefore?.kind === 'running' && lastBefore.listLabel === '剩 1 个工作日' && lastBefore.urgency === 'soon', '处理中也计时；10/10 显示「剩 1 个工作日」且标为紧急', JSON.stringify(lastBefore))
  const dueToday = at('2026-10-12T15:00:00.000Z')
  check(dueToday?.kind === 'running' && dueToday.listLabel === '今天到期' && dueToday.urgency === 'today', '截止日当天显示「今天到期」', JSON.stringify(dueToday))
  const overdue = at('2026-10-13T16:30:00.000Z') // 上海 10/14 00:30：超过 10/13、10/14 两个工作日
  check(overdue?.kind === 'running' && overdue.listLabel === '已超期 2 个工作日' && overdue.urgency === 'overdue', '截止后按工作日计超期天数（上海时间）', JSON.stringify(overdue))
  const detail = at('2026-09-29T03:00:00.000Z')
  check(
    detail?.kind === 'running' && detail.detailLabel === '答复时限：10 月 12 日（周一）前 · 5 个工作日，已扣除法定节假日',
    '详情写「答复时限：10 月 12 日（周一）前 · 5 个工作日，已扣除法定节假日」',
    detail && detail.kind === 'running' ? detail.detailLabel : JSON.stringify(detail),
  )

  const replied = at('2026-10-20T03:00:00.000Z', 'replied')
  const closed = at('2026-10-20T03:00:00.000Z', 'closed')
  check(replied?.kind === 'stopped' && replied.label.includes('不再计时'), '已回复不再计时（即使已过截止日也不报超期）', JSON.stringify(replied))
  check(closed?.kind === 'stopped' && closed.label.includes('不再计时'), '已关闭不再计时', JSON.stringify(closed))
  for (const category of ['device', 'print', 'file_process', 'general']) {
    const other = sla.aiComplaintSla({ category, status: 'pending', createdAt }, new Date('2026-10-20T03:00:00.000Z'))
    check(other === null, `「${category}」分类不计时`)
  }
}

// ── 3. 页面接线（静态）──────────────────────────────────────────────────────
{
  const page = read(PAGE)
  const badges = read(BADGES)
  check(
    /from '\.\/feedbackSla'/.test(badges) &&
      (badges.match(/aiComplaintSla\(/g)?.length ?? 0) >= 2 &&
      badges.includes('sla.listLabel') &&
      badges.includes('sla.detailLabel') &&
      page.includes("import { DetailSla, FeedbackListChips } from './FeedbackSlaBadges'") &&
      page.includes('<FeedbackListChips item={item}') &&
      page.includes('<DetailSla detail={detail} />'),
    '意见反馈页列表与详情都用 feedbackSla 的结果渲染（不在页里另算一遍）',
  )
  check(
    page.includes("searchParams.get('category')") && page.includes("searchParams.get('status')") && page.includes('replace: true'),
    '意见反馈页从 ?category= / ?status= 初始化筛选，并以 replace 同步回地址栏',
  )
  const alerts = read(ALERTS)
  check(
    alerts.includes("to: '/member-feedback?category=ai_content'"),
    '告警页「AI 内容投诉待处理」可一键跳到按 AI 内容投诉筛好的意见反馈页',
  )
}

console.log('')
if (failures.length > 0) {
  console.error(`verify-feedback-sla: ${failures.length} 项失败，${passed} 项通过`)
  process.exit(1)
}
console.log(`verify-feedback-sla: ${passed} 项全部通过`)
