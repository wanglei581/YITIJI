// 五维雷达图绘制。
//
// 从 self-explore.js 抽出来的原因：主文件 762 行，越过 CLAUDE.md §8 的
// 「500 行以上新增功能前必须评估拆分」阈值。绘制是天然的接缝——
// 它只依赖画布、维度数据与尺寸，不碰页面状态。
//
// **只画 strength**。它是服务端的纯函数评分（5 题 weight 累加归一化），
// 与 LLM 无关：LLM 的输出类型里没有 strength 字段，降级路径一律
// {...d, note: null} 保留原分。调用方必须先确认每个 strength 都是合法 0..5，
// 否则不要调本函数——宁可不画，也不能补 0（0 是真实分值，不是缺失）。

const RADAR_COLORS = {
  ring: '#e9eef5',        // --line-soft
  ringOuter: '#dfe6ef',   // --line
  spoke: '#f1f4f8',       // --line-faint
  fill: 'rgba(35, 84, 230, 0.16)',
  stroke: '#2354E6',      // --teal
  dot: '#1A3FB8',         // --teal-deep
  label: '#344054',       // --ink-soft
  value: '#1A3FB8',       // --teal-deep
}

const DIM_COUNT_EXPECTED = 5

/**
 * @param {object} canvas wx type="2d" 画布节点
 * @param {Array}  dims   [{ label, strength }]，长度须为 DIM_COUNT_EXPECTED
 * @param {object} size   { width, height } 逻辑像素
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
    // 顶点标注要占掉外圈一圈位置，半径按较短边的 0.30 取，否则左右两个顶点的文字出画布
    const radius = Math.min(w, h) * 0.30
    const step = (Math.PI * 2) / DIM_COUNT_EXPECTED
    const angleOf = (i) => -Math.PI / 2 + step * i

    const ringPath = (r) => {
      ctx.beginPath()
      for (let i = 0; i < DIM_COUNT_EXPECTED; i += 1) {
        const a = angleOf(i)
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
    }

    // 五圈刻度：由内到外 1..5，中心为 0
    ctx.lineWidth = 1
    for (let k = 1; k <= 5; k += 1) {
      ringPath((radius * k) / 5)
      ctx.strokeStyle = k === 5 ? RADAR_COLORS.ringOuter : RADAR_COLORS.ring
      ctx.stroke()
    }

    ctx.strokeStyle = RADAR_COLORS.spoke
    for (let i = 0; i < DIM_COUNT_EXPECTED; i += 1) {
      const a = angleOf(i)
      ctx.beginPath()
      ctx.moveTo(cx, cy)
      ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius)
      ctx.stroke()
    }

    // 数据多边形。strength 全为 0 时顶点都落在圆心，多边形退化成一个点 ——
    // 那就是真实结果的样子，不做「至少给点面积」的美化，否则等于把 0 画成非 0。
    ctx.beginPath()
    dims.forEach((d, i) => {
      const a = angleOf(i)
      const r = (radius * d.strength) / 5
      const x = cx + Math.cos(a) * r
      const y = cy + Math.sin(a) * r
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.closePath()
    ctx.fillStyle = RADAR_COLORS.fill
    ctx.fill()
    ctx.strokeStyle = RADAR_COLORS.stroke
    ctx.lineWidth = 2
    ctx.stroke()

    ctx.fillStyle = RADAR_COLORS.dot
    dims.forEach((d, i) => {
      const a = angleOf(i)
      const r = (radius * d.strength) / 5
      ctx.beginPath()
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3, 0, Math.PI * 2)
      ctx.fill()
    })

    // 顶点标注：维度名 + 强度数值
    ctx.textBaseline = 'middle'
    dims.forEach((d, i) => {
      const a = angleOf(i)
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const ax = cx + cos * (radius + 14)
      const ay = cy + sin * (radius + 14)
      ctx.textAlign = Math.abs(cos) < 0.25 ? 'center' : (cos > 0 ? 'left' : 'right')
      let nameY = ay - 8
      let valueY = ay + 8
      if (sin < -0.5) { nameY = ay - 16; valueY = ay - 1 }
      else if (sin > 0.5) { nameY = ay + 2; valueY = ay + 17 }
      ctx.font = '11px sans-serif'
      ctx.fillStyle = RADAR_COLORS.label
      ctx.fillText(d.label, ax, nameY)
      ctx.font = 'bold 11px sans-serif'
      ctx.fillStyle = RADAR_COLORS.value
      ctx.fillText(`${d.strength}/5`, ax, valueY)
    })
}

module.exports = { paintRadar, RADAR_COLORS, DIM_COUNT_EXPECTED }
