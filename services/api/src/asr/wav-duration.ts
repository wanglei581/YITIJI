/** Read only complete PCM/IEEE-float WAV data, including padded RIFF chunks. */
export function wavDuration(buffer: Buffer): { audioSeconds: number | null; complete: boolean; rule: 'v1' } {
  const incomplete = { audioSeconds: null, complete: false, rule: 'v1' as const }
  if (buffer.length < 12 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return incomplete
  const end = buffer.readUInt32LE(4) + 8
  if (end < 12 || end > buffer.length) return incomplete
  let byteRate = 0, blockAlign = 0, dataLength: number | undefined, formatSeen = false
  for (let offset = 12; offset < end;) {
    if (offset + 8 > end) return incomplete
    const id = buffer.toString('ascii', offset, offset + 4)
    const size = buffer.readUInt32LE(offset + 4)
    const start = offset + 8
    const next = start + size + (size % 2)
    if (next > end) return incomplete
    if (id === 'fmt ') {
      if (formatSeen || size < 16) return incomplete
      formatSeen = true
      const format = buffer.readUInt16LE(start), channels = buffer.readUInt16LE(start + 2)
      const rate = buffer.readUInt32LE(start + 4), bytes = buffer.readUInt32LE(start + 8)
      const align = buffer.readUInt16LE(start + 12), bits = buffer.readUInt16LE(start + 14)
      if (!channels || !rate || (format === 1 ? ![8, 16, 24, 32].includes(bits) : format === 3 ? ![32, 64].includes(bits) : true) || align !== channels * bits / 8 || bytes !== rate * align) return incomplete
      byteRate = bytes
      blockAlign = align
    } else if (id === 'data') {
      if (dataLength !== undefined) return incomplete
      dataLength = size
    }
    offset = next
  }
  if (!byteRate || dataLength === undefined || dataLength % blockAlign !== 0) return incomplete
  return { audioSeconds: dataLength / byteRate, complete: true, rule: 'v1' }
}
