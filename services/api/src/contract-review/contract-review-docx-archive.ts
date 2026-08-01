import { TextDecoder } from 'node:util'
import { createInflateRaw } from 'node:zlib'

const MAX_CONTENT_BYTES = 16 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024
const MAX_ENTRIES = 4096
const LOCAL_FILE_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const MAX_COMMENT_BYTES = 0xffff
const ZIP64_EXTRA_FIELD_ID = 0x0001
const UNICODE_PATH_EXTRA_FIELD_ID = 0x7075
const ALLOWED_FLAGS = 0x0806
const MAX_FILENAME_BYTES = 1024
const MAX_PATH_SEGMENTS = 64

interface DocxZipEntry {
  filename: string
  filenameBytes: Buffer
  isDirectory: boolean
  flags: number
  method: 0 | 8
  contentCrc: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dataStart: number
  dataEnd: number
}

class DocxArchiveError extends Error {
  constructor(readonly code: string) {
    super(code)
    this.name = 'DocxArchiveError'
  }
}

function fail(code: string): DocxArchiveError {
  return new DocxArchiveError(code)
}

function knownOr(error: unknown, fallback: string): DocxArchiveError {
  return error instanceof DocxArchiveError ? error : fail(fallback)
}

function updateCrc32(crc: number, input: Buffer): number {
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0)
    }
  }
  return crc >>> 0
}

function crc32(input: Buffer): number {
  return (updateCrc32(0xffffffff, input) ^ 0xffffffff) >>> 0
}

function readUnicodePathExtra(
  buffer: Buffer,
  offset: number,
  length: number,
  filenameBytes: Buffer,
): string | null {
  const end = offset + length
  let cursor = offset
  let unicodePath: string | null = null
  while (cursor < end) {
    if (cursor + 4 > end) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    const fieldId = buffer.readUInt16LE(cursor)
    const fieldLength = buffer.readUInt16LE(cursor + 2)
    cursor += 4
    if (cursor + fieldLength > end || fieldId === ZIP64_EXTRA_FIELD_ID) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    if (fieldId === UNICODE_PATH_EXTRA_FIELD_ID) {
      if (
        unicodePath !== null ||
        fieldLength < 5 ||
        buffer.readUInt8(cursor) !== 1
      ) {
        throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
      }
      const expectedCrc = buffer.readUInt32LE(cursor + 1)
      const decodedPath = new TextDecoder('utf-8', { fatal: true }).decode(
        buffer.subarray(cursor + 5, cursor + fieldLength),
      )
      if (
        expectedCrc !== crc32(filenameBytes) ||
        decodedPath !== decodedPath.normalize('NFC')
      ) {
        throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
      }
      unicodePath = decodedPath
    }
    cursor += fieldLength
  }
  return unicodePath
}

function resolveCanonicalPath(
  filenameBytes: Buffer,
  flags: number,
  unicodePath: string | null,
): { filename: string; isDirectory: boolean } {
  const usesUtf8 = (flags & 0x0800) !== 0
  let filename: string
  if (usesUtf8) {
    const rawFilename = new TextDecoder('utf-8', { fatal: true }).decode(filenameBytes)
    if (
      !Buffer.from(rawFilename, 'utf8').equals(filenameBytes) ||
      (unicodePath !== null && unicodePath !== rawFilename)
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    filename = rawFilename
  } else if (unicodePath !== null) {
    filename = unicodePath
  } else {
    if (filenameBytes.some((byte) => byte > 0x7f)) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    filename = filenameBytes.toString('ascii')
  }
  const isDirectory = filename.endsWith('/')
  const rawIsDirectory = filenameBytes[filenameBytes.length - 1] === 0x2f
  const canonicalPath = isDirectory ? filename.slice(0, -1) : filename
  const segments = canonicalPath.split('/')
  if (
    filenameBytes.length === 0 ||
    filenameBytes.length > MAX_FILENAME_BYTES ||
    Buffer.byteLength(filename, 'utf8') > MAX_FILENAME_BYTES ||
    rawIsDirectory !== isDirectory ||
    canonicalPath === '' ||
    canonicalPath !== canonicalPath.normalize('NFC') ||
    filename.startsWith('/') ||
    /^[A-Za-z]:/u.test(filename) ||
    filename.includes(':') ||
    filename.includes('\\') ||
    /[\p{Cc}\p{Cf}]/u.test(filename) ||
    segments.length > MAX_PATH_SEGMENTS ||
    segments.some(
      (segment) =>
        segment === '' ||
        segment === '.' ||
        segment === '..' ||
        segment.endsWith('.') ||
        segment.endsWith(' '),
    )
  ) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }
  return { filename, isDirectory }
}

function canonicalPathKey(filename: string): string {
  return filename.replace(/\/$/u, '').normalize('NFKC').toLowerCase()
}

function parseCentralDirectory(buffer: Buffer): DocxZipEntry[] {
  const minimumOffset = Math.max(0, buffer.length - MAX_COMMENT_BYTES - 22)
  let eocdOffset = -1
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue
    const commentLength = buffer.readUInt16LE(offset + 20)
    if (offset + 22 + commentLength === buffer.length) {
      eocdOffset = offset
      break
    }
  }
  if (eocdOffset < 0) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')

  const diskNumber = buffer.readUInt16LE(eocdOffset + 4)
  const centralDisk = buffer.readUInt16LE(eocdOffset + 6)
  const entriesOnDisk = buffer.readUInt16LE(eocdOffset + 8)
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10)
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  if (
    diskNumber !== 0 ||
    centralDisk !== 0 ||
    entriesOnDisk !== totalEntries ||
    totalEntries === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff ||
    centralOffset + centralSize !== eocdOffset
  ) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }
  if (totalEntries < 1 || totalEntries > MAX_ENTRIES) {
    throw fail('CONTRACT_DOCX_ARCHIVE_ENTRY_LIMIT_EXCEEDED')
  }

  const entries: DocxZipEntry[] = []
  const canonicalNames = new Set<string>()
  let cursor = centralOffset
  let declaredTotalBytes = 0
  let declaredContentBytes = 0
  let documentXmlCount = 0
  for (let index = 0; index < totalEntries; index += 1) {
    if (
      cursor + 46 > eocdOffset ||
      buffer.readUInt32LE(cursor) !== CENTRAL_DIRECTORY_SIGNATURE
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const flags = buffer.readUInt16LE(cursor + 8)
    const method = buffer.readUInt16LE(cursor + 10)
    const contentCrc = buffer.readUInt32LE(cursor + 16)
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const filenameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    const diskStart = buffer.readUInt16LE(cursor + 34)
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42)
    const filenameStart = cursor + 46
    const extraStart = filenameStart + filenameLength
    const next = extraStart + extraLength + commentLength
    if (
      diskStart !== 0 ||
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff ||
      (flags & ~ALLOWED_FLAGS) !== 0 ||
      (method !== 0 && method !== 8) ||
      next > eocdOffset
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const filenameBytes = Buffer.from(buffer.subarray(filenameStart, extraStart))
    const unicodePath = readUnicodePathExtra(buffer, extraStart, extraLength, filenameBytes)
    const { filename, isDirectory } = resolveCanonicalPath(filenameBytes, flags, unicodePath)
    if (isDirectory && (method !== 0 || compressedSize !== 0 || uncompressedSize !== 0)) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const canonicalName = canonicalPathKey(filename)
    if (canonicalNames.has(canonicalName)) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    canonicalNames.add(canonicalName)

    declaredTotalBytes += uncompressedSize
    if (!isDirectory) declaredContentBytes += uncompressedSize
    if (declaredTotalBytes > MAX_TOTAL_BYTES) {
      throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
    }
    if (declaredContentBytes > MAX_CONTENT_BYTES) {
      throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
    }
    if (filename === 'word/document.xml') documentXmlCount += 1
    entries.push({
      filename,
      filenameBytes,
      isDirectory,
      flags,
      method: method as 0 | 8,
      contentCrc,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataStart: 0,
      dataEnd: 0,
    })
    cursor = next
  }
  if (cursor !== eocdOffset || documentXmlCount !== 1) {
    throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
  }

  const filePaths = new Set(
    entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => canonicalPathKey(entry.filename)),
  )
  for (const entry of entries) {
    const segments = canonicalPathKey(entry.filename).split('/')
    let ancestor = ''
    for (let index = 0; index < segments.length - 1; index += 1) {
      ancestor = ancestor.length === 0 ? (segments[index] as string) : `${ancestor}/${segments[index]}`
      if (filePaths.has(ancestor)) throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
  }

  const withLocalRanges = entries.map((entry) => {
    const offset = entry.localHeaderOffset
    if (offset + 30 > centralOffset || buffer.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const localFlags = buffer.readUInt16LE(offset + 6)
    const localMethod = buffer.readUInt16LE(offset + 8)
    const localContentCrc = buffer.readUInt32LE(offset + 14)
    const localCompressedSize = buffer.readUInt32LE(offset + 18)
    const localUncompressedSize = buffer.readUInt32LE(offset + 22)
    const filenameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const filenameStart = offset + 30
    const extraStart = filenameStart + filenameLength
    const dataStart = extraStart + extraLength
    const dataEnd = dataStart + entry.compressedSize
    const localFilenameBytes = Buffer.from(buffer.subarray(filenameStart, extraStart))
    if (
      localFlags !== entry.flags ||
      localMethod !== entry.method ||
      localContentCrc !== entry.contentCrc ||
      dataEnd > centralOffset ||
      !localFilenameBytes.equals(entry.filenameBytes) ||
      localCompressedSize !== entry.compressedSize ||
      localUncompressedSize !== entry.uncompressedSize
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    const localUnicodePath = readUnicodePathExtra(
      buffer,
      extraStart,
      extraLength,
      localFilenameBytes,
    )
    const localPath = resolveCanonicalPath(localFilenameBytes, localFlags, localUnicodePath)
    if (localPath.filename !== entry.filename || localPath.isDirectory !== entry.isDirectory) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
    return { ...entry, dataStart, dataEnd }
  })
  const ranges = [...withLocalRanges].sort(
    (left, right) => left.localHeaderOffset - right.localHeaderOffset,
  )
  for (let index = 1; index < ranges.length; index += 1) {
    if (
      (ranges[index - 1] as DocxZipEntry).dataEnd >
      (ranges[index] as DocxZipEntry).localHeaderOffset
    ) {
      throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
    }
  }
  return withLocalRanges
}

async function countDeflatedEntryBytes(
  compressed: Buffer,
  priorTotalBytes: number,
  priorContentBytes: number,
): Promise<{ entryBytes: number; totalBytes: number; contentBytes: number; contentCrc: number }> {
  const inflater = createInflateRaw()
  let entryBytes = 0
  let totalBytes = priorTotalBytes
  let contentBytes = priorContentBytes
  let contentCrc = 0xffffffff
  try {
    inflater.end(compressed)
    for await (const chunk of inflater) {
      const source = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      entryBytes += source.length
      totalBytes += source.length
      contentBytes += source.length
      contentCrc = updateCrc32(contentCrc, source)
      if (entryBytes > MAX_TOTAL_BYTES || totalBytes > MAX_TOTAL_BYTES) {
        throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
      }
      if (contentBytes > MAX_CONTENT_BYTES) {
        throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
      }
    }
  } catch (error) {
    throw knownOr(error, 'CONTRACT_DOCX_ARCHIVE_INVALID')
  } finally {
    inflater.destroy()
  }
  return {
    entryBytes,
    totalBytes,
    contentBytes,
    contentCrc: (contentCrc ^ 0xffffffff) >>> 0,
  }
}

export async function assertDocxArchiveSafe(buffer: Buffer): Promise<void> {
  try {
    const entries = parseCentralDirectory(buffer)
    let totalBytes = 0
    let contentBytes = 0
    for (const entry of entries) {
      const compressed = buffer.subarray(entry.dataStart, entry.dataEnd)
      if (entry.method === 0) {
        const entryBytes = compressed.length
        totalBytes += entryBytes
        if (!entry.isDirectory) contentBytes += entryBytes
        if (entryBytes > MAX_TOTAL_BYTES || totalBytes > MAX_TOTAL_BYTES) {
          throw fail('CONTRACT_DOCX_ARCHIVE_SIZE_LIMIT_EXCEEDED')
        }
        if (contentBytes > MAX_CONTENT_BYTES) {
          throw fail('CONTRACT_DOCX_XML_SIZE_LIMIT_EXCEEDED')
        }
        if (
          entryBytes !== entry.uncompressedSize ||
          crc32(compressed) !== entry.contentCrc
        ) {
          throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
        }
        continue
      }
      const counted = await countDeflatedEntryBytes(
        compressed,
        totalBytes,
        contentBytes,
      )
      if (
        counted.entryBytes !== entry.uncompressedSize ||
        counted.contentCrc !== entry.contentCrc
      ) {
        throw fail('CONTRACT_DOCX_ARCHIVE_INVALID')
      }
      totalBytes = counted.totalBytes
      contentBytes = counted.contentBytes
    }
  } catch (error) {
    throw knownOr(error, 'CONTRACT_DOCX_ARCHIVE_INVALID')
  }
}
