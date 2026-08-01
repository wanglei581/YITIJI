import 'reflect-metadata'

import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createDeflateRaw, deflateRawSync } from 'node:zlib'
import {
  ContractReviewExtractionService,
  type ContractReviewExtractionRuntime,
} from '../contract-review-extraction.service'

const RELIABLE = '合同正文'.repeat(8)

interface TestZipEntry {
  name: string
  filenameBytes?: Buffer
  localFilenameBytes?: Buffer
  content?: Buffer
  method?: number
  flags?: number
  centralExtra?: Buffer
  localExtra?: Buffer
  declaredUncompressedSize?: number
  compressedData?: Buffer
  centralCrc?: number
  localCrc?: number
}

function crc32(input: Buffer): number {
  let crc = 0xffffffff
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function makeUnicodePathExtra(
  filenameBytes: Buffer,
  unicodePath: string,
  crcOverride?: number,
): Buffer {
  const path = Buffer.from(unicodePath, 'utf8')
  const data = Buffer.alloc(5 + path.length)
  data.writeUInt8(1, 0)
  data.writeUInt32LE(crcOverride ?? crc32(filenameBytes), 1)
  path.copy(data, 5)
  const field = Buffer.alloc(4)
  field.writeUInt16LE(0x7075, 0)
  field.writeUInt16LE(data.length, 2)
  return Buffer.concat([field, data])
}

function makeDocxArchive(entries: TestZipEntry[] = [{
  name: 'word/document.xml', content: Buffer.from('<w:document/>'), method: 8,
}]): Buffer {
  const localEntries: Buffer[] = []
  const centralEntries: Buffer[] = []
  let localOffset = 0
  for (const entry of entries) {
    const filename = entry.filenameBytes ?? Buffer.from(entry.name, 'utf8')
    const localFilename = entry.localFilenameBytes ?? filename
    const content = entry.content ?? Buffer.from('x')
    const method = entry.method ?? 0
    const flags = entry.flags ?? 0
    const compressed = entry.compressedData ?? (method === 8 ? deflateRawSync(content) : content)
    const declaredSize = entry.declaredUncompressedSize ?? content.length
    const localExtra = entry.localExtra ?? Buffer.alloc(0)
    const centralExtra = entry.centralExtra ?? Buffer.alloc(0)
    const contentCrc = crc32(content)
    const localHeader = Buffer.alloc(30)
    localHeader.writeUInt32LE(0x04034b50, 0)
    localHeader.writeUInt16LE(20, 4)
    localHeader.writeUInt16LE(flags, 6)
    localHeader.writeUInt16LE(method, 8)
    localHeader.writeUInt32LE(entry.localCrc ?? contentCrc, 14)
    localHeader.writeUInt32LE(compressed.length, 18)
    localHeader.writeUInt32LE(declaredSize, 22)
    localHeader.writeUInt16LE(localFilename.length, 26)
    localHeader.writeUInt16LE(localExtra.length, 28)
    const localEntry = Buffer.concat([localHeader, localFilename, localExtra, compressed])
    localEntries.push(localEntry)

    const centralHeader = Buffer.alloc(46)
    centralHeader.writeUInt32LE(0x02014b50, 0)
    centralHeader.writeUInt16LE(20, 4)
    centralHeader.writeUInt16LE(20, 6)
    centralHeader.writeUInt16LE(flags, 8)
    centralHeader.writeUInt16LE(method, 10)
    centralHeader.writeUInt32LE(entry.centralCrc ?? contentCrc, 16)
    centralHeader.writeUInt32LE(compressed.length, 20)
    centralHeader.writeUInt32LE(declaredSize, 24)
    centralHeader.writeUInt16LE(filename.length, 28)
    centralHeader.writeUInt16LE(centralExtra.length, 30)
    centralHeader.writeUInt32LE(localOffset, 42)
    centralEntries.push(Buffer.concat([centralHeader, filename, centralExtra]))
    localOffset += localEntry.length
  }
  const localData = Buffer.concat(localEntries)
  const centralDirectory = Buffer.concat(centralEntries)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDirectory.length, 12)
  eocd.writeUInt32LE(localData.length, 16)
  return Buffer.concat([localData, centralDirectory, eocd])
}

async function makeCompressedOutput(outputBytes: number, prefix = Buffer.alloc(0)): Promise<Buffer> {
  assert.ok(prefix.length <= outputBytes)
  const deflater = createDeflateRaw({ level: 9 })
  const chunks: Buffer[] = []
  deflater.on('data', (chunk: Buffer) => chunks.push(chunk))
  const block = Buffer.alloc(64 * 1024)
  if (prefix.length > 0 && !deflater.write(prefix)) await once(deflater, 'drain')
  let remaining = outputBytes - prefix.length
  while (remaining > 0) {
    const chunk = remaining >= block.length ? block : block.subarray(0, remaining)
    if (!deflater.write(chunk)) await once(deflater, 'drain')
    remaining -= chunk.length
  }
  deflater.end()
  await once(deflater, 'end')
  return Buffer.concat(chunks)
}

function docxService(
  buffer: Buffer,
  extractDocxRawText: ContractReviewExtractionRuntime['extractDocxRawText'],
): ContractReviewExtractionService {
  const files = {
    readContentForEndUser: async () => ({
      buffer,
      filename: 'contract.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      purpose: 'contract_upload',
    }),
  }
  const runtime: ContractReviewExtractionRuntime = {
    extractDocxRawText,
    getDocumentProxy: async () => { throw new Error('unused') },
    extractPdfText: async () => { throw new Error('unused') },
    openPdfForRender: async () => { throw new Error('unused') },
  }
  return new ContractReviewExtractionService(
    files as never,
    { activeProviderName: 'disabled' } as never,
    runtime,
  )
}

async function expectCode(action: () => Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof Error)
    assert.equal(error.message, code)
    return true
  })
}

test('extracts valid DOCX canonically and rejects mammoth/empty/output failures', async () => {
  const archive = makeDocxArchive()
  const result = await docxService(
    archive,
    async () => ({ value: 'Café\r\n合同' }),
  ).extract({ fileId: 'docx', endUserId: null })
  assert.equal(result.mode, 'text_layer')
  assert.deepEqual(result.pages.map((page) => page.text), ['Café\n合同'])

  await expectCode(
    () => docxService(archive, async () => { throw new Error('zip details') })
      .extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_DOCX_EXTRACTION_FAILED',
  )
  await expectCode(
    () => docxService(archive, async () => ({ value: ' \r\n\t' }))
      .extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_TEXT_EMPTY',
  )
  await expectCode(
    () => docxService(archive, async () => ({ value: '甲'.repeat(200_001) }))
      .extract({ fileId: 'docx', endUserId: null }),
    'CONTRACT_PAGE_TEXT_LIMIT_EXCEEDED',
  )
})

test('accepts UTF-8 and standard legacy raw names resolved by Unicode Path extras', async () => {
  const unicodeFilename = 'word/备注.xml'
  const unicodeBytes = Buffer.from(unicodeFilename, 'utf8')
  const utf8Extra = makeUnicodePathExtra(unicodeBytes, unicodeFilename)
  const legacyBytes = Buffer.concat([
    Buffer.from('word/', 'ascii'),
    Buffer.from([0x82]),
    Buffer.from('.xml', 'ascii'),
  ])
  const legacyFilename = 'word/简历.xml'
  const legacyExtra = makeUnicodePathExtra(legacyBytes, legacyFilename)
  let mammothCalls = 0
  const archive = makeDocxArchive([
    { name: 'word/', content: Buffer.alloc(0), method: 0 },
    { name: 'word/document.xml', content: Buffer.from('doc'), method: 8 },
    {
      name: unicodeFilename, flags: 0x0800,
      localExtra: utf8Extra, centralExtra: utf8Extra,
    },
    {
      name: legacyFilename,
      filenameBytes: legacyBytes,
      localExtra: legacyExtra,
      centralExtra: legacyExtra,
    },
  ])
  await docxService(archive, async () => {
    mammothCalls += 1
    return { value: RELIABLE }
  }).extract({ fileId: 'docx', endUserId: null })
  assert.equal(mammothCalls, 1)
})

test('rejects every non-directory entry over the content budget before mammoth', async () => {
  let mammothCalls = 0
  const extract = async () => {
    mammothCalls += 1
    return { value: RELIABLE }
  }
  const cases: Array<[Buffer, string]> = [
    [Buffer.from('not-a-zip'), 'CONTRACT_DOCX_ARCHIVE_INVALID'],
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/styles.xml', content: Buffer.from('x'), declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
    ]), 'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED'],
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/_rels/target.bin', content: Buffer.from('x'), declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
    ]), 'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED'],
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/media/photo.jpg', content: Buffer.from([0xff]), declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
    ]), 'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED'],
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/media/logo.png', content: Buffer.from([0x89]), declaredUncompressedSize: 16 * 1024 * 1024 + 1 },
    ]), 'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED'],
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc') },
      { name: 'word/media/blob.bin', content: Buffer.from('x'), declaredUncompressedSize: 64 * 1024 * 1024 + 1 },
    ]), 'CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED'],
  ]
  for (const [archive, code] of cases) {
    await expectCode(
      () => docxService(archive, extract).extract({ fileId: 'docx', endUserId: null }),
      code,
    )
  }
  assert.equal(mammothCalls, 0)
})

test('rejects path aliases, unsupported ZIP features and Unicode Path mismatches', async () => {
  const unicodeFilename = 'word/备注.xml'
  const unicodeBytes = Buffer.from(unicodeFilename, 'utf8')
  const zip64Extra = Buffer.from([0x01, 0x00, 0x00, 0x00])
  const wrongVersionExtra = makeUnicodePathExtra(unicodeBytes, unicodeFilename)
  wrongVersionExtra.writeUInt8(2, 4)
  const legacyBytes = Buffer.concat([
    Buffer.from('word/', 'ascii'),
    Buffer.from([0x82]),
    Buffer.from('.xml', 'ascii'),
  ])
  const centralLegacyExtra = makeUnicodePathExtra(legacyBytes, 'word/central.xml')
  const localLegacyExtra = makeUnicodePathExtra(legacyBytes, 'word/local.xml')
  const alternateLegacyBytes = Buffer.concat([
    Buffer.from('word/', 'ascii'),
    Buffer.from([0x83]),
    Buffer.from('.xml', 'ascii'),
  ])
  const duplicateResolvedPath = 'word/duplicate.xml'
  const firstDuplicateExtra = makeUnicodePathExtra(legacyBytes, duplicateResolvedPath)
  const secondDuplicateExtra = makeUnicodePathExtra(alternateLegacyBytes, duplicateResolvedPath)
  const invalidArchives = [
    makeDocxArchive([{ name: 'x/../word/document.xml' }]),
    makeDocxArchive([{ name: 'word/document.xml', centralExtra: zip64Extra }]),
    makeDocxArchive([{ name: 'word/document.xml', method: 99 }]),
    makeDocxArchive([{ name: 'word/document.xml', flags: 0x0001 }]),
    makeDocxArchive([{ name: 'word/document.xml', flags: 0x0008 }]),
    makeDocxArchive([{ name: 'word/document.xml' }, { name: 'word/document.xml' }]),
    makeDocxArchive([{ name: 'word/document.xml' }, { name: 'WORD/DOCUMENT.XML' }]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: 'invalid', filenameBytes: Buffer.from([0xff]), flags: 0x0800 },
    ]),
    makeDocxArchive([{ name: 'word/document.xml' }, { name: 'word/样式.xml' }]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      {
        name: unicodeFilename, flags: 0x0800,
        centralExtra: makeUnicodePathExtra(unicodeBytes, unicodeFilename, 0),
      },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      {
        name: unicodeFilename, flags: 0x0800,
        centralExtra: makeUnicodePathExtra(unicodeBytes, 'word/other.xml'),
      },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      { name: unicodeFilename, flags: 0x0800, centralExtra: wrongVersionExtra },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      {
        name: 'word/central.xml',
        filenameBytes: legacyBytes,
        centralExtra: centralLegacyExtra,
        localExtra: localLegacyExtra,
      },
    ]),
    makeDocxArchive([
      { name: 'word/document.xml' },
      {
        name: duplicateResolvedPath,
        filenameBytes: legacyBytes,
        centralExtra: firstDuplicateExtra,
        localExtra: firstDuplicateExtra,
      },
      {
        name: duplicateResolvedPath,
        filenameBytes: alternateLegacyBytes,
        centralExtra: secondDuplicateExtra,
        localExtra: secondDuplicateExtra,
      },
    ]),
    makeDocxArchive([{ name: 'word/document.xml' }, { name: 'a'.repeat(1025) }]),
    makeDocxArchive([{ name: 'word/document.xml' }, { name: `${'a/'.repeat(64)}leaf.bin` }]),
  ]
  let mammothCalls = 0
  for (const archive of invalidArchives) {
    await expectCode(
      () => docxService(archive, async () => {
        mammothCalls += 1
        return { value: RELIABLE }
      }).extract({ fileId: 'docx', endUserId: null }),
      'CONTRACT_DOCX_ARCHIVE_INVALID',
    )
  }
  assert.equal(mammothCalls, 0)
})

test('stream-counts every actual deflate output against the content budget', async () => {
  let mammothCalls = 0
  const imageBytes = 16 * 1024 * 1024 + 1
  const image = await makeCompressedOutput(imageBytes, Buffer.from([0xff, 0xd8, 0xff, 0xe0]))
  const cases: Array<[Buffer, string]> = [
    [makeDocxArchive([
      { name: 'word/document.xml', content: Buffer.from('doc'), method: 8 },
      {
        name: 'word/media/photo.jpg', method: 8,
        compressedData: image, declaredUncompressedSize: 1,
      },
    ]), 'CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED'],
  ]
  for (const [archive, code] of cases) {
    await expectCode(
      () => docxService(archive, async () => {
        mammothCalls += 1
        return { value: RELIABLE }
      }).extract({ fileId: 'docx', endUserId: null }),
      code,
    )
  }
  assert.equal(mammothCalls, 0)
})

test('rejects stored/deflated content CRC failures and central-local CRC disagreement', async () => {
  const storedPayload = Buffer.from('stored-payload')
  const corruptedStored = makeDocxArchive([
    { name: 'word/document.xml', content: storedPayload, method: 0 },
  ])
  const storedDataOffset = 30 + Buffer.byteLength('word/document.xml')
  corruptedStored[storedDataOffset] = (corruptedStored[storedDataOffset] as number) ^ 0xff

  const declared = Buffer.from('declared')
  const deflatedMismatch = makeDocxArchive([{
    name: 'word/document.xml',
    content: declared,
    method: 8,
    compressedData: deflateRawSync(Buffer.from('mismatch')),
  }])
  const headerMismatch = makeDocxArchive([{
    name: 'word/document.xml',
    content: Buffer.from('doc'),
    localCrc: 0,
  }])

  let mammothCalls = 0
  for (const archive of [corruptedStored, deflatedMismatch, headerMismatch]) {
    await expectCode(
      () => docxService(archive, async () => {
        mammothCalls += 1
        return { value: RELIABLE }
      }).extract({ fileId: 'docx', endUserId: null }),
      'CONTRACT_DOCX_ARCHIVE_INVALID',
    )
  }
  assert.equal(mammothCalls, 0)
})
