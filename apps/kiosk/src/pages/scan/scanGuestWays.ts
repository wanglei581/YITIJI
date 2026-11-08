import { whenMiniapp, type PublicSupportContact } from '../../copy/unattendedCopy'

/**
 * 游客扫描件「带走的办法」：先说一句不进「我的文档」，再列三条出路。
 * 面板扫描结果页（ScanResultExitRow）和屏上扫描完成屏（ScanDeviceDonePage）共用这一份，简历、证件、普通文档一样。
 *
 * 依据：设计窗口 2026-11-08 答复，游客「扫码带走」不做（照 10/12 定项），屏上要把三条出路说清楚。
 * 第三条后半句只在小程序已发布时出现（whenMiniapp）：没发布就不说手机上能看到。
 * 这里不放登录按钮：游客一登录，这次扫描就会被登录那一步清掉；「先登录」在扫之前的「怎么扫」那一屏。
 */
export const SCAN_GUEST_WAYS_LEAD = '未登录扫描件不会进入「我的文档」。带走的办法：'

export interface ScanGuestWay {
  key: 'print' | 'usb' | 'documents'
  text: string
}

export function scanGuestWays(contact: PublicSupportContact | null | undefined): readonly ScanGuestWay[] {
  return [
    { key: 'print', text: '当场打印：请在本次操作内完成打印或识别。' },
    { key: 'usb', text: '存 U 盘：在打印机面板上选「扫描到 U 盘」，这台机器暂未开通。' },
    { key: 'documents', text: `存进「我的文档」：下次先扫码登录再扫${whenMiniapp(contact, '，手机小程序里也能看到')}。` },
  ]
}
