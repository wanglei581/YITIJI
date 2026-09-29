import { REGISTER_ITEMS } from './builtinData'

export function RegisterPanel() {
  return (
    <div className="rq-register">
      <div className="rq-list">
        {REGISTER_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.key} className="rq-blk">
              {/* 稿 48 就业登记：标题与用途同一行，办理地点是一行「标签 · 值」。 */}
              <header className="rq-blk-h rq-blk-h-inline">
                <Icon aria-hidden="true" />
                <span><b>{item.title}</b><small>{item.purpose}</small></span>
              </header>
              <p className="rq-kv"><span>办理地点</span><b>{item.location}</b></p>
              <section className="rq-dsec rq-dsec-cols">
                <p className="rq-dsec-h">所需材料</p>
                <ul>
                  {item.materials.map((material) => (
                    <li key={material}><span>{material}</span></li>
                  ))}
                </ul>
              </section>
            </article>
          )
        })}
      </div>
      <p className="rq-note">本机暂未配置线上入口，办理方式以当地发布渠道为准。不代办，只提供材料清单与打印。</p>
      <p className="rq-note rq-note-warn">证件照本机不能现场拍摄，请自带电子照或到照相馆办理。</p>
    </div>
  )
}
