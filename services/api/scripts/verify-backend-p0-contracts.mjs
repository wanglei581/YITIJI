#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = resolve(here, '../../..')
const read = (path) => readFileSync(resolve(repo, path), 'utf8')

let failed = 0
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`)
  else { console.error(`  FAIL ${message}`); failed++ }
}

function containsAll(source, values) {
  return values.every((value) => source.includes(value))
}

console.log('\n=== Backend P0 contract gates ===')

const offlineClient = read('apps/admin/src/services/api/offlineAgenciesAdmin.ts')
const offlineController = read('services/api/src/offline-agencies/admin-offline-agencies.controller.ts')
const offlineService = read('services/api/src/offline-agencies/offline-agencies.service.ts')
const webhookService = read('services/api/src/sync/sync.service.ts')
const webhookController = read('services/api/src/sync/sync.controller.ts')
const partnerSources = read('apps/partner/src/routes/sources/index.tsx')
const excelModal = read('apps/partner/src/routes/sources/ExcelImportModal.tsx')
const kioskList = read('apps/kiosk/src/pages/offline-agencies/OfflineAgenciesPage.tsx')
const kioskDetail = read('apps/kiosk/src/pages/offline-agencies/OfflineAgencyDetailPage.tsx')
const partnerCapabilities = read('services/api/src/jobs/partner-capabilities.ts')
const partnerJobsService = read('services/api/src/jobs/jobs-partner.service.ts')
const syncAdminController = read('services/api/src/job-sync/job-sync.controller.ts')
const syncAdminService = read('services/api/src/job-sync/job-sync.service.ts')
const adminSourcesPage = read('apps/admin/src/routes/sync-sources/index.tsx')

check(
  containsAll(offlineClient, [
    "req<RawOfflineAgency>('PUT', `${BASE}/${id}`, input)",
    '{ reason: rejectReason }',
    "{ publishStatus: publish ? 'published' : 'unpublished' }",
    "req<RawOfflineJob>('PUT', `${BASE}/${agencyId}/jobs/${jobId}`, input)",
  ]),
  'Admin OfflineAgency adapter matches Nest PUT/reason/publishStatus contract',
)
check(
  containsAll(offlineClient, ['RawPage<RawOfflineAgency>', 'page.data.map(mapAgency)', 'RawPage<RawOfflineJob>']),
  'Admin OfflineAgency adapter unwraps paginated agency and job responses',
)
check(
  offlineController.includes("import { ApiResponse } from '../common/dto/api-response.dto'") &&
    containsAll(offlineController, [
      'return ApiResponse.ok(await this.service.adminFindAll(query))',
      'return ApiResponse.ok(await this.service.adminFindOne(id))',
      'return ApiResponse.ok(await this.service.adminFindJobsByAgency(agencyId, query))',
      'return ApiResponse.ok(result)',
    ]),
  'Admin OfflineAgency controller returns the success/data envelope consumed by the adapter',
)
check(offlineController.includes("@Get(':id')"), 'Admin OfflineAgency exposes GET detail endpoint')
check(
  containsAll(offlineService, [
    "hasContentChanges ? { reviewStatus: 'pending', publishStatus: 'draft' }",
    "data: { reviewStatus: 'pending', publishStatus: 'draft' }",
    "job.agency.status !== 'active'",
    "throw new BadRequestException('驳回必须填写原因')",
  ]),
  'OfflineAgency edits/jobs re-enter review and public deep links fail closed',
)
check(
  containsAll(webhookController, ['x-webhook-timestamp', 'x-webhook-nonce', 'x-webhook-signature']) &&
    containsAll(partnerSources, ['x-webhook-timestamp', 'x-webhook-nonce', 'x-webhook-signature']),
  'Partner Webhook guide matches controller header names',
)
check(
  containsAll(webhookService, ["syncMode: 'webhook'", "lastSyncStatus: 'success'", "lastSyncStatus: 'failed'", "result: 'failed'"]),
  'Webhook success and failure paths persist SyncLog/source status',
)
check(
  excelModal.includes('本次导入将跳过') && !excelModal.includes('导入时将刷新展示字段'),
  'Excel duplicate-row copy matches current skip behavior',
)
check(
  !kioskList.includes('资质核验已通过') && !kioskDetail.includes('资质核验已通过') &&
    kioskList.includes('机构信息已审核') && kioskDetail.includes('机构信息已审核'),
  'Kiosk does not claim qualification verification without qualification records',
)
check(
  containsAll(partnerCapabilities, [
    'school_employment_center',
    'public_employment_service',
    'licensed_hr_agency',
    'fair_organizer',
    'enterprise_source',
    'assertDataSourceCapability',
    'assertPartnerDataTypeCapability',
  ]),
  'All five Organization types have server-side source and content capability rules',
)
check(
  containsAll(partnerJobsService, [
    'enabled: !isAdminManagedAccessMode(accessMode)',
    "code: 'DATA_SOURCE_ADMIN_MANAGED'",
    "assertPartnerDataTypeCapability(org.type, 'job')",
    "assertPartnerDataTypeCapability(org.type, 'fair')",
  ]),
  'API/Webhook start disabled and Partner write paths enforce capability rules',
)
check(
  containsAll(syncAdminController, [
    "@Patch('sources/:sourceId/enabled')",
    "@Get('sources/:sourceId/impact')",
    "@Post('sources/:sourceId/unpublish-content')",
  ]) && containsAll(syncAdminService, [
    "contentAction: 'retain'",
    "action: 'data_source.content_bulk_unpublish'",
  ]),
  'Source disable, impact preview, and explicit bulk unpublish are separate audited operations',
)
check(
  containsAll(adminSourcesPage, [
    '停用通道不会自动下架既有内容',
    'UNPUBLISH_SOURCE_CONTENT',
    'fetchSourceImpact',
  ]),
  'Admin source UI explains non-cascading disable and requires impact preview before bulk unpublish',
)

// ---------------------------------------------------------------------------
// 取件码规格：单一来源 + 存量兼容（2026-08-18 6 位纯数字裁决）
// ---------------------------------------------------------------------------
//
// 守的是一件事：**签发端与受理端不许各持一份长度**。
//
// 事故形态（本次改动前的真实状态）：`PICKUP_CODE_LEN = 10` 在
// member-print-order-create.service.ts 和 order-status.service.ts 各一份，
// claim-pickup.dto.ts 的正则里还内联了第三份。三者无任何编译期联系，
// 改一处 = 按一种长度发码、按另一种长度收码 = 在途取件码全部作废。
//
// 本段只做静态取证（不连库）。行为侧的「生成必被受理」由
// scripts/verify-miniapp-cloud-print-m2.ts 实跑钉住，两条都不能删。
console.log('\n--- 取件码规格 ---')

const pickupCodeSrc = read('services/api/src/common/pickup-code.ts')
const pickupCodeShared = read('packages/shared/src/pickupCode.ts')
const claimDto = read('services/api/src/print-jobs/dto/claim-pickup.dto.ts')
const orderCreateSrc = read('services/api/src/member-print-orders/member-print-order-create.service.ts')
const orderStatusSrc = read('services/api/src/payment/order-status.service.ts')
const pickupOrderSrc = read('services/api/src/print-jobs/pickup-order.service.ts')
const kioskClaimPage = read('apps/kiosk/src/pages/print/PrintPickupClaimPage.tsx')
const miniappPickupQr = read('apps/miniapp/utils/pickup-qrcode.js')

/** 规格字面量：改任何一行都必须四处同改，否则本段全红。 */
const PICKUP_SPEC_LITERALS = [
  "export const PICKUP_CODE_ALPHABET = '0123456789'",
  'export const PICKUP_CODE_LENGTH = 6',
  'export const PICKUP_CODE_PATTERN = /^[0-9]{6}$/',
  "export const LEGACY_PICKUP_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'",
  'export const LEGACY_PICKUP_CODE_LENGTH = 10',
  'export const LEGACY_PICKUP_CODE_PATTERN = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/',
  'export const PICKUP_CODE_ACCEPTED_PATTERN = /^(?:[0-9]{6}|[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10})$/',
]

check(
  containsAll(pickupCodeSrc, PICKUP_SPEC_LITERALS),
  '后端 common/pickup-code.ts 是取件码规格的唯一定义（6 位纯数字 + 10 位存量）',
)
check(
  containsAll(pickupCodeShared, PICKUP_SPEC_LITERALS),
  'packages/shared/pickupCode.ts 与后端逐字一致（跨端副本不许漂移）',
)

// 注释与实现必须对得上：仓库有过「注释写 32 个字符、实际 31 个」的先例
// （docs/design/kiosk-ai-os-v3-2026-08/47-arrival-code.html 记录了那次对账）。
// 这里把两套字符集的「声称个数」和「真实长度」直接对账，不靠人肉数。
for (const [label, source] of [['后端', pickupCodeSrc], ['shared', pickupCodeShared]]) {
  const legacyAlphabet = /LEGACY_PICKUP_CODE_ALPHABET = '([^']+)'/.exec(source)?.[1] ?? ''
  const currentAlphabet = /[^_]PICKUP_CODE_ALPHABET = '([^']+)'/.exec(source)?.[1] ?? ''
  check(
    legacyAlphabet.length === 31 && source.includes('31 个字符'),
    `${label}：存量字符集注释写的个数 == 字面量真实长度（31）`,
  )
  check(
    currentAlphabet === '0123456789' && currentAlphabet.length === 10,
    `${label}：当前字符集就是 10 个数字，无 O/0、I/1 歧义`,
  )
  check(
    new Set(legacyAlphabet).size === legacyAlphabet.length && new Set(currentAlphabet).size === currentAlphabet.length,
    `${label}：字符集无重复字符（重复会让该字符权重翻倍）`,
  )
}

// 单一来源：两个签发点都不许再自带长度/字符集，必须 import 同一份。
for (const [label, source] of [
  ['member-print-order-create.service.ts', orderCreateSrc],
  ['order-status.service.ts', orderStatusSrc],
]) {
  check(
    !/const\s+PICKUP_CODE_LEN\b/.test(source) && !/const\s+PICKUP_ALPHABET\b/.test(source),
    `${label} 不再自带取件码长度/字符集（重复定义正是本次要根治的 bug）`,
  )
  check(
    /from '\.\.\/common\/pickup-code'/.test(source) && source.includes('randomPickupCode'),
    `${label} 从 common/pickup-code 取签发函数`,
  )
}
check(
  !/function\s+randomPickupCode/.test(orderCreateSrc) && !/function\s+randomPickupCode/.test(orderStatusSrc),
  '两个签发点都不再各自实现 randomPickupCode',
)
// 注意：必须对「剥掉注释后的代码」判定。第一版写成 !src.includes('Math.random')
// 时被本文件自己那句「绝不能换成 Math.random()」的注释判红了 —— 断言不能被文档打败。
const pickupCodeExecutable = pickupCodeSrc
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
check(
  pickupCodeExecutable.includes('randomBytes(') && !/Math\.random\s*\(/.test(pickupCodeExecutable),
  '签发使用 crypto.randomBytes（CSPRNG），代码里绝无 Math.random() 调用',
)
check(
  pickupCodeSrc.includes('const limit = 256 - (256 % size)') && pickupCodeSrc.includes('if (byte >= limit) continue'),
  '签发用拒绝采样消除取模偏置（256 % 10 = 6，直接取模会让 0–5 多约 4%）',
)

// 受理端：DTO 必须复用同一份正则常量，不许内联长度。
check(
  claimDto.includes("from '../../common/pickup-code'") && claimDto.includes('PICKUP_CODE_ACCEPTED_PATTERN'),
  'ClaimPickupDto 复用 PICKUP_CODE_ACCEPTED_PATTERN，不再内联正则',
)
check(
  !/\{10\}|\{6\}/.test(claimDto),
  'ClaimPickupDto 里没有内联长度字面量（第三份长度定义正是事故来源）',
)

// 存量防线：这几条断言的作用是「删掉兼容分支时 CI 立刻红」。
// 取件码 TTL 24h，本改动上线满 24 小时后才允许删；删的时候连同本段一起删。
check(
  pickupCodeSrc.includes('LEGACY_PICKUP_CODE_PATTERN') &&
    pickupCodeSrc.includes('[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}') &&
    /PICKUP_CODE_ACCEPTED_PATTERN = .*\[0-9\]\{6\}\|\[23456789ABCDEFGHJKMNPQRSTUVWXYZ\]\{10\}/.test(pickupCodeSrc),
  '受理正则同时收 6 位新码与 10 位存量码（已付费用户的在途取件码不得被拒）',
)
check(
  pickupCodeSrc.includes('m2-pickup-v1|') && pickupOrderSrc.includes('pickupCodeHash: hashPickupCode(code)'),
  '认领仍走 pickupCodeHash 精确命中；哈希域分隔串未变（一改则全部存量哈希失配）',
)

// kiosk 输入端：不许再自带正则，键盘类型必须是数字。
check(
  kioskClaimPage.includes("from '@ai-job-print/shared'") &&
    kioskClaimPage.includes('PICKUP_CODE_ACCEPTED_PATTERN') &&
    !kioskClaimPage.includes('const VALID_CODE = /^['),
  'kiosk 取件页复用 shared 的受理正则，不再内联自己那份',
)
check(
  kioskClaimPage.includes('inputMode="numeric"'),
  'kiosk 取件码输入框唤起数字键盘（纯数字码不该弹全键盘）',
)

// 小程序：本次不改（归用户所有），但它那份 10 位正则**已与后端不一致**。
// 这条断言不是为了拦住谁，是为了让「小程序仍在发 10 位码」这件事在 CI 上可见。
check(
  miniappPickupQr.includes('PICKUP_CODE_RE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/'),
  '小程序仍是 10 位口径（本 PR 未授权修改；后端存量兼容分支删除前必须先改它）',
)

if (failed > 0) {
  console.error(`\n${failed} backend P0 contract check(s) failed.\n`)
  process.exit(1)
}
console.log('\nAll backend P0 contract checks passed.\n')
