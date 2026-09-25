/**
 * 孪生场景的几何：屏幕坐标 ↔ 地面坐标、按名字确定的伪随机、区块排布。
 *
 * 三条约定：
 *   1. **没有 Math.random**。建筑体块的尺寸、位置按区名哈希得出，每次刷新一模一样；
 *      否则 15 秒一次轮询会让整座城「抖」一下，看屏的人会以为数据在变。
 *   2. 区块位置有经纬度就按真实相对方位摆，没有就按终端数从中心向外排；
 *      两种都只是**示意**，页面脚注必须写明，不冒充地图。
 *   3. 场景以设计稿 976×780 舞台为基准，所有布局在这个坐标系里算，桌面档整体缩放。
 */

export const TWIN_STAGE_W = 976
export const TWIN_STAGE_H = 780
export const TWIN_WORLD = 900
const PERSP = 1700
const ORIGIN_X = TWIN_STAGE_W / 2
const ORIGIN_Y = TWIN_STAGE_H * 0.34
const WORLD_CX = 38 + TWIN_WORLD / 2
const WORLD_CY = 18 + TWIN_WORLD / 2
const YAW = (38 * Math.PI) / 180

/** 广告牌反向旋转：与 .tw3-bb 的 transform 一致，写在这里给行内样式用。 */
export const TWIN_BILLBOARD = 'rotateZ(38deg) rotateX(calc(-1 * var(--tilt)))'

export interface GroundPoint {
  u: number
  v: number
  /** 透视缩放：越远越小，用来把「屏幕上想要的抬高」换算成世界里的高度。 */
  scale: number
}

/** 默认镜头（倾角 58°）下，舞台像素 (x, y) 对应的地面点。 */
export function stageToGround(x: number, y: number, tiltDeg = 58): GroundPoint {
  const tilt = (tiltDeg * Math.PI) / 180
  const c = Math.cos(tilt)
  const s = Math.sin(tilt)
  const y1 = (PERSP * (y - ORIGIN_Y - (WORLD_CY - ORIGIN_Y))) / (PERSP * c + (y - ORIGIN_Y) * s)
  const scale = PERSP / (PERSP - y1 * s)
  const x1 = (x - ORIGIN_X) / scale - (WORLD_CX - ORIGIN_X)
  return {
    u: TWIN_WORLD / 2 + x1 * Math.cos(YAW) - y1 * Math.sin(YAW),
    v: TWIN_WORLD / 2 + x1 * Math.sin(YAW) + y1 * Math.cos(YAW),
    scale,
  }
}

/** FNV-1a：把字符串变成稳定的 32 位种子。 */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** mulberry32：确定性的 [0,1) 序列。同一个种子永远给同一串数。 */
export function seededSequence(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface DistrictInput {
  key: string
  count: number
  /** 该区终端的平均经纬度；没有坐标为 null。 */
  geo: { lat: number; lng: number } | null
}

export interface DistrictPlacement {
  key: string
  cx: number
  cy: number
  r: number
}

const CENTER = TWIN_WORLD / 2
/** 数据中枢占住的半径（与 TwinCity 里中枢光环的大小一致）。 */
export const HUB_R = 70
const MIN_R = 58
const MAX_R = 104

function radiusFor(count: number): number {
  return Math.max(MIN_R, Math.min(MAX_R, 46 + Math.sqrt(count) * 16))
}

/**
 * 区块摆放。
 * 两个以上的区有坐标：按经纬度的相对方位铺进世界（北在上），再做互斥松弛防重叠；
 * 否则：终端最多的区放中心偏上，其余按黄金角螺旋向外排。
 */
export function placeDistricts(input: readonly DistrictInput[]): DistrictPlacement[] {
  const items = [...input].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  const withGeo = items.filter((item) => item.geo)
  let placed: DistrictPlacement[]
  if (withGeo.length >= 2) {
    const lats = withGeo.map((item) => (item.geo as { lat: number }).lat)
    const lngs = withGeo.map((item) => (item.geo as { lng: number }).lng)
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    const spanLat = maxLat - minLat || 1
    const spanLng = maxLng - minLng || 1
    const spread = 520
    let ring = 0
    placed = items.map((item) => {
      if (item.geo) {
        return {
          key: item.key,
          cx: CENTER - spread / 2 + ((item.geo.lng - minLng) / spanLng) * spread,
          cy: CENTER - spread / 2 + ((maxLat - item.geo.lat) / spanLat) * spread,
          r: radiusFor(item.count),
        }
      }
      // 没有坐标的区（含「未设置所在区」）放到外圈，不混进真实方位里
      const angle = (ring * 137.5 * Math.PI) / 180
      ring += 1
      return { key: item.key, cx: CENTER + Math.cos(angle) * 360, cy: CENTER + Math.sin(angle) * 360, r: radiusFor(item.count) }
    })
  } else {
    placed = items.map((item, index) => {
      if (index === 0) return { key: item.key, cx: CENTER + 60, cy: CENTER - 110, r: radiusFor(item.count) }
      const angle = (index * 137.5 * Math.PI) / 180
      const dist = 150 + Math.sqrt(index) * 105
      return {
        key: item.key,
        cx: CENTER + Math.cos(angle) * dist,
        cy: CENTER + Math.sin(angle) * dist * 0.9,
        r: radiusFor(item.count),
      }
    })
  }
  // 互斥松弛：两区圆心距离小于半径和 + 40 就沿连线推开，迭代若干轮；
  // 世界中心是数据中枢（半径 HUB_R，不动），各区也要让开它。
  for (let pass = 0; pass < 60; pass += 1) {
    let moved = false
    for (const d of placed) {
      const dx = d.cx - CENTER
      const dy = d.cy - CENTER
      const dist = Math.max(Math.hypot(dx, dy), 0.01)
      const need = d.r + HUB_R + 30
      if (dist < need) {
        d.cx = CENTER + (dx / dist) * need
        d.cy = CENTER + (dy / dist) * need
        moved = true
      }
    }
    for (let i = 0; i < placed.length; i += 1) {
      for (let j = i + 1; j < placed.length; j += 1) {
        const a = placed[i]
        const b = placed[j]
        const dx = b.cx - a.cx
        const dy = b.cy - a.cy
        const dist = Math.max(Math.hypot(dx, dy), 0.01)
        const need = a.r + b.r + 40
        if (dist < need) {
          const push = (need - dist) / 2
          const nx = dx / dist
          const ny = dy / dist
          a.cx -= nx * push
          a.cy -= ny * push
          b.cx += nx * push
          b.cy += ny * push
          moved = true
        }
      }
    }
    if (!moved) break
  }
  return placed
}

export interface BlockPlacement {
  x: number
  y: number
  w: number
  d: number
  h: number
  cbd: boolean
}

/** 区内的装饰体块：数量随终端数，尺寸与位置按区名确定。 */
export function placeBlocks(district: DistrictPlacement, terminalCount: number, tallest: boolean): BlockPlacement[] {
  const next = seededSequence(hashSeed(`blocks:${district.key}`))
  const want = Math.max(4, Math.min(9, 3 + terminalCount))
  const maxH = tallest ? 120 : 70
  const out: Array<{ x: number; y: number; w: number; d: number }> = []
  for (let tries = 0; out.length < want && tries < 400; tries += 1) {
    const w = 26 + Math.floor(next() * 20)
    const d = 26 + Math.floor(next() * 20)
    const x = Math.round(district.cx + (next() * 2 - 1) * district.r - w / 2)
    const y = Math.round(district.cy + (next() * 2 - 1) * district.r * 0.8 - d / 2)
    if (Math.hypot(x + w / 2 - district.cx, y + d / 2 - district.cy) > district.r) continue
    const clash = out.some((b) => !(x + w + 8 < b.x || b.x + b.w + 8 < x || y + d + 8 < b.y || b.y + b.d + 8 < y))
    if (clash) continue
    out.push({ x, y, w, d })
  }
  out.sort((a, b) => a.y + a.d - (b.y + b.d) || a.x - b.x)
  return out.map((block, index) => {
    const tall = tallest && index % 3 === 0
    const h = Math.round(maxH * (0.35 + next() * 0.65)) + (tall ? 60 : 0)
    return { ...block, h, cbd: tall }
  })
}

/** 区内终端立柱的落点：沿区块边缘均匀分布，按终端编号排序保证稳定。 */
export function placeTerminals(district: DistrictPlacement, count: number): Array<{ x: number; y: number }> {
  const next = seededSequence(hashSeed(`terminals:${district.key}`))
  const out: Array<{ x: number; y: number }> = []
  for (let k = 0; k < count; k += 1) {
    const angle = (k / Math.max(count, 1)) * Math.PI * 2 + (next() - 0.5) * 0.4
    const rad = district.r * (0.6 + next() * 0.42)
    out.push({
      x: Math.round(district.cx + Math.cos(angle) * rad),
      y: Math.round(district.cy + Math.sin(angle) * rad * 0.9),
    })
  }
  return out
}

/** 把选中区推到画面中心的相机参数（聚焦模式）。 */
export function focusCamera(district: DistrictPlacement | null): { zoom: number; dx: number; dy: number } {
  if (!district) return { zoom: 1, dx: 0, dy: 0 }
  return { zoom: 1.45, dx: CENTER - district.cx, dy: CENTER - district.cy + 30 }
}
