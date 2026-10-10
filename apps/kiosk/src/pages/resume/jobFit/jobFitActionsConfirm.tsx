// 行动清单短故障屏的确认行。稿用「你能确认的事」把放不满的屏排实，
// 不把区块拉成空盒，也不把未发生的事写成已完成。
import type { ReactNode } from 'react'
import { Sec, Verdict, Why } from './jobFitQxKit'

function confirm(items: Array<{ head: string; title: string; desc: string }>): ReactNode {
  return (
    <Sec title="你能确认的事" hint="不猜测具体故障">
      <Why items={items} />
    </Sec>
  )
}

export function actionsConfirm(kind: 'ai-down' | 'failed' | 'print-failed' | 'session-ended'): ReactNode {
  if (kind === 'print-failed') {
    return confirm([
      { head: '可能原因', title: '文件生成未返回', desc: '生成文件的服务这次没有给出结果，本页不猜测具体原因。' },
      { head: '你能确认', title: '清单没有丢', desc: '行动清单本身仍可查看，重试不需要重新做这次对照。' },
      { head: '你能确认', title: '没有进入打印确认', desc: '没有取件码，也还没有进入打印确认。' },
      { head: '你能确认', title: '打印机没收到任务', desc: '打印机没有收到任何任务，纸张与耗材没有被占用。' },
      { head: '边界', title: '仍不提供给企业', desc: '清单内容不会提供给企业或第三方。' },
    ])
  }
  if (kind === 'ai-down') {
    return confirm([
      { head: '状态', title: '不做假降级', desc: '不会用模板清单或上一次的建议冒充这一次的结果。' },
      { head: '恢复', title: '不承诺恢复时间', desc: '这次没有给出可用时间，本页也不写「稍后自动恢复」。' },
      { head: '材料', title: '简历原文仍可打印', desc: '差距清单读不到，不影响你打印自己已有的简历。' },
      { head: '编辑', title: '简历优化照常能改', desc: '优化编辑区不经过这条 AI，现在也能改。' },
      { head: '边界', title: '仍不提供给企业', desc: '无论服务是否可用，简历都不会提供给企业或第三方。' },
    ])
  }
  if (kind === 'failed') {
    return confirm([
      { head: '这次结果', title: '没有可执行的清单', desc: '本次没有返回可执行的差距项，本页不补造行动项。' },
      { head: '你能确认', title: '可以重新分析', desc: '回对照页可以再分析一次，或换一个更具体的目标。' },
      { head: '你能确认', title: '要求太笼统时会抽不出项', desc: '岗位要求写得很笼统时，通常就没有可执行的差距项。' },
      { head: '你能确认', title: '简历仍可自己改', desc: '没有清单也不影响你按目标自己调整简历。' },
      { head: '边界', title: '仍不提供给企业', desc: '这次没有返回的内容不会提供给企业或第三方。' },
    ])
  }
  return confirm([
    { head: '你能确认', title: '这次使用已经变化', desc: '退出、过期或清场之后，刚才的清单不再属于现在站在屏幕前的这一位。' },
    { head: '你能确认', title: '差距与建议已隐藏', desc: '不再显示刚才的差距清单与改写建议。' },
    { head: '你能确认', title: '不再继续打印', desc: '不再用刚才的登录凭证读取或生成打印版。' },
    { head: '你能确认', title: '在途结果已停', desc: '还在路上的返回结果不会再进入打印确认。' },
    { head: '接下来', title: '要继续就重新准备', desc: '需要继续时，重新登录或重新准备简历材料。' },
  ])
}

export function actionsSessionVerdict(): ReactNode {
  return (
    <Sec title="这次请求的结果" hint="只写已经确认的事实">
      <Verdict items={[
        { tone: 'warn', label: '这次办理', value: '已结束' },
        { tone: 'bad', label: '刚才的清单', value: '已隐藏' },
        { tone: 'warn', label: '打印', value: '不再继续' },
      ]} />
    </Sec>
  )
}
