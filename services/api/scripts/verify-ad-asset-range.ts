import assert from 'node:assert/strict'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import { parseByteRange } from '../src/content/content.controller'
import { LocalStorageBackend } from '../src/storage/local-storage.backend'

async function read(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
  await once(stream, 'end')
  return Buffer.concat(chunks)
}

async function main(): Promise<void> {
  assert.deepEqual(parseByteRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseByteRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseByteRange('bytes=-4', 10), { start: 6, end: 9 })
  assert.equal(parseByteRange('bytes=10-', 10), null)
  assert.equal(parseByteRange('bytes=1-2,4-5', 10), null)

  const storage = new LocalStorageBackend()
  const key = `verify/ad-range-${randomUUID()}.bin`
  const source = Buffer.from('0123456789')
  try {
    await storage.putObject(key, source, 'application/octet-stream')
    const full = await storage.getObjectStream(key)
    assert.equal(full.sizeBytes, 10)
    assert.equal(full.contentLength, 10)
    assert.deepEqual(await read(full.stream), source)
    const partial = await storage.getObjectStream(key, { start: 2, end: 5 })
    assert.equal(partial.contentLength, 4)
    assert.equal((await read(partial.stream)).toString(), '2345')
    console.log('PASS byte-range parsing and local full/partial streaming')
  } finally {
    await storage.deleteObject(key)
  }
}

void main()
