import { servicePhoneLine, type PublicSupportContact } from '../../../../copy/unattendedCopy'

/** 失败指引三格。前两格按页面区分；第三格的号码逻辑只写在这里。 */
export type MeErrorGuideKind = 'records' | 'notifications'

const PHONE_PREFIX = '拨打服务电话 '

function head(kind: MeErrorGuideKind): [string, string, string][] {
  if (kind === 'notifications') {
    return [
      ['数据', '已有消息不受影响', '这次加载失败不会删除任何消息'],
      ['先试这个', '检查网络后重试', '重试不会重复标记已读'],
    ]
  }
  return [
    ['数据', '已保存内容不受影响', '这次加载失败不会删除任何记录'],
    ['先试这个', '检查网络后重试', '重试不会重复创建记录'],
  ]
}

/**
 * 第三格：有号码时标题「仍不行」、粗体「拨打服务电话」、小字是号码和服务时间。
 * 没号码时粗体改成「联系我们」，小字仍是《隐私政策》里的联系方式。
 * 文案审查（C1-6）：大字说打电话、小字却给不出号码；两页原先各写一遍前缀剥离。
 */
export function meErrorGuide(kind: MeErrorGuideKind, contact: PublicSupportContact): [string, string, string][] {
  const line = servicePhoneLine(contact)
  const third: [string, string, string] = line.startsWith(PHONE_PREFIX)
    ? ['仍不行', '拨打服务电话', line.slice(PHONE_PREFIX.length)]
    : ['仍不行', '联系我们', line]
  return [...head(kind), third]
}
