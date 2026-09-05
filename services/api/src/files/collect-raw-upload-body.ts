/**
 * 本地代理直传（PUT /files/:id/raw）的流式体积闸门。
 *
 * 旧实现先把最多 200MB 收进内存，再按 purpose 上限（常见 20MB）拒绝——
 * 超限请求会打满内存。本函数在读取过程中累计字节，一超限立刻停，
 * 不再继续消费后续 chunk。
 */

export class RawUploadLimitExceededError extends Error {
  readonly maxBytes: number
  constructor(maxBytes: number) {
    super('FILE_TOO_LARGE')
    this.name = 'RawUploadLimitExceededError'
    this.maxBytes = maxBytes
  }
}

export async function collectBodyUntilByteLimit(
  source: AsyncIterable<Uint8Array | Buffer | string>,
  maxBytes: number,
): Promise<Buffer> {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    throw new RawUploadLimitExceededError(0)
  }
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of source) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buf.length
    if (total > maxBytes) {
      throw new RawUploadLimitExceededError(maxBytes)
    }
    chunks.push(buf)
  }
  if (chunks.length === 0) return Buffer.alloc(0)
  if (chunks.length === 1) return chunks[0]!
  return Buffer.concat(chunks, total)
}
