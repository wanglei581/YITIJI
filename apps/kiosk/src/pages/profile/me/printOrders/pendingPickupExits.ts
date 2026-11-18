/**
 * 有待取单、还没有打印任务时，待取单块下面接两张出路卡。
 * 第二张与「已有打印任务」时一样，去「我的文档」，不再和上面那行重复「输到机码取件」。
 * 小程序未发布时第二张仍是「看看我的文档」。
 */

export interface PendingPickupExitCard {
  title: string
  desc: string
  to: '/print-scan' | '/print/pickup-claim' | '/me/documents'
  art: 'usb' | 'phone' | 'stack'
  artWidth: number
  /** 去打印受执照收口。去我的文档、看看我的文档不受。 */
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
        title: '去我的文档',
        desc: '从已保存的文件里再选一份',
        to: '/me/documents',
        art: 'stack',
        artWidth: 110,
        locked: false,
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
