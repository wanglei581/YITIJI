import { TWIN_DEFAULT_CAMERA, groundToStage, type TwinCamera } from './twinMath'

/**
 * 场景里立起来的牌子（区名牌、告警牌）互相避让。
 *
 * 牌子是广告牌：底部钉在地面锚点上、正对镜头立起，高度按锚点的透视比例缩放。
 * 这里按当前镜头（默认或聚焦）把每块牌子投影成舞台上的矩形，逐块试几档抬高，取第一档不与已放下的牌子
 * （以及中枢）重叠的；区名牌放不下也要挂，取重叠最小的一档；告警牌放不下就不挂 ——
 * 完整告警清单在告警面板里，不会因此少一条。
 */

export interface TwinLabelRequest {
  key: string
  /** 广告牌底部在地面上的锚点（世界坐标）。 */
  u: number
  v: number
  /** 首选抬高与最低抬高（世界单位）。 */
  lift: number
  minLift: number
  /** 牌子本身的宽高（舞台像素，未乘透视比例）。 */
  width: number
  height: number
  /** true = 放不下就不挂。 */
  optional: boolean
}

export interface TwinBox {
  x0: number
  x1: number
  y0: number
  y1: number
}

/** 试的顺序：先原位，再逐档往上，最后才往下压（不低于 minLift）。 */
const CANDIDATES = [0, 40, 80, 120, 170, 220, -30, -60, -90, -120]
/** 牌子之间留的空隙（舞台像素）。 */
const GAP = 4

function overlapArea(a: TwinBox, b: TwinBox): number {
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)
  return w > 0 && h > 0 ? w * h : 0
}

/** 广告牌在舞台上的矩形：顶边 = 锚点屏幕位置往上抬 lift × 纵向比例。 */
export function twinLabelBox(u: number, v: number, lift: number, width: number, height: number, camera: TwinCamera = TWIN_DEFAULT_CAMERA): TwinBox {
  const a = groundToStage(u, v, camera)
  const top = a.y - lift * a.sy
  return {
    x0: a.x - (width / 2) * a.sx - GAP,
    x1: a.x + (width / 2) * a.sx + GAP,
    y0: top - GAP,
    y1: top + height * a.sy + GAP,
  }
}

/** 估算牌子文字宽度（按实际渲染校过）：汉字一个字号宽，空格 0.3 个，数字与字母 0.58 个。 */
export function twinLabelWidth(text: string, fontPx: number, letterSpacing: number, padding: number): number {
  let width = padding
  for (const ch of text) {
    const code = ch.charCodeAt(0)
    width += (code >= 0x2e80 ? fontPx + letterSpacing : code === 0x20 ? fontPx * 0.3 : fontPx * 0.58)
  }
  return width
}

/** 按请求顺序依次放；返回每块牌子的抬高，null = 不挂。 */
export function layoutTwinLabels(
  requests: readonly TwinLabelRequest[],
  obstacles: readonly TwinBox[],
  camera: TwinCamera = TWIN_DEFAULT_CAMERA,
): Map<string, number | null> {
  const placed: TwinBox[] = [...obstacles]
  const out = new Map<string, number | null>()
  for (const r of requests) {
    let best: { lift: number; box: TwinBox; overlap: number } | null = null
    for (const delta of CANDIDATES) {
      const lift = r.lift + delta
      if (lift < r.minLift) continue
      const box = twinLabelBox(r.u, r.v, lift, r.width, r.height, camera)
      if (box.y0 < 0) continue
      let overlap = 0
      for (const other of placed) overlap += overlapArea(box, other)
      if (!best || overlap < best.overlap) best = { lift, box, overlap }
      if (overlap === 0) break
    }
    if (!best || (best.overlap > 0 && r.optional)) {
      out.set(r.key, null)
      continue
    }
    placed.push(best.box)
    out.set(r.key, best.lift)
  }
  return out
}
