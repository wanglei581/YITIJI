// 量「整块空白」：Playwright 截图（8 位、非交错 PNG）里，最长的一段连续空行有多高。
// 判据与草稿区的 blankscan.py 一致：每行在 x=80..宽-80 每 6px 取样，三个通道都与该行第一个点相差 ≤4 就算空行；
// 只看 y=300..高-200（跳过顶部意图带和底部导航）。只认纯色底，白卡片里的大片空白也量得到。
// 只解本项目截图用到的 PNG 格式（RGB / RGBA、8 位），别处不用。
import { inflateSync } from 'node:zlib'

type Raster = { width: number; height: number; channels: number; data: Buffer }

function decodePng(png: Buffer): Raster {
  if (png.readUInt32BE(0) !== 0x89504e47) throw new Error('不是 PNG')
  let width = 0
  let height = 0
  let channels = 0
  const idat: Buffer[] = []
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const body = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      const colorType = body[9]
      const interlace = body[12]
      if (depth !== 8 || interlace !== 0 || (colorType !== 2 && colorType !== 6)) {
        throw new Error(`不支持的 PNG：位深 ${depth}、颜色类型 ${colorType}、交错 ${interlace}`)
      }
      channels = colorType === 2 ? 3 : 4
    } else if (type === 'IDAT') {
      idat.push(body)
    }
    offset += 12 + length
  }
  const stride = width * channels
  const raw = inflateSync(Buffer.concat(idat))
  const data = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)]
    const src = y * (stride + 1) + 1
    const dst = y * stride
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? data[dst + x - channels] : 0
      const up = y > 0 ? data[dst - stride + x] : 0
      const upLeft = y > 0 && x >= channels ? data[dst - stride + x - channels] : 0
      const value = raw[src + x]
      let out: number
      if (filter === 0) out = value
      else if (filter === 1) out = value + left
      else if (filter === 2) out = value + up
      else if (filter === 3) out = value + ((left + up) >> 1)
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        out = value + (pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft)
      } else throw new Error(`PNG 行滤镜 ${filter} 不认识`)
      data[dst + x] = out & 0xff
    }
  }
  return { width, height, channels, data }
}

/** 最长的一段连续空行（像素高）和它起始的 y。 */
export function longestBlankRun(png: Buffer): { px: number; atY: number } {
  const { width, height, channels, data } = decodePng(png)
  const stride = width * channels
  let best = { px: 0, atY: 0 }
  let start = -1
  for (let y = 300; y < height - 200; y += 1) {
    const row = y * stride
    const r0 = data[row + 80 * channels]
    const g0 = data[row + 80 * channels + 1]
    const b0 = data[row + 80 * channels + 2]
    let blank = true
    for (let x = 80; x < width - 80; x += 6) {
      const at = row + x * channels
      if (Math.abs(data[at] - r0) > 4 || Math.abs(data[at + 1] - g0) > 4 || Math.abs(data[at + 2] - b0) > 4) {
        blank = false
        break
      }
    }
    if (blank) {
      if (start < 0) start = y
    } else {
      if (start >= 0 && y - start > best.px) best = { px: y - start, atY: start }
      start = -1
    }
  }
  return best
}
