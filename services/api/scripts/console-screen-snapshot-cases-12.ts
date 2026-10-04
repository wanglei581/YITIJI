
import { ForbiddenException } from '@nestjs/common'
import { SCREEN_JUMP_COPY, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { PartnerScreenController } from '../src/console-screen/console-screen.partner.controller'
import { loadContentSlice, loadPartnerFleet, loadPrintCumulativeSlice, loadPrintLiveSlice } from '../src/console-screen/console-screen.queries'
import { PartnerOrgRequiredError } from '../src/console-screen/console-screen.org'
import { assert, collectKeys } from './console-screen-snapshot-cases-01'
import { assertServiceContractPhase2 } from './console-screen-snapshot-cases-11'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertServiceContractPhase3(context: Awaited<ReturnType<typeof assertServiceContractPhase2>>) {
const { prisma, screen, termA, termB, userA, now, todayKey, yesterdayKey, jumpQualified, jumpSmall, gov, ops, partnerA, partnerB, wallB, cellB, govCells } = context
assert(
      '5b. Partner B 格子是缺纸告警、活动空闲，未设坐标为 null',
      wallB?.available === true
        && cellB?.terminalId === termB
        && cellB.activity === 'idle'
        && cellB.alert?.kind === 'printer_issue'
        && cellB.alert.title === '打印机缺纸'
        && cellB.areaLabel === null
        && cellB.geo === null
        && !JSON.stringify(wallB).includes(termA),
    )
assert(
      '5c. Admin 机队同时有两台，health 仍在',
      govCells.some((cell) => cell.terminalId === termA && cell.health === 'healthy' && cell.activity === 'printing')
        && govCells.some((cell) => cell.terminalId === termB && cell.alert?.title === '打印机缺纸'),
    )
assert(
      '3e. Partner B 同步成功率按本机构聚合（1 成功 1 失败）',
      partnerB.metrics.syncSuccessRate24h?.available === true
        && partnerB.metrics.syncSuccessRate24h.value.total === 2
        && partnerB.metrics.syncSuccessRate24h.value.success === 1,
    )
assert(
      '3f. Partner 打印/AI/跳转因缺 orgId 未接入，不给数字',
      partnerA.metrics.printPagesCumulative?.available === false
        && partnerA.metrics.aiCallsCumulative?.available === false
        && partnerA.metrics.sourceEntryOpensTop?.available === false
        && partnerA.metrics.sourceEntryOpensTop?.reason === SCREEN_UNAVAILABLE_REASON.missingImmutableSourceOrg,
    )
assert(
      '3g. N<5 的来源不出现在 Top，文案是打开来源平台入口',
      ops.metrics.sourceEntryOpensTop?.available === true
        && ops.metrics.sourceEntryOpensTop.value.copy === SCREEN_JUMP_COPY
        && ops.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpQualified && item.count >= 20)
        && !ops.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpSmall),
    )
const trendDays = gov.metrics.printTrend14d?.available === true
      ? gov.metrics.printTrend14d.value.days
      : []
const todayPages = trendDays.find((day) => day.date === todayKey)?.pages
const yesterdayPages = trendDays.find((day) => day.date === yesterdayKey)?.pages
const copiesProduct = 3 * 9 + 5 * 13 + 7 * 11
assert(
      '3h. 累计按出纸任务×份数（W-68）：夹具里已付单都没出纸、唯一完成任务无订单页数 → 0，不是 paid 内容页 15',
      gov.metrics.printPagesCumulative?.available === true
        && gov.metrics.printPagesCumulative.value.totalPages === 0
        && gov.metrics.printPagesCumulative.value.totalPages !== copiesProduct
        && gov.metrics.printPagesCumulative.value.byColor.available === false,
      gov.metrics.printPagesCumulative?.available
        ? `totalPages=${gov.metrics.printPagesCumulative.value.totalPages}`
        : 'unavailable',
    )
assert(
      '3h2. 趋势按 PrintTask.completedAt 的上海自然日；本夹具已付内容页今日 10、昨日 5 都没出纸，所以是 0',
      gov.metrics.printTrend14d?.available === true
        && gov.metrics.printTrend14d.source.includes('completedAt')
        && gov.metrics.printTrend14d.source.includes('copies')
        && gov.metrics.printTrend14d.window === '14d'
        && todayPages === 0
        && yesterdayPages === 0
        && Number(todayPages) !== 10
        && Number(yesterdayPages) !== 5,
      `today=${String(todayPages)} yesterday=${String(yesterdayPages)} key=${todayKey}/${yesterdayKey}`,
    )
assert(
      '3h3. 今日失败按状态日志 createdAt，历史失败不因 updatedAt 复活',
      ops.metrics.printFailedToday?.available === true
        && ops.metrics.printFailedToday.value.failed === 1,
      ops.metrics.printFailedToday?.available
        ? `failed=${ops.metrics.printFailedToday.value.failed}`
        : 'unavailable',
    )
let blankCaught: unknown
try {
      await screen.getPartnerSnapshot('   ')
    } catch (error) {
      blankCaught = error
    }
let emptySliceCaught: unknown
try {
      await loadContentSlice(prisma, now, '' as never)
    } catch (error) {
      emptySliceCaught = error
    }
let emptyFleetCaught: unknown
try {
      await loadPartnerFleet(prisma, now, '\t')
    } catch (error) {
      emptyFleetCaught = error
    }
const partnerController = new PartnerScreenController(screen)
let controllerBlank: unknown
try {
      await partnerController.getPartnerSnapshot({ userId: userA, role: 'partner', orgId: null }, {})
    } catch (error) {
      controllerBlank = error
    }
let controllerWhitespace: unknown
try {
      await partnerController.getPartnerSnapshot({ userId: userA, role: 'partner', orgId: '  ' }, {})
    } catch (error) {
      controllerWhitespace = error
    }
assert(
      '3h4. 空白/空 orgId fail-closed，不泄露跨机构数据',
      blankCaught instanceof PartnerOrgRequiredError
        && emptySliceCaught instanceof PartnerOrgRequiredError
        && emptyFleetCaught instanceof PartnerOrgRequiredError
        && controllerBlank instanceof ForbiddenException
        && controllerWhitespace instanceof ForbiddenException
        && JSON.stringify((controllerBlank as ForbiddenException).getResponse()).includes('ORG_REQUIRED')
        && JSON.stringify((controllerWhitespace as ForbiddenException).getResponse()).includes('ORG_REQUIRED'),
    )
const live = await loadPrintLiveSlice(prisma, now)
const cumulative = await loadPrintCumulativeSlice(prisma, now)
const cumulativeDays = cumulative.trend === 'capped' ? [] : cumulative.trend.days
assert(
      '3h5. 查询函数与快照口径一致：出纸页=0、今日与昨日趋势页=0（已付内容页 10/5 没出纸）、今日失败日志=1',
      live.failedToday === 1
        && cumulative.pages !== 'capped' && cumulative.pages.totalPages === 0
        && cumulative.trend !== 'capped'
        && cumulativeDays.some((day) => day.date === todayKey && day.pages === 0)
        && cumulativeDays.some((day) => day.date === yesterdayKey && day.pages === 0)
        && !cumulativeDays.some((day) => day.pages === 10 || day.pages === 5),
    )
const overflow = await loadPrintCumulativeSlice(prisma, now, { trendRowCap: 2 })
const atCap = await loadPrintCumulativeSlice(prisma, now, { trendRowCap: 3 })
const atCapDays = atCap.trend === 'capped' ? [] : atCap.trend.days
assert(
      '3h6. 本夹具窗口内没有出纸任务，压低 trendRowCap 也不会变成 capped；真实行数上限见 printed-visits',
      overflow.trend !== 'capped'
        && overflow.pages !== 'capped' && overflow.pages.totalPages === 0
        && atCap.trend !== 'capped'
        && atCap.pages !== 'capped' && atCap.pages.totalPages === 0
        && atCapDays.some((day) => day.date === todayKey && day.pages === 0)
        && atCapDays.some((day) => day.date === yesterdayKey && day.pages === 0)
        && !atCapDays.some((day) => day.pages === 10 || day.pages === 5),
      `overflow=${overflow.trend === 'capped' ? 'capped' : 'open'} today=${String(atCapDays.find((day) => day.date === todayKey)?.pages)} yesterday=${String(atCapDays.find((day) => day.date === yesterdayKey)?.pages)}`,
    )
assert(
      '3i. 窗口、登录展示 LIMIT、freshness 写在响应里',
      gov.window.onlineWindowSeconds === 180
        && gov.window.realtimeTtlSeconds === 15
        && gov.window.countsTtlSeconds === 60
        && gov.window.cumulativeTtlSeconds === 300
        && gov.window.timezone === 'Asia/Shanghai'
        && gov.limits.displayToken === 'not_issued'
        && gov.limits.access === 'authenticated_console'
        && gov.status === 'ok'
        && gov.degraded === false
        && gov.freshness.realtime === 'miss'
        && /\d{4}-\d{2}-\d{2}T/.test(gov.generatedAt),
    )
const payloadKeys = collectKeys({ gov, ops, partnerA, partnerB })
const banned = [
      'endUserId', 'pickupCode', 'pickupCodeEnc', 'jobApplication', 'candidate',
      'funnel', 'fileUrl', 'fileMd5', 'phoneHash', 'phoneEnc', 'paramsJson',
    ]
assert(
      '3j. 响应不含求职者身份或招聘闭环字段',
      !banned.some((key) => payloadKeys.has(key)),
      `命中 ${banned.filter((key) => payloadKeys.has(key)).join(',')}`,
    )
return carryContext(context, { trendDays, todayPages, yesterdayPages, copiesProduct, get blankCaught() { return blankCaught }, set blankCaught(value: typeof blankCaught) { blankCaught = value }, get emptySliceCaught() { return emptySliceCaught }, set emptySliceCaught(value: typeof emptySliceCaught) { emptySliceCaught = value }, get emptyFleetCaught() { return emptyFleetCaught }, set emptyFleetCaught(value: typeof emptyFleetCaught) { emptyFleetCaught = value }, partnerController, get controllerBlank() { return controllerBlank }, set controllerBlank(value: typeof controllerBlank) { controllerBlank = value }, get controllerWhitespace() { return controllerWhitespace }, set controllerWhitespace(value: typeof controllerWhitespace) { controllerWhitespace = value }, live, cumulative, cumulativeDays, overflow, atCap, atCapDays, payloadKeys, banned })
}
