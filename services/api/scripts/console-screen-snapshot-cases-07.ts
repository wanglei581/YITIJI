import { SCREEN_JUMP_COPY, SCREEN_UNAVAILABLE_REASON } from '../src/console-screen/console-screen.types'
import { assert } from './console-screen-snapshot-cases-01'
import { isHostingClosed, firstMetricDiff, limitRest, assertRecruitmentHostingContractSetup } from './console-screen-snapshot-cases-06'
import { carryContext } from './console-screen-snapshot-cases-18'



export async function assertRecruitmentHostingContractPhase1(context: Awaited<ReturnType<typeof assertRecruitmentHostingContractSetup>>) {
const { prisma, screen, orgA, orgB, jumpQualified, jumpSmall, orgEmpty } = context
const govOn = await screen.getAdminSnapshot('gov')
const opsOn = await screen.getAdminSnapshot('ops')
const partnerAOn = await screen.getPartnerSnapshot(orgA)
const partnerBOn = await screen.getPartnerSnapshot(orgB)
await prisma.organization.create({
      data: { id: orgEmpty, name: '大屏托管空机构', type: 'school_employment_center', sceneTemplate: 'school', enabled: true },
    })
const emptyOn = await screen.getPartnerSnapshot(orgEmpty)
const expectedLimits = JSON.stringify({
      minAggregateSample: 5,
      displayToken: 'not_issued',
      displayTokenReason: 'display_token_not_issued',
      access: 'authenticated_console',
    })
const enabledSnaps = [govOn, opsOn, partnerAOn, partnerBOn, emptyOn]
assert(
      '6a. 托管打开时 limits.recruitmentHosting=enabled，其余限额与打开前的口径相同',
      enabledSnaps.every((snap) => snap.limits.recruitmentHosting === 'enabled' && limitRest(snap.limits) === expectedLimits),
      limitRest(govOn.limits),
    )
const govInventory = {
      jobsPublished: 3,
      jobsPending: 1,
      fairsPublished: 0,
      fairsPending: 0,
      policiesPublished: 0,
      policiesPending: 0,
      companiesPublished: 0,
      companiesPending: 0,
    }
const pendingAll = { total: 1, jobs: 1, fairs: 0, policies: 0, companies: 0 }
const inventoryA = { ...govInventory, jobsPublished: 1 }
const inventoryB = { ...govInventory, jobsPublished: 2, jobsPending: 0 }
const inventoryEmpty = { ...govInventory, jobsPublished: 0, jobsPending: 0 }
const pendingB = { total: 0, jobs: 0, fairs: 0, policies: 0, companies: 0 }
assert(
      '6c. 托管打开时在架岗位仍按种子计数，空机构是 0 而不是未接入',
      govOn.metrics.jobsOnShelf?.available === true
        && govOn.metrics.jobsOnShelf.value.published === 3
        && govOn.metrics.jobsOnShelf.value.sourceOrgCount === 2
        && govOn.metrics.jobsOnShelf.source === 'Job approved+published+validThrough'
        && govOn.metrics.jobsOnShelf.window === 'current'
        && partnerAOn.metrics.jobsOnShelf?.available === true
        && partnerAOn.metrics.jobsOnShelf.value.published === 1
        && partnerAOn.metrics.jobsOnShelf.value.sourceOrgCount === 1
        && partnerBOn.metrics.jobsOnShelf?.available === true
        && partnerBOn.metrics.jobsOnShelf.value.published === 2
        && emptyOn.metrics.jobsOnShelf?.available === true
        && emptyOn.metrics.jobsOnShelf.value.published === 0,
      JSON.stringify(govOn.metrics.jobsOnShelf),
    )
assert(
      '6d. 托管打开时招聘会结构仍给出 0，材料打印计数保持原有未接入',
      opsOn.metrics.fairStructure?.available === true
        && opsOn.metrics.fairStructure.value.ongoingFairs === 0
        && opsOn.metrics.fairStructure.value.companies === 0
        && opsOn.metrics.fairStructure.value.zones === 0
        && opsOn.metrics.fairStructure.value.publishedMaterials === 0
        && opsOn.metrics.fairStructure.value.materialPrintCount.available === false
        && opsOn.metrics.fairStructure.value.materialPrintCount.reason === SCREEN_UNAVAILABLE_REASON.printCountNeverIncremented
        && opsOn.metrics.fairStructure.source === 'FairCompany/FairZone/FairMaterial'
        && opsOn.metrics.fairStructure.window === 'ongoing'
        && partnerAOn.metrics.fairStructure?.available === true
        && partnerAOn.metrics.fairStructure.value.companies === 0
        && JSON.stringify(partnerAOn.metrics.fairStructure) === JSON.stringify(opsOn.metrics.fairStructure),
      JSON.stringify(opsOn.metrics.fairStructure)?.slice(0, 240),
    )
assert(
      '6e. 托管打开时管理员外跳榜仍按 30 天样本，机构端仍是缺少来源机构快照',
      opsOn.metrics.sourceEntryOpensTop?.available === true
        && opsOn.metrics.sourceEntryOpensTop.source === 'ExternalJumpLog.sourceName'
        && opsOn.metrics.sourceEntryOpensTop.window === '30d'
        && opsOn.metrics.sourceEntryOpensTop.value.copy === SCREEN_JUMP_COPY
        && opsOn.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpQualified && item.count === 20)
        && !opsOn.metrics.sourceEntryOpensTop.value.items.some((item) => item.sourceName === jumpSmall)
        && partnerAOn.metrics.sourceEntryOpensTop?.available === false
        && partnerAOn.metrics.sourceEntryOpensTop.reason === SCREEN_UNAVAILABLE_REASON.missingImmutableSourceOrg
        && partnerAOn.metrics.sourceEntryOpensTop.source === 'ExternalJumpLog'
        && partnerAOn.metrics.sourceEntryOpensTop.window === 'current'
        && !('value' in partnerAOn.metrics.sourceEntryOpensTop),
    )
process.env['RECRUITMENT_CONTENT_HOSTING_ENABLED'] = 'false'
const govOff = await screen.getAdminSnapshot('gov')
const opsOff = await screen.getAdminSnapshot('ops')
const partnerAOff = await screen.getPartnerSnapshot(orgA)
const partnerBOff = await screen.getPartnerSnapshot(orgB)
const emptyOff = await screen.getPartnerSnapshot(orgEmpty)
const disabledSnaps = [govOff, opsOff, partnerAOff, partnerBOff, emptyOff]
assert(
      '6b. 托管关闭时 limits.recruitmentHosting=disabled，其余限额不变',
      disabledSnaps.every((snap, index) => (
        snap.limits.recruitmentHosting === 'disabled' && limitRest(snap.limits) === limitRest(enabledSnaps[index]!.limits)
      )),
      govOff.limits.recruitmentHosting,
    )
assert(
      '6f. 托管关闭后在架岗位改为未开启，空机构也不再显示 0',
      isHostingClosed(govOff.metrics.jobsOnShelf, 'Job approved+published+validThrough', 'current')
        && isHostingClosed(partnerAOff.metrics.jobsOnShelf, 'Job approved+published+validThrough', 'current')
        && isHostingClosed(partnerBOff.metrics.jobsOnShelf, 'Job approved+published+validThrough', 'current')
        && isHostingClosed(emptyOff.metrics.jobsOnShelf, 'Job approved+published+validThrough', 'current')
        && !('jobsOnShelf' in opsOff.metrics),
      JSON.stringify({ gov: govOff.metrics.jobsOnShelf, empty: emptyOff.metrics.jobsOnShelf }),
    )
assert(
      '6g. 托管关闭后招聘会结构改为未开启，不再展示参展企业 0',
      isHostingClosed(opsOff.metrics.fairStructure, 'FairCompany/FairZone/FairMaterial', 'ongoing')
        && isHostingClosed(partnerAOff.metrics.fairStructure, 'FairCompany/FairZone/FairMaterial', 'ongoing')
        && isHostingClosed(partnerBOff.metrics.fairStructure, 'FairCompany/FairZone/FairMaterial', 'ongoing')
        && isHostingClosed(emptyOff.metrics.fairStructure, 'FairCompany/FairZone/FairMaterial', 'ongoing')
        && !('fairStructure' in govOff.metrics),
      JSON.stringify(opsOff.metrics.fairStructure),
    )
assert(
      '6h. 托管关闭后外跳榜改为未开启，机构端不再沿用缺少来源快照',
      isHostingClosed(opsOff.metrics.sourceEntryOpensTop, 'ExternalJumpLog.sourceName', '30d')
        && isHostingClosed(partnerAOff.metrics.sourceEntryOpensTop, 'ExternalJumpLog', 'current')
        && isHostingClosed(partnerBOff.metrics.sourceEntryOpensTop, 'ExternalJumpLog', 'current')
        && isHostingClosed(emptyOff.metrics.sourceEntryOpensTop, 'ExternalJumpLog', 'current')
        && !('sourceEntryOpensTop' in govOff.metrics),
      JSON.stringify({ ops: opsOff.metrics.sourceEntryOpensTop, partner: partnerAOff.metrics.sourceEntryOpensTop }),
    )
assert(
      '6i. 内容库存与待审在关闭后仍可用，岗位、招聘会、企业字段原样保留',
      govOn.metrics.contentInventory?.available === true
        && JSON.stringify(govOn.metrics.contentInventory.value) === JSON.stringify(govInventory)
        && JSON.stringify(govOff.metrics.contentInventory) === JSON.stringify(govOn.metrics.contentInventory)
        && JSON.stringify(partnerAOn.metrics.contentInventory?.available === true ? partnerAOn.metrics.contentInventory.value : null) === JSON.stringify(inventoryA)
        && JSON.stringify(partnerAOff.metrics.contentInventory) === JSON.stringify(partnerAOn.metrics.contentInventory)
        && JSON.stringify(partnerBOn.metrics.contentInventory?.available === true ? partnerBOn.metrics.contentInventory.value : null) === JSON.stringify(inventoryB)
        && JSON.stringify(partnerBOff.metrics.contentInventory) === JSON.stringify(partnerBOn.metrics.contentInventory)
        && JSON.stringify(emptyOn.metrics.contentInventory?.available === true ? emptyOn.metrics.contentInventory.value : null) === JSON.stringify(inventoryEmpty)
        && JSON.stringify(emptyOff.metrics.contentInventory) === JSON.stringify(emptyOn.metrics.contentInventory)
        && opsOn.metrics.pendingReview?.available === true
        && JSON.stringify(opsOn.metrics.pendingReview.value) === JSON.stringify(pendingAll)
        && JSON.stringify(opsOff.metrics.pendingReview) === JSON.stringify(opsOn.metrics.pendingReview)
        && JSON.stringify(partnerAOn.metrics.pendingReview?.available === true ? partnerAOn.metrics.pendingReview.value : null) === JSON.stringify(pendingAll)
        && JSON.stringify(partnerAOff.metrics.pendingReview) === JSON.stringify(partnerAOn.metrics.pendingReview)
        && JSON.stringify(partnerBOn.metrics.pendingReview?.available === true ? partnerBOn.metrics.pendingReview.value : null) === JSON.stringify(pendingB)
        && JSON.stringify(partnerBOff.metrics.pendingReview) === JSON.stringify(partnerBOn.metrics.pendingReview)
        && !('contentInventory' in opsOn.metrics)
        && !('pendingReview' in govOn.metrics),
      `gov=${JSON.stringify(govOff.metrics.contentInventory)?.slice(0, 180)} pending=${JSON.stringify(opsOff.metrics.pendingReview)}`,
    )
const diffs = [
      firstMetricDiff(govOn.metrics, govOff.metrics, ['jobsOnShelf']),
      firstMetricDiff(opsOn.metrics, opsOff.metrics, ['fairStructure', 'sourceEntryOpensTop']),
      firstMetricDiff(partnerAOn.metrics, partnerAOff.metrics, ['jobsOnShelf', 'fairStructure', 'sourceEntryOpensTop']),
      firstMetricDiff(partnerBOn.metrics, partnerBOff.metrics, ['jobsOnShelf', 'fairStructure', 'sourceEntryOpensTop']),
      firstMetricDiff(emptyOn.metrics, emptyOff.metrics, ['jobsOnShelf', 'fairStructure', 'sourceEntryOpensTop']),
    ]
return carryContext(context, { govOn, opsOn, partnerAOn, partnerBOn, emptyOn, expectedLimits, enabledSnaps, govInventory, pendingAll, inventoryA, inventoryB, inventoryEmpty, pendingB, govOff, opsOff, partnerAOff, partnerBOff, emptyOff, disabledSnaps, diffs })
}
