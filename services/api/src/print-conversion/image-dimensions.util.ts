export interface ImageDimensions {
  width: number
  height: number
}

/** 读取 JPEG/PNG 的像素宽高；不是这两种格式或头部损坏返回 null。 */
export function readImageDimensions(buffer: Buffer, mimeType: string): ImageDimensions | null {
  if (mimeType === 'image/png') return readPngDimensions(buffer)
  if (mimeType === 'image/jpeg') return readJpegDimensions(buffer)
  return null
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 24) return null
  const isPngSignature = buffer.readUInt32BE(0) === 0x89504e47 && buffer.readUInt32BE(4) === 0x0d0a1a0a
  if (!isPngSignature) return null
  // PNG 规定 IHDR 必须是签名后的第一个 chunk（长度 4 字节 + 类型 4 字节，位于偏移 8-15）。
  const isIhdrChunk = buffer.readUInt32BE(12) === 0x49484452 // "IHDR"
  if (!isIhdrChunk) return null
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  if (!width || !height) return null
  return { width, height }
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1
      continue
    }
    // JPEG 允许 marker 前出现任意个填充字节 0xFF（ITU-T T.81 §B.1.1.5，部分编码器/固件会产生）；
    // 真正的 marker code 是从 offset+1 起第一个不等于 0xFF 的字节。
    let markerOffset = offset + 1
    while (buffer[markerOffset] === 0xff) markerOffset += 1
    const marker = buffer[markerOffset]
    if (marker === undefined) return null
    // SOF0-SOF15（排除 DHT 0xC4 / JPG 0xC8 / DAC 0xCC，这三个不是帧起始段）都携带尺寸。
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
    if (isStartOfFrame) {
      // marker code 之后依次是：length(2) + precision(1) + height(2) + width(2)。
      if (markerOffset + 8 > buffer.length) return null
      const height = buffer.readUInt16BE(markerOffset + 4)
      const width = buffer.readUInt16BE(markerOffset + 6)
      if (!width || !height) return null
      return { width, height }
    }
    if (markerOffset + 3 > buffer.length) return null
    const segmentLength = buffer.readUInt16BE(markerOffset + 1)
    offset = markerOffset + 1 + segmentLength
  }
  return null
}
