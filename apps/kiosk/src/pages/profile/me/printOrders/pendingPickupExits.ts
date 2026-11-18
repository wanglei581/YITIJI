/**
 * 有待取单、还没有打印任务时，待取单块下面接「没有打印订单」空态的两张出路卡。
 * 小程序已发布才给「输到机码取件」；没发布时第二张与空态一样，去「我的文档」。
 */

export interface PendingPickupExitCard {
  title: string
  desc: string
  to: '/print-scan' | '/print/pickup-claim' | '/me/documents'
  art: 'usb' | 'phone' | 'stack'
  artWidth: number
  /** 与空态一致：去打印、输到机码取件受执照收口；看看我的文档不受。 */
  locked: boolean
}

export function pendingPickupExitCards(input: {
  printTaskCount: number
  presence: 'off' | 'loading' | 'hidden' | 'rows' | 'error'
  miniOn: boolean
}): PendingPickupExitCard[] {
  if (input.printTaskCount !== 0 || input.presence !== 'rows') return []
  const printCard: PendingPickupExitCard = {
    title: '去打印',
    desc: 'U 盘、手机或扫描都可以',
    to: '/print-scan',
    art: 'usb',
    artWidth: 120,
    locked: true,
  }
  const second: PendingPickupExitCard = input.miniOn
    ? {
        title: '输到机码取件',
        desc: '手机上下的到店单，到机器上输入到机码',
        to: '/print/pickup-claim',
        art: 'phone',
        artWidth: 96,
        locked: true,
      }
    : {
        title: '看看我的文档',
        desc: '选一份已保存的文件再打',
        to: '/me/documents',
        art: 'stack',
        artWidth: 120,
        locked: false,
      }
  return [printCard, second]
}
