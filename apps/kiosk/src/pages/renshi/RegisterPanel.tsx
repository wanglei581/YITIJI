import { useNavigate } from 'react-router-dom'
import { PrinterIcon } from 'lucide-react'
import { REGISTER_ITEMS } from './builtinData'

export function RegisterPanel() {
  const navigate = useNavigate()

  return (
    <div className="rq-register">
      <div className="rq-list">
        {REGISTER_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <article key={item.key} className="rq-blk">
              <header className="rq-blk-h">
                <Icon aria-hidden="true" />
                <span><b>{item.title}</b><small>{item.purpose}</small></span>
              </header>
              <p className="rq-srcchip">办理地点 <b>{item.location}</b></p>
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
      <button type="button" className="rq-exit" onClick={() => navigate('/print/upload')}>
        <PrinterIcon aria-hidden="true" />
        <span><b>上传自备材料打印</b><small>把需要复印的材料上传，本机可直接出纸</small></span>
      </button>
    </div>
  )
}
