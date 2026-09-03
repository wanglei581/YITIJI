/**
 * 五维倾向形态图。
 *
 * **这不是一张打分图。** 设计规范（docs/design/kiosk-ai-os-v3-2026-08/28-self-assessment.html:30）
 * 明写「不用 MBTI/大五/DISC/霍兰德标签、不打分排名、不说适合不适合」。
 * 教科书雷达的那套家具——五圈同心刻度、放射线、顶点圆点、顶点旁的「维度名 + N/5」——
 * 正是量表的视觉句式；照抄它，图就在替页面说页面明确拒绝说的话。
 *
 * 所以这里只画**一个形状**：
 *   - 不画刻度圈（那是「满分 5 分」的暗示）。只留一圈极淡的参考轮廓，
 *     取中位（0.5），让人一眼看出「哪几维突出、整体偏不偏」——**这正是下面那组
 *     条形列表给不了的信息**，也是这张图唯一的存在理由。
 *   - 不画放射线、不画顶点圆点。
 *   - **canvas 里一个字都不写。** 维度名由 WXML 排在画布四周：canvas 文字不吃页面字阶
 *     令牌、在不同 DPR 上糊、还会被画布边界裁掉。数值全部交给条形列表，
 *     不在这里出现第三遍。
 *   - 顶点之间用平滑闭合曲线（Catmull-Rom 转三次贝塞尔）而不是直折线——
 *     直折线读作「五项得分连线」，圆润轮廓读作「一个形态」。
 *
 * 删掉这些约束会怎样：图退回成胜任力蜘蛛图，和这一页反复声明的「不构成职业指导意见、
 * 不是能力评定」自相矛盾。
 */

const DIM_COUNT_EXPECTED = 5
const MAX_STRENGTH = 5

const RADAR_COLORS = {
  fillInner: 'rgba(35, 84, 230, 0.20)',
  fillOuter: 'rgba(35, 84, 230, 0.04)',
  stroke:    '#2354E6',
  guide:     '#e6ebf3',
}

/**
 * 过一组点画平滑闭合曲线。Catmull-Rom 控制点转三次贝塞尔，张力取 0.5（标准 CR）。
 * 用闭合环取点，首尾自然接上，不留折角。
 */
function smoothClosedPath(ctx, pts) {
  const n = pts.length
  ctx.beginPath()
  ctx.moveTo(pts[0].x, pts[0].y)
  for (let i = 0; i < n; i += 1) {
    const p0 = pts[(i - 1 + n) % n]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % n]
    const p3 = pts[(i + 2) % n]
    // 张力 1/9 而不是标准 Catmull-Rom 的 1/6：/6 在相邻维度落差大时（如 5 → 1）
    // 会让曲线鼓到顶点**外面**、又在凹侧陷到两个顶点**里面**——
    // 曲线超出数据本身，对一张要人读「形状」的图是失真。
    // 收到 1/9 仍然圆润（不会退回直折线那种「五项得分连线」的读法），过冲基本消失。
    ctx.bezierCurveTo(
      p1.x + (p2.x - p0.x) / 9, p1.y + (p2.y - p0.y) / 9,
      p2.x - (p3.x - p1.x) / 9, p2.y - (p3.y - p1.y) / 9,
      p2.x, p2.y,
    )
  }
  ctx.closePath()
}

/** 顶点角度：从正上方开始，顺时针均分。WXML 排标签时必须用同一个算法。 */
function angleOf(i) {
  return -Math.PI / 2 + ((Math.PI * 2) / DIM_COUNT_EXPECTED) * i
}

/**
 * @param {Object} canvas  type="2d" 的 canvas 节点
 * @param {Array}  dims    [{ label, strength }]，长度须为 DIM_COUNT_EXPECTED
 * @param {Object} size    { width, height } 逻辑像素
 */
function paintRadar(canvas, dims, size) {
  const ctx = canvas.getContext('2d')
  const windowInfo = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : { pixelRatio: 1 }
  const ratio = Math.max(1, windowInfo.pixelRatio || 1)
  const w = size.width
  const h = size.height
  canvas.width = Math.round(w * ratio)
  canvas.height = Math.round(h * ratio)
  ctx.scale(ratio, ratio)
  ctx.clearRect(0, 0, w, h)

  const cx = w / 2
  const cy = h / 2
  // 半径可以取到 0.42：标签移出 canvas 之后，不必再为顶点文字让出外圈一整圈。
  // 原实现压到 0.30 就是为了给画布内文字留位置——那是家具在挤占内容。
  const radius = Math.min(w, h) * 0.42

  const ptAt = (i, ratioOfMax) => {
    const a = angleOf(i)
    const r = radius * Math.max(0, Math.min(1, ratioOfMax))
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r }
  }

  // 参考轮廓：一圈，取中位。不是刻度，是「均衡线」——用来看形状偏向哪边。
  const guide = []
  for (let i = 0; i < DIM_COUNT_EXPECTED; i += 1) guide.push(ptAt(i, 0.5))
  smoothClosedPath(ctx, guide)
  ctx.strokeStyle = RADAR_COLORS.guide
  ctx.lineWidth = 1
  ctx.stroke()

  // 数据形状。strength 全为 0 时所有顶点落在圆心，曲线退化成一个点——
  // 这是真实结果的忠实表达，不做「至少给个小五边形」的美化。
  const pts = []
  for (let i = 0; i < DIM_COUNT_EXPECTED; i += 1) {
    const s = dims[i] && typeof dims[i].strength === 'number' ? dims[i].strength : 0
    pts.push(ptAt(i, s / MAX_STRENGTH))
  }

  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
  grad.addColorStop(0, RADAR_COLORS.fillInner)
  grad.addColorStop(1, RADAR_COLORS.fillOuter)

  smoothClosedPath(ctx, pts)
  ctx.fillStyle = grad
  ctx.fill()
  ctx.strokeStyle = RADAR_COLORS.stroke
  ctx.lineWidth = 2
  ctx.lineJoin = 'round'
  ctx.stroke()
}

/**
 * 标签位置。WXML 用绝对定位把维度名排在画布四周，和 paintRadar 共用 angleOf，
 * 保证文字和顶点永远对得上。返回百分比，避免页面再算一次像素。
 */
function labelAnchors() {
  const out = []
  for (let i = 0; i < DIM_COUNT_EXPECTED; i += 1) {
    const a = angleOf(i)
    // 百分比是相对**舞台**的，不是相对形状半径的。
    // 2026-09-03 修正：初版写成 0.5 + cos(a) * 0.62，cos 取到 -0.95 时 leftPct = -9%，
    // 左右两个标签被定位到舞台外面，实拍时「服务支持」只剩一个「持」字。
    // 这两个系数必须让 50 ± 系数 落在 [12, 88] / [8, 92] 内，给四字标签留出半宽。
    out.push({
      leftPct: Math.round((50 + Math.cos(a) * 38) * 10) / 10,
      topPct: Math.round((50 + Math.sin(a) * 42) * 10) / 10,
    })
  }
  return out
}

module.exports = { paintRadar, labelAnchors, RADAR_COLORS, DIM_COUNT_EXPECTED }
