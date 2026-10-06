import type { ReactNode } from 'react'

export type SourceHeroKey =
  | 'source' | 'usb' | 'phone' | 'uploading' | 'upload-failed' | 'upload-unknown'
  | 'staged' | 'scan-ready' | 'target' | 'target-context' | 'target-profile' | 'target-industry'

/** 稿 21 `hero(...)`：任务头按画面换，解析页不走这里。 */
export function heroCopy(key: SourceHeroKey, intent: 'diagnose' | 'optimize'): {
  ask: ReactNode
  doing: ReactNode
  flag: string
  warn: boolean
} {
  const verb = intent === 'optimize' ? '优化' : '诊断'
  if (key === 'usb') return { ask: <>从 U 盘里<em>挑一份简历</em>。</>, doing: '插好后文件列表会自动出现；只列 10MB 以内的 PDF / JPG / PNG，要用哪一份由你来点。', flag: 'U 盘', warn: false }
  if (key === 'phone') return { ask: <>用手机<em>扫码上传</em>。</>, doing: '在二维码有效期内上传，回到这里确认要使用的文件。', flag: '手机扫码', warn: false }
  if (key === 'uploading') return { ask: <>正在把这一份<em>上传</em>。</>, doing: '请稍候，上传结果会在这里显示。离开页面不会撤回已经开始的上传。', flag: '上传中', warn: false }
  if (key === 'upload-failed') return { ask: <>这一份<em>没能送进来</em>。</>, doing: '原件还在你手里，可以重试，或者换一种来源。', flag: '未送达', warn: true }
  if (key === 'upload-unknown') return { ask: <>这一份<em>暂时无法确认有没有传上去</em>。</>, doing: '可能已经传上去了，也可能没有。本页不会自动再传一次，也不会拿之前那份文件继续。', flag: '结果未知', warn: true }
  if (key === 'target') return {
    ask: <>告诉我<em>看哪里</em>，我按这个排顺序。</>,
    doing: <>报告固定输出 <strong>6 个维度</strong>；这里选的只影响<strong>建议关注顺序</strong>，不裁剪结果。</>,
    flag: '全部点选',
    warn: false,
  }
  if (key === 'target-context' || key === 'target-profile') {
    if (intent === 'optimize') {
      return {
        ask: <>先诊断，再按<em>目标岗位</em>优化表达。</>,
        doing: <>这一页只设方向：<strong>岗位 / 行业 / 经验 / 场景 / 专业 / 学历</strong>。优化只重写<strong>已有内容</strong>的说法，<strong>不编经历</strong>，也<strong>不承诺匹配率或录用结果</strong>。</>,
        flag: '先诊断再优化',
        warn: false,
      }
    }
    return {
      ask: <>你想去<em>哪个方向</em>？</>,
      doing: <>六项在这一页点完：<strong>岗位 / 行业 / 经验 / 场景 / 专业 / 学历</strong>，全是点选，都可以不填。</>,
      flag: '一页点完',
      warn: false,
    }
  }
  if (key === 'target-industry') return {
    ask: <>行业按 <em>GB/T 4754-2017</em> 门类选。</>,
    doing: <>共 <strong>20 个门类</strong>，点一个就回上一步；更细的行业以后接分级字典再选。</>,
    flag: '20 门类',
    warn: false,
  }
  if (key === 'staged' || key === 'scan-ready') return {
    ask: <>确认一下，<em>就开始{verb}</em>。</>,
    doing: <>确认文件与重点，获得<strong>简历诊断报告</strong>，再逐条选择改法。</>,
    flag: '待你确认',
    warn: false,
  }
  return {
    ask: <>简历这趟，先<em>把文件交给我</em>。</>,
    doing: <>选一种来源把简历送进来，方向和背景都<strong>点选完成，不用打字</strong>。</>,
    flag: '原件只读不改',
    warn: false,
  }
}
