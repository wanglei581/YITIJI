import { Workbook } from 'exceljs'
import { inflateRawSync } from 'node:zlib'

export const PARTNER_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024
export const PARTNER_IMPORT_MAX_DATA_ROWS = 10_000
export const PARTNER_IMPORT_MAX_XLSX_ENTRIES = 1_000
export const PARTNER_IMPORT_MAX_XLSX_ENTRY_BYTES = 32 * 1024 * 1024
export const PARTNER_IMPORT_MAX_XLSX_EXPANDED_BYTES = 64 * 1024 * 1024

const ZIP_CENTRAL_HEADER = 0x02014b50
const ZIP_LOCAL_HEADER = 0x04034b50
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50
const ZIP_MAX_COMMENT_BYTES = 0xffff

interface XlsxArchiveLimits {
  maxEntries: number
  maxEntryBytes: number
  maxExpandedBytes: number
}

function archiveLimitExceeded(): never {
  throw new Error('IMPORT_XLSX_ARCHIVE_LIMIT_EXCEEDED')
}

function invalidArchive(): never {
  throw new Error('IMPORT_XLSX_ARCHIVE_INVALID')
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const firstCandidate = Math.max(0, buffer.length - 22 - ZIP_MAX_COMMENT_BYTES)
  for (let offset = buffer.length - 22; offset >= firstCandidate; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== ZIP_END_OF_CENTRAL_DIRECTORY) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) return offset
  }
  return invalidArchive()
}

export function assertSafeXlsxArchive(
  buffer: Buffer,
  limits: XlsxArchiveLimits = {
    maxEntries: PARTNER_IMPORT_MAX_XLSX_ENTRIES,
    maxEntryBytes: PARTNER_IMPORT_MAX_XLSX_ENTRY_BYTES,
    maxExpandedBytes: PARTNER_IMPORT_MAX_XLSX_EXPANDED_BYTES,
  },
): void {
  const endOffset = findEndOfCentralDirectory(buffer)
  const diskNumber = buffer.readUInt16LE(endOffset + 4)
  const centralDisk = buffer.readUInt16LE(endOffset + 6)
  const diskEntries = buffer.readUInt16LE(endOffset + 8)
  const entryCount = buffer.readUInt16LE(endOffset + 10)
  const centralSize = buffer.readUInt32LE(endOffset + 12)
  const centralOffset = buffer.readUInt32LE(endOffset + 16)
  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entryCount) invalidArchive()
  if (entryCount === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) archiveLimitExceeded()
  if (entryCount > limits.maxEntries) archiveLimitExceeded()
  if (centralOffset + centralSize > endOffset) invalidArchive()

  let expandedBytes = 0
  let offset = centralOffset
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > endOffset || buffer.readUInt32LE(offset) !== ZIP_CENTRAL_HEADER) invalidArchive()
    const flags = buffer.readUInt16LE(offset + 8)
    const compressionMethod = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const declaredExpandedSize = buffer.readUInt32LE(offset + 24)
    const fileNameLength = buffer.readUInt16LE(offset + 28)
    const extraLength = buffer.readUInt16LE(offset + 30)
    const commentLength = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    if ((flags & 0x1) !== 0 || compressedSize === 0xffffffff || declaredExpandedSize === 0xffffffff) invalidArchive()
    if (declaredExpandedSize > limits.maxEntryBytes || expandedBytes + declaredExpandedSize > limits.maxExpandedBytes) {
      archiveLimitExceeded()
    }
    const nextOffset = offset + 46 + fileNameLength + extraLength + commentLength
    if (nextOffset > endOffset) invalidArchive()

    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== ZIP_LOCAL_HEADER) invalidArchive()
    const localFileNameLength = buffer.readUInt16LE(localOffset + 26)
    const localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localFileNameLength + localExtraLength
    const dataEnd = dataStart + compressedSize
    if (dataEnd > buffer.length) invalidArchive()

    let actualExpandedSize: number
    if (compressionMethod === 0) {
      actualExpandedSize = compressedSize
    } else if (compressionMethod === 8) {
      const remainingBytes = Math.min(limits.maxEntryBytes, limits.maxExpandedBytes - expandedBytes)
      if (remainingBytes <= 0 && compressedSize > 0) archiveLimitExceeded()
      try {
        actualExpandedSize = inflateRawSync(buffer.subarray(dataStart, dataEnd), {
          maxOutputLength: Math.max(1, remainingBytes),
        }).byteLength
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ERR_BUFFER_TOO_LARGE') archiveLimitExceeded()
        return invalidArchive()
      }
    } else {
      return invalidArchive()
    }
    if (actualExpandedSize !== declaredExpandedSize) invalidArchive()
    expandedBytes += actualExpandedSize
    if (expandedBytes > limits.maxExpandedBytes) archiveLimitExceeded()
    offset = nextOffset
  }
  if (offset !== centralOffset + centralSize) invalidArchive()
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const pushRow = () => {
    row.push(field)
    if (row.some((value) => value.trim() !== '')) {
      rows.push(row)
      if (rows.length > PARTNER_IMPORT_MAX_DATA_ROWS + 1) throw new Error('IMPORT_ROW_LIMIT_EXCEEDED')
    }
    row = []
    field = ''
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === '"' && field === '') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      pushRow()
      if (char === '\r' && text[index + 1] === '\n') index += 1
    } else {
      field += char
    }
  }

  if (quoted) throw new Error('CSV_UNCLOSED_QUOTE')
  if (field !== '' || row.length > 0) pushRow()
  return rows
}

export async function loadPartnerImportRows(buffer: Buffer, fileName: string): Promise<string[][]> {
  if (buffer.byteLength > PARTNER_IMPORT_MAX_FILE_BYTES) throw new Error('IMPORT_FILE_TOO_LARGE')
  if (/\.csv$/i.test(fileName)) {
    return parseCsv(buffer.toString('utf8').replace(/^\uFEFF/, ''))
  }
  if (!/\.xlsx$/i.test(fileName)) throw new Error('UNSUPPORTED_FILE_FORMAT')

  assertSafeXlsxArchive(buffer)
  const workbook = new Workbook()
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)
  const worksheet = workbook.getWorksheet(1)
  if (!worksheet) return []
  if (worksheet.actualRowCount > PARTNER_IMPORT_MAX_DATA_ROWS + 1) throw new Error('IMPORT_ROW_LIMIT_EXCEEDED')

  const rows: string[][] = []
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    rows.push(Array.from({ length: worksheet.columnCount }, (_, index) => row.getCell(index + 1).text))
  })
  return rows
}
