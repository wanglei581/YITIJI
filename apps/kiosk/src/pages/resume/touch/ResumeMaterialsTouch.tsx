// 求职材料页用到的两个共享触屏件的薄转手：页面只从这里取，这样共享件的路径只在一个地方出现。
export { QxTouchTile } from '../../../components/qingxu/touch/QxTouchTile'

export function QxTouchSection({ title, hint }: { title: string; hint?: string }) {
  return <div className="qxt-sec">{title}{hint ? <small>{hint}</small> : null}</div>
}
