'use strict'

// 只平移「现在」：零参 new Date()、Date()、Date.now()。
// 带参数的构造（解析 ISO、毫秒、年月日）交给真实 Date，避免二次偏移。
// Redis TTL、setTimeout、process.hrtime、PostgreSQL now() 都不经过这里。
const offset = Number(process.env.WALK_CLOCK_OFFSET_MS ?? '0')
if (!Number.isFinite(offset)) {
  throw new Error('WALK_CLOCK_OFFSET_MS 必须是有限数字（毫秒；负值表示回到过去）')
}

const RealDate = Date
if (offset !== 0) {
  function ShiftedDate(...args) {
    const shifted = args.length === 0
      ? new RealDate(RealDate.now() + offset)
      : new RealDate(...args)
    if (new.target) return shifted
    return shifted.toString()
  }
  Object.setPrototypeOf(ShiftedDate, RealDate)
  ShiftedDate.prototype = RealDate.prototype
  ShiftedDate.now = function now() {
    return RealDate.now() + offset
  }
  ShiftedDate.parse = RealDate.parse.bind(RealDate)
  ShiftedDate.UTC = RealDate.UTC.bind(RealDate)
  Object.defineProperty(ShiftedDate, 'name', { value: 'Date' })
  globalThis.Date = ShiftedDate
  process.stderr.write(
    `[clock-shift] offsetMs=${offset} shifted=${new Date().toISOString()} real=${new RealDate().toISOString()}\n`,
  )
} else {
  process.stderr.write('[clock-shift] WALK_CLOCK_OFFSET_MS 未设置或为 0，不平移时钟\n')
}
