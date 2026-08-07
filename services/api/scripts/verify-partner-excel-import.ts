/** Partner Excel/CSV 解析门禁。 */
import { deflateRawSync } from 'node:zlib'
import { buildPartnerExcelTemplateBuffer } from '../src/jobs/excel-template'
import { JobsExcelService } from '../src/jobs/jobs-excel.service'
import {
  assertSafeXlsxArchive,
  loadPartnerImportRows,
  PARTNER_IMPORT_MAX_DATA_ROWS,
  PARTNER_IMPORT_MAX_FILE_BYTES,
} from '../src/jobs/partner-import-file'
import { prismaJobSourceToPartnerDto } from '../src/jobs/jobs-shared'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`FAIL ${message}`)
  console.log(`PASS ${message}`)
}

function buildSingleEntryZip(content: Buffer, declaredExpandedSize: number): Buffer {
  const name = Buffer.from('xl/worksheets/sheet1.xml')
  const compressed = deflateRawSync(content)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(declaredExpandedSize, 22)
  local.writeUInt16LE(name.length, 26)

  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0)
  central.writeUInt16LE(20, 4)
  central.writeUInt16LE(20, 6)
  central.writeUInt16LE(8, 10)
  central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(declaredExpandedSize, 24)
  central.writeUInt16LE(name.length, 28)

  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(1, 8)
  end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + name.length, 12)
  end.writeUInt32LE(local.length + name.length + compressed.length, 16)
  return Buffer.concat([local, name, compressed, central, name, end])
}

async function verifyConcurrentConfirm(): Promise<void> {
  let batchStatus = 'pending'
  let findCount = 0
  let releaseFinds = () => undefined
  const bothFindsStarted = new Promise<void>((resolve) => { releaseFinds = resolve })
  let syncLogWrites = 0
  const batch = {
    id: 'batch-1', sourceId: 'source-1', orgId: 'org-1', dataType: 'job', status: 'pending',
    invalidRows: 0, dupRows: 0, mappingJson: '{}',
    records: [{ mappedJson: JSON.stringify({
      externalId: 'job-1', title: '测试工程师', company: '示例公司', city: '青岛',
      sourceUrl: 'https://example.com/job-1',
    }) }],
  }
  const tx = {
    importBatch: {
      updateMany: async () => {
        if (batchStatus !== 'pending') return { count: 0 }
        batchStatus = 'processing'
        return { count: 1 }
      },
      update: async (args: { data: { status: string } }) => {
        batchStatus = args.data.status
        return batch
      },
    },
    job: { upsert: async () => ({ id: 'job-1' }) },
    jobSource: { update: async () => ({}) },
    syncLog: {
      create: async () => {
        syncLogWrites += 1
        return { id: 'sync-1' }
      },
    },
  }
  const prisma = {
    importBatch: {
      findUnique: async () => {
        const snapshot = { ...batch, status: 'pending' }
        findCount += 1
        if (findCount === 2) releaseFinds()
        await bothFindsStarted
        return snapshot
      },
      updateMany: async () => ({ count: 0 }),
    },
    organization: { findUnique: async () => ({ id: 'org-1', name: '测试机构', enabled: true }) },
    fieldMappingRule: { upsert: async () => ({}) },
    $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
  }
  const service = new JobsExcelService(
    prisma as never,
    { write: async () => undefined } as never,
    { refreshJobQualitySnapshots: async () => undefined } as never,
  )
  const user = { userId: 'partner-1', role: 'partner', orgId: 'org-1' } as never
  const results = await Promise.allSettled([
    service.confirmExcelImport('batch-1', user),
    service.confirmExcelImport('batch-1', user),
  ])
  assert(results.filter((result) => result.status === 'fulfilled').length === 1, '并发重复确认仅一次成功')
  assert(results.filter((result) => result.status === 'rejected').length === 1, '并发重复确认返回一次明确拒绝')
  assert(batchStatus === 'confirmed' && syncLogWrites === 1, '岗位、同步日志与批次状态在单事务中只写一次')
}

async function verifyEmptyBatchRejected(): Promise<void> {
  const service = new JobsExcelService({
    importBatch: {
      findUnique: async () => ({
        id: 'empty-batch', sourceId: 'source-1', orgId: 'org-1', dataType: 'job', status: 'pending',
        invalidRows: 0, dupRows: 0, mappingJson: '{}', records: [],
      }),
    },
  } as never, {} as never, {} as never)
  let rejection: unknown
  try {
    await service.confirmExcelImport('empty-batch', { userId: 'partner-1', role: 'partner', orgId: 'org-1' } as never)
  } catch (error) {
    rejection = error
  }
  const response = (rejection as { getResponse?: () => unknown })?.getResponse?.() as {
    error?: { code?: string }
  } | undefined
  assert(response?.error?.code === 'BATCH_NO_VALID_ROWS', '服务端拒绝绕过 UI 确认零有效行批次')
}

async function main(): Promise<void> {
  console.log('\n=== Partner Excel/CSV 解析门禁 ===')

  const service = new JobsExcelService({} as never, {} as never, {} as never)
  const template = await buildPartnerExcelTemplateBuffer('job')
  const templateResult = await service.parseExcelColumns(template, '岗位数据导入模板.xlsx')
  assert(templateResult.columns.includes('外部ID*'), '下载的空白 XLSX 模板可回读表头')
  assert(templateResult.sampleRows.length === 0, '只有表头的 XLSX 进入零数据预览准备态')

  const csv = Buffer.from(
    '\uFEFF外部ID,职位名称,公司名称,工作城市,来源链接,职位描述\r\n' +
    'job-1,"研发,工程师",示例科技,北京,https://example.com/job-1,"第一行\n第二行"\r\n',
  )
  const rows = await loadPartnerImportRows(csv, 'jobs.csv')
  assert(rows.length === 2, 'CSV 支持 BOM 与 CRLF')
  assert(rows[1]?.[1] === '研发,工程师', 'CSV 支持带逗号的引号字段')
  assert(rows[1]?.[5] === '第一行\n第二行', 'CSV 支持引号字段内换行')

  const csvResult = await service.parseExcelColumns(csv, 'jobs.csv')
  assert(csvResult.sampleRows[0]?.['职位名称'] === '研发,工程师', 'CSV 可生成字段映射样例')

  await loadPartnerImportRows(Buffer.from('a,b\n"broken'), 'broken.csv').then(
    () => { throw new Error('FAIL 未闭合引号 CSV 应被拒绝') },
    () => console.log('PASS 未闭合引号 CSV 被拒绝'),
  )
  await loadPartnerImportRows(Buffer.from('legacy'), 'legacy.xls').then(
    () => { throw new Error('FAIL 旧 .xls 应被拒绝') },
    () => console.log('PASS 旧 .xls 不再被误宣称支持'),
  )
  const tooManyRows = Buffer.from(
    `header\n${Array.from({ length: PARTNER_IMPORT_MAX_DATA_ROWS + 1 }, (_, index) => index).join('\n')}`,
  )
  await loadPartnerImportRows(tooManyRows, 'too-many.csv').then(
    () => { throw new Error('FAIL 超过数据行上限的 CSV 应被拒绝') },
    () => console.log('PASS 超过数据行上限的 CSV 被拒绝'),
  )
  await loadPartnerImportRows(Buffer.alloc(PARTNER_IMPORT_MAX_FILE_BYTES + 1), 'too-large.csv').then(
    () => { throw new Error('FAIL 超过文件大小上限的 CSV 应被拒绝') },
    () => console.log('PASS 超过文件大小上限的 CSV 被拒绝'),
  )
  const amplifiedXlsx = buildSingleEntryZip(Buffer.alloc(1024, 65), 1)
  try {
    assertSafeXlsxArchive(amplifiedXlsx, { maxEntries: 10, maxEntryBytes: 512, maxExpandedBytes: 512 })
    throw new Error('FAIL 声明体积造假的 XLSX 压缩放大应被拒绝')
  } catch (error) {
    assert((error as Error).message === 'IMPORT_XLSX_ARCHIVE_LIMIT_EXCEEDED', '按实际解压体积拒绝 XLSX 压缩放大')
  }

  const sourceView = prismaJobSourceToPartnerDto({
    id: 'source-1', orgId: 'org-1', name: 'Excel 来源', sourceKind: 'school', accessMode: 'excel',
    syncFreq: 'manual', enabled: true, description: null,
    lastSyncAt: new Date('2026-08-06T12:00:00.000Z'), lastSyncStatus: 'partial',
    endpoint: null, authType: null, encryptedCredential: null, webhookSecret: null,
    webhookSecretRotatedAt: null, createdAt: new Date(0), updatedAt: new Date(0),
  }, {
    successCount: 3,
    failCount: 1,
  })
  assert(sourceView.successCount === 3 && sourceView.failCount === 1, '数据源计数来自真实同步汇总')
  assert(sourceView.lastSyncTime !== '从未同步', '数据源最近同步时间来自事务维护的来源状态')
  await verifyEmptyBatchRejected()
  await verifyConcurrentConfirm()

  console.log('ALL PASS')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
