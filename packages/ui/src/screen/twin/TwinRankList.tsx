import { screenCount } from '../ScreenPrimitives'

/**
 * 排行榜：名次 + 标题（一行，放不下省略）+ 类型标签 + 次数，下面一条比例细条。
 * 标题比条形图的左栏长得多（内容标题、来源名称），这里给标题整行宽度。
 */

export interface TwinRankItem {
  key: string
  title: string
  tag?: string
  value: number
}

export function TwinRankList({ items, emptyText }: { items: TwinRankItem[]; emptyText: string }) {
  if (items.length === 0) return <p className="twin-empty">{emptyText}</p>
  let max = 0
  for (const item of items) if (item.value > max) max = item.value
  return (
    <ol className="twin-rank">
      {items.map((item, i) => (
        <li key={item.key}>
          <span className="twin-rank-no">{i + 1}</span>
          <span className="twin-rank-t" title={item.title}>
            {item.title}
          </span>
          {item.tag ? <span className="twin-rank-tag">{item.tag}</span> : <span />}
          <b>{screenCount(item.value)}</b>
          <span className="twin-rank-bar" aria-hidden="true">
            <i style={{ width: `${max > 0 ? (item.value / max) * 100 : 0}%` }} />
          </span>
        </li>
      ))}
    </ol>
  )
}
