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

if (failed > 0) {
  console.error(`\n${failed} backend P0 contract check(s) failed.\n`)
  process.exit(1)
}
console.log('\nAll backend P0 contract checks passed.\n')
