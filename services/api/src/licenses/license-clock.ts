/**
 * 授权判断用的时钟。会话签发、机构后台写操作、绑定终端、告警、展示都读同一个，
 * 门禁可以注入固定时刻，把「到期当刻」「宽限最后一毫秒」这类边界断言得死死的。
 * 生产里永远是系统时间。
 */
let clock: () => Date = () => new Date()

export function licenseNow(): Date {
  return clock()
}

/** 门禁注入时钟。传 null 恢复系统时间。 */
export function setLicenseClock(next: (() => Date) | null): void {
  clock = next ?? (() => new Date())
}
