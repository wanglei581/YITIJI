import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { PrismaService } from '../src/prisma/prisma.service'
import { ScreenSnapshotCache } from '../src/console-screen/console-screen.cache'
import { ConsoleScreenUsageService } from '../src/console-screen/console-screen.usage.service'
import { assert, inWindow, prepareDatabase, repeatAi } from './console-screen-usage-cases-01'
import { NOW, TODAY_START, BEFORE_TODAY, DAY30_START, BEFORE_30, HOUR1, HOUR4, HOUR7, PULSE_AI, YESTERDAY_NOON, PHONE, FILE_NAME, ORDER_SECRET, AiSeed, OrderSeed, PrintSeed } from './console-screen-usage-cases-07'



export async function assertBehaviorSetup(){
const isolated = prepareDatabase()
assert('u9. 隔离库文件名含 verify，且不是 prisma/dev.db', isolated.databasePath.endsWith('verify-usage.db') && !isolated.databasePath.includes(`${join('prisma', 'dev.db')}`))
const prisma = new PrismaService()
await prisma.onModuleInit()
const cache = new ScreenSnapshotCache()
const usage = new ConsoleScreenUsageService(prisma, cache)
const suffix = randomUUID().replace(/-/g, '').slice(0, 10)
const orgA = `org_usage_a_${suffix}`
const orgB = `org_usage_b_${suffix}`
const termLeak = `term_leak_${suffix}`
const adminId = `user_usage_admin_${suffix}`
const userA = `user_usage_a_${suffix}`
const userB = `user_usage_b_${suffix}`
const userBlank = `user_usage_blank_${suffix}`
const memberId = `eu_leak_${suffix}`
const phoneEnc = `enc_${PHONE}_${suffix}`
const fileUrl = `https://files.internal/${FILE_NAME}`
const orderNo = `${ORDER_SECRET}-${suffix}`
const jobJia = `job_jia_${suffix}`
const jobCold = `job_cold_${suffix}`
const jobDel = `job_del_${suffix}`
const jobB = `job_b_${suffix}`
const extraA = [1, 2, 3].map((index) => `job_ax_${index}_${suffix}`)
const extraB = [1, 2, 3, 4].map((index) => `job_bx_${index}_${suffix}`)
const policyA = `pol_a_${suffix}`
const policyAExtra = [1, 2, 3].map((index) => `pol_ax_${index}_${suffix}`)
const policyB = `pol_b_${suffix}`
const fairA = `fair_a_${suffix}`
const companyA = `co_a_${suffix}`
const fairCompanyId = `fc_${suffix}`
const owned: Record<'A' | 'B', Record<string, string[]>> = {
    A: { job: [jobJia, jobCold, ...extraA], job_fair: [fairA], policy: [policyA, ...policyAExtra], company_profile: [companyA] },
    B: { job: [jobB, ...extraB], job_fair: [], policy: [policyB], company_profile: [] },
  }
const browses: Array<{ targetType: string; targetId: string; at: Date }> = []
const favorites: Array<{ targetType: string; targetId: string; at: Date }> = []
const jumps: Array<{ targetType: string; targetId: string; at: Date; sourceName: string }> = []
const addBrowse = (targetType: string, targetId: string, at: Date, count: number) => {
    for (let index = 0; index < count; index += 1) browses.push({ targetType, targetId, at })
  }
addBrowse('job', jobJia, NOW, 6)
addBrowse('job', jobJia, HOUR1, 5)
addBrowse('job', jobJia, HOUR7, 5)
addBrowse('job', jobCold, HOUR4, 4)
addBrowse('job', jobB, NOW, 7)
addBrowse('job', jobDel, NOW, 6)
addBrowse('policy', policyA, NOW, 5)
addBrowse('policy', policyB, NOW, 4)
addBrowse('job_fair', fairA, NOW, 5)
addBrowse('company_profile', companyA, NOW, 4)
addBrowse('fair_company', fairCompanyId, NOW, 3)
for (const id of [jobJia, jobCold, ...extraA, jobB, ...extraB]) {
    favorites.push({ targetType: 'job', targetId: id, at: NOW })
  }
for (const id of [policyA, ...policyAExtra]) favorites.push({ targetType: 'policy', targetId: id, at: NOW })
for (let index = 0; index < 6; index += 1) jumps.push({ targetType: 'job', targetId: jobJia, at: NOW, sourceName: '公共就业' })
for (let index = 0; index < 5; index += 1) jumps.push({ targetType: 'job', targetId: jobJia, at: YESTERDAY_NOON, sourceName: '公共就业' })
for (let index = 0; index < 3; index += 1) jumps.push({ targetType: 'job', targetId: `gone_${suffix}`, at: NOW, sourceName: '小样本' })
for (let index = 0; index < 5; index += 1) jumps.push({ targetType: 'policy', targetId: policyA, at: NOW, sourceName: '公共就业' })
const ai: AiSeed[] = [
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 100, createdAt: NOW },
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 200, createdAt: NOW },
    { operation: 'parseResume', status: 'success', provider: 'llm:deepseek', estimatedCostCny: 1.5, latencyMs: 300, createdAt: NOW },
    ...repeatAi(2, { operation: 'optimizeResume', status: 'success', provider: 'llm:deepseek', latencyMs: 400, createdAt: NOW }),
    ...repeatAi(1, { operation: 'adjustResumeLayout', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'chatAssistant', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(1, { operation: 'chatAssistant', status: 'running', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'interviewQuestion', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'interviewReport', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(5, { operation: 'careerPlan', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(4, { operation: 'selfAssessment', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(5, { operation: 'jobRecommend', status: 'success', provider: 'llm:other', createdAt: NOW }),
    ...repeatAi(4, { operation: 'classifyIntent', status: 'success', provider: 'llm:deepseek', createdAt: NOW }),
    ...repeatAi(4, { operation: 'classifyIntent', status: 'success', provider: 'llm:deepseek', createdAt: PULSE_AI }),
    ...repeatAi(5, { operation: 'voiceTranscribe', status: 'success', provider: 'llm:qwen', createdAt: NOW }),
    ...repeatAi(3, { operation: 'voiceSynthesize', status: 'success', provider: 'stub', createdAt: NOW }),
    ...repeatAi(2, { operation: 'contractReview', status: 'success', provider: 'mock', createdAt: NOW }),
    ...repeatAi(3, { operation: 'parseResume', status: 'failed', provider: 'stub', latencyMs: 9000, createdAt: NOW }),
    ...repeatAi(1, { operation: 'parseResume', status: 'failed', provider: 'llm:qwen', latencyMs: 9000, createdAt: NOW }),
  ]
ai.filter((row) => row.operation === 'optimizeResume').forEach((row, index) => {
    row.latencyMs = index === 0 ? 400 : 500
  })
const orders: OrderSeed[] = [
    ...Array.from({ length: 3 }, (_, index) => ({ orderNo: `kiosk-m-${index}-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: memberId, createdAt: NOW })),
    { orderNo: `kiosk-a-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: null, createdAt: NOW },
    { orderNo: `kiosk-boundary-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: TODAY_START, endUserId: null, createdAt: NOW },
    { orderNo: `kiosk-before-${suffix}`, payStatus: 'paid', channel: 'kiosk', paidAt: BEFORE_TODAY, endUserId: null, createdAt: NOW },
    ...Array.from({ length: 4 }, (_, index) => ({ orderNo: `mini-${index}-${suffix}`, payStatus: 'paid', channel: 'miniapp_cloud', paidAt: NOW, endUserId: memberId, createdAt: BEFORE_TODAY })),
    ...Array.from({ length: 3 }, (_, index) => ({ orderNo: `nullch-${index}-${suffix}`, payStatus: 'paid', channel: null, paidAt: NOW, endUserId: null, createdAt: NOW })),
    ...Array.from({ length: 2 }, (_, index) => ({ orderNo: `emptych-${index}-${suffix}`, payStatus: 'paid', channel: '', paidAt: NOW, endUserId: null, createdAt: NOW })),
    { orderNo: `h5-${suffix}`, payStatus: 'paid', channel: 'h5', paidAt: NOW, endUserId: null, createdAt: NOW },
    { orderNo: `unpaid-${suffix}`, payStatus: 'unpaid', channel: 'kiosk', paidAt: null, endUserId: memberId, createdAt: NOW },
    { orderNo: `refund-${suffix}`, payStatus: 'refunded', channel: 'kiosk', paidAt: NOW, endUserId: memberId, createdAt: NOW },
    { orderNo: orderNo, payStatus: 'paid', channel: 'kiosk', paidAt: NOW, endUserId: null, createdAt: NOW },
  ]
const prints: PrintSeed[] = [
    { id: `pt_a_${suffix}`, createdAt: YESTERDAY_NOON, status: 'completed', completedAt: NOW, printOutcome: null, updatedAt: NOW },
    { id: `pt_b_${suffix}`, createdAt: NOW, status: 'failed', completedAt: null, printOutcome: 'printed', updatedAt: NOW },
    { id: `pt_c_${suffix}`, createdAt: NOW, status: 'completed', completedAt: YESTERDAY_NOON, printOutcome: null, updatedAt: NOW },
    ...Array.from({ length: 4 }, (_, index) => ({ id: `pt_d_${index}_${suffix}`, createdAt: NOW, status: 'completed', completedAt: NOW, printOutcome: null, updatedAt: NOW })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `pt_e_${index}_${suffix}`, createdAt: DAY30_START, status: 'pending', completedAt: null, printOutcome: null, updatedAt: DAY30_START })),
    ...Array.from({ length: 4 }, (_, index) => ({ id: `pt_f_${index}_${suffix}`, createdAt: BEFORE_30, status: 'pending', completedAt: null, printOutcome: null, updatedAt: BEFORE_30 })),
  ]
const scans = [
    ...Array.from({ length: 5 }, () => TODAY_START),
    ...Array.from({ length: 4 }, () => BEFORE_TODAY),
  ]
const countBrowse = (targetTypes: string[], from: Date, to: Date, ids?: string[]) => browses.filter((row) => (
    targetTypes.includes(row.targetType) && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
const countFav = (targetType: string, from: Date, to: Date, ids?: string[]) => favorites.filter((row) => (
    row.targetType === targetType && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
const countJump = (targetType: string | null, from: Date, to: Date, ids?: string[]) => jumps.filter((row) => (
    (targetType === null || row.targetType === targetType) && inWindow(row.at, from, to) && (ids === undefined || ids.includes(row.targetId))
  )).length
const aiWhere = (from: Date, to: Date) => ai.filter((row) => inWindow(row.createdAt, from, to))
const successOf = (ops: string[], from: Date, to: Date) => aiWhere(from, to).filter((row) => row.status === 'success' && ops.includes(row.operation)).length
const paidWhere = (from: Date, to: Date) => orders.filter((row) => row.payStatus === 'paid' && row.paidAt !== null && inWindow(row.paidAt, from, to))
const show = (count: number) => (count <= 0 ? 0 : count < 5 ? null : count)
return { isolated, prisma, cache, usage, suffix, orgA, orgB, termLeak, adminId, userA, userB, userBlank, memberId, phoneEnc, fileUrl, orderNo, jobJia, jobCold, jobDel, jobB, extraA, extraB, policyA, policyAExtra, policyB, fairA, companyA, fairCompanyId, owned, browses, favorites, jumps, addBrowse, ai, orders, prints, scans, countBrowse, countFav, countJump, aiWhere, successOf, paidWhere, show }
}
