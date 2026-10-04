/**
 * verify:beijing-display-time —— 给人看的时间按北京时间（走查 W-78）。
 *
 * 固定 UTC 时刻 2026-09-29T16:30:00Z，必须显示成北京时间 2026-09-30 00:30。
 * 每类出口各断言一次。改回 UTC 输出时，下面每一条都要变红。
 *
 * 不连数据库。Run: pnpm --filter @ai-job-print/api verify:beijing-display-time
 */
import { formatBeijingDate, formatBeijingDateTime, formatBeijingMinute } from '../src/common/beijing-display-time'
import { formatElapsedAgo, formatShanghaiMinute, printFailedAlertDetail } from '../src/admin-ops/derived-alerts'
import { contractReviewGeneratedAtLine } from '../src/contract-review/contract-review-report-pdf.service'
import { formatFairCompanyPrintTime } from '../src/jobs/fair-company-print.service'
import { bulkPublishExpiredMessage } from '../src/bulk-publish/bulk-publish-expiry'
import { prismaFairToListItem, prismaJobToListItem, type PrismaJobFairRow, type PrismaJobRow } from '../src/jobs/jobs-shared'
import { dailyBriefCalendarDate } from '../src/assistant/daily-brief.service'
import { diagnosisReportDateLabel } from '../src/ai/resume/diagnosis-report-pdf.service'
import { interviewReportDisplayDate } from '../src/mock-interview/mock-interview.service'
import { selfAssessmentReportDate } from '../src/ai/resume/self-assessment.service'
import { jobFitReportDate } from '../src/ai/resume/job-fit.service'
import { careerPlanReportDate } from '../src/ai/resume/career-plan.service'
import { fairVisitPlanReportDate } from '../src/ai/resume/fair-visit-plan.service'
import { advisorArtifactReportDate } from '../src/advisor/advisor-artifact.service'
import { resumeReportFilenameDate } from '../src/ai/resume-report-export.controller'

const FIXED = new Date('2026-09-29T16:30:00.000Z')
const MIDNIGHT = new Date('2026-09-29T16:00:00.000Z')
const MINUTE = '2026-09-30 00:30'
const SECOND = '2026-09-30 00:30:00'
const DATE = '2026-09-30'

let checks = 0
let failures = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  PASS ${name}`)
    return
  }
  failures += 1
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
}

function jobRow(syncTime: Date): PrismaJobRow {
  return {
    id: 'job-1',
    sourceId: null,
    sourceOrgId: 'org-1',
    externalId: 'ext-1',
    sourceName: '示例来源',
    sourceUrl: 'https://example.com/job',
    title: '岗位',
    company: '单位',
    city: '上海',
    category: null,
    salary: null,
    description: null,
    requirements: null,
    tagsJson: '[]',
    educationRequirement: null,
    experienceRequirement: null,
    skillsJson: '[]',
    benefitsJson: '[]',
    salaryMin: null,
    salaryMax: null,
    salaryUnit: null,
    validThrough: null,
    headcount: null,
    reviewStatus: 'approved',
    publishStatus: 'published',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    syncTime,
  }
}

function fairRow(syncTime: Date): PrismaJobFairRow {
  return {
    id: 'fair-1',
    sourceOrgId: 'org-1',
    externalId: 'ext-1',
    sourceName: '示例来源',
    sourceUrl: 'https://example.com/fair',
    checkinUrl: null,
    title: '招聘会',
    theme: '综合',
    startAt: syncTime,
    endAt: syncTime,
    venue: '会场',
    city: '上海',
    address: null,
    mapImageUrl: null,
    description: null,
    coverImageUrl: null,
    companyCount: 0,
    jobCount: 0,
    viewCount: 0,
    reviewStatus: 'approved',
    publishStatus: 'published',
    reviewedBy: null,
    reviewedAt: null,
    rejectReason: null,
    syncTime,
    updatedAt: syncTime,
    latitude: null,
    longitude: null,
    trafficInfo: null,
    expectedAttendance: null,
    seekerIntentJson: null,
  }
}

check('共用函数：分钟跨日', formatBeijingMinute(FIXED) === MINUTE, formatBeijingMinute(FIXED))
check('共用函数：秒跨日', formatBeijingDateTime(FIXED) === SECOND, formatBeijingDateTime(FIXED))
check('共用函数：日期跨日', formatBeijingDate(FIXED) === DATE, formatBeijingDate(FIXED))
check('共用函数：零点是 00 不是 24', formatBeijingMinute(MIDNIGHT) === '2026-09-30 00:00', formatBeijingMinute(MIDNIGHT))

check('告警正文', printFailedAlertDetail({ id: 'task-1', terminalCode: 'T-1', updatedAt: FIXED }) === `任务 task-1 · 终端 T-1,失败于 ${MINUTE}`, printFailedAlertDetail({ id: 'task-1', terminalCode: 'T-1', updatedAt: FIXED }))
const MIN = 60_000
for (const [ms, want] of [[40 * MIN, '40 分钟前'], [59 * MIN + 59_000, '59 分钟前'], [60 * MIN, '1 小时前'], [125 * MIN, '2 小时 5 分钟前'],
  [24 * 60 * MIN, '1 天前'], [5211 * MIN, '3 天 14 小时前'], [(30 * 24 + 1) * 60 * MIN, '30 天 1 小时前'], [-5 * MIN, '0 分钟前']] as const) {
  check(`离线时长「${want}」`, formatElapsedAgo(ms) === want, formatElapsedAgo(ms))
}
check('告警分钟与共用函数同一口径', formatShanghaiMinute(FIXED) === MINUTE, formatShanghaiMinute(FIXED))

check('签约风险提示纸上的生成时间', contractReviewGeneratedAtLine(FIXED) === `生成时间：${SECOND}  ｜  AI 生成`, contractReviewGeneratedAtLine(FIXED))
check('企业资料打印时间', formatFairCompanyPrintTime(FIXED) === MINUTE, formatFairCompanyPrintTime(FIXED))
check('诊断报告日期', diagnosisReportDateLabel(FIXED) === DATE, diagnosisReportDateLabel(FIXED))
check('模拟面试纸上的日期', interviewReportDisplayDate(FIXED) === DATE, interviewReportDisplayDate(FIXED))
check('自我探索纸上的日期', selfAssessmentReportDate(FIXED.toISOString()) === DATE, selfAssessmentReportDate(FIXED.toISOString()))
check('岗位匹配参考纸上的日期', jobFitReportDate(FIXED) === DATE, jobFitReportDate(FIXED))
check('职业规划纸上的日期', careerPlanReportDate(FIXED) === DATE, careerPlanReportDate(FIXED))
check('参会准备单纸上的日期', fairVisitPlanReportDate(FIXED) === DATE, fairVisitPlanReportDate(FIXED))
check('顾问产物纸上的日期', advisorArtifactReportDate(FIXED) === DATE, advisorArtifactReportDate(FIXED))
check('诊断导出文件名日期', resumeReportFilenameDate(FIXED) === '20260930', resumeReportFilenameDate(FIXED))

const jobExpired = bulkPublishExpiredMessage('job', { validThrough: FIXED })
check('批量发布岗位过期原因', jobExpired.includes(`已于 ${DATE} 截止`), jobExpired)
const fairExpired = bulkPublishExpiredMessage('fair', { endAt: FIXED })
check('批量发布招聘会过期原因', fairExpired.includes(`已于 ${DATE} 结束`), fairExpired)

const jobNote = prismaJobToListItem(jobRow(FIXED)).dataSourceNote
check('岗位来源说明', jobNote.includes(`同步于 ${DATE}`), jobNote)
const fairNote = prismaFairToListItem(fairRow(FIXED)).dataSourceNote
check('招聘会来源说明', fairNote.includes(`同步于 ${DATE}`), fairNote)

check('早报日期', dailyBriefCalendarDate(FIXED) === DATE, dailyBriefCalendarDate(FIXED))

if (failures > 0) {
  console.error(`\nFAIL verify-beijing-display-time (${failures} failed / ${checks} checks)`)
  process.exit(1)
}
console.log(`\nALL PASS verify-beijing-display-time (${checks} checks)`)
