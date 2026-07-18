// ============================================================
// FreshmanInsightsPage — 校园大数据（/smart-campus/freshman-insights）
//
// 校园大数据本期严格冻结：需取得学校书面授权 + 数据处理协议、且只接聚合脱敏统计后
// 才会解冻。在此之前本页绝不展示任何统计数字（含示例 / 演示 / 假数据）。
//
// 入口侧：bigdata 子模块开关在后端被强制落 false（smart-campus.service.ts），
// 因此正常路径下首页 / 智慧校园专区都不会出现「校园大数据」入口。
// 本页仅用于「直达 URL 兜底」：任何人手动访问该地址，只能看到“未开放”的真实状态，
// 不会被误导为已上线，也拿不到任何数据。
//
// 合规（compliance-boundary.md §九）：不读写任何学生数据，不在本终端采集任何个人信息，
// 无任何招聘闭环语义。
// ============================================================

import { Button, Card } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'
import { LockIcon, ShieldCheckIcon } from 'lucide-react'
import '../prototype/kiosk-prototype.css'

export function FreshmanInsightsPage() {
  const navigate = useNavigate()

  return (
    <div className="kproto kproto-teal">
      <div className="kproto-shell">
        <div className="kproto-pagehead">
          <button type="button" className="kproto-back" onClick={() => navigate('/smart-campus')}>返回</button>
          <div className="kproto-title">
            <h1>校园大数据</h1>
            <p>迎新报到聚合统计 · 暂未开放</p>
          </div>
          <div className="kproto-aside"><span className="kproto-chip warn">未开放</span></div>
        </div>

        <main className="kproto-content justify-center">
          <Card className="kproto-card accented flex flex-col items-center justify-center gap-5 px-14 py-14 text-center">
            <span className="grid h-[120px] w-[120px] place-items-center rounded-full border border-[var(--kp-line)] bg-[var(--kp-paper)] text-[var(--kp-muted)]">
              <LockIcon className="h-14 w-14" aria-hidden="true" />
            </span>
            <h2 className="font-serif text-[40px] font-black tracking-[2px]">校园大数据暂未开放</h2>
            <p className="max-w-[720px] text-[22px] leading-relaxed text-[var(--kp-muted)]">
              该功能需在取得学校书面授权与数据处理协议、且仅接入聚合脱敏统计后才会开放。开放前本终端不展示任何统计数据，也不采集任何个人信息。
            </p>
            <Button size="lg" onClick={() => navigate('/smart-campus')}>返回智慧校园</Button>
          </Card>

          <section className="kproto-card">
            <div className="kproto-card-head">
              <span className="kproto-icon"><ShieldCheckIcon aria-hidden="true" /></span>
              <div><h2>开放前提</h2><div className="sub">三项条件全部满足后，该模块才会解锁</div></div>
            </div>
            <div className="grid gap-3">
              {([
                { title: '学校书面授权', desc: '由校方出具正式授权文件，明确数据范围与用途' },
                { title: '签署数据处理协议', desc: '与校方签署数据处理协议，约定安全与保存要求' },
                { title: '仅接入聚合脱敏统计', desc: '只接收不含任何个人身份信息的聚合统计结果' },
              ] as const).map((item, index) => (
                <div key={item.title} className="flex min-h-[92px] items-center gap-5 rounded-[14px] border border-[var(--kp-line)] bg-[var(--kp-paper)] px-6 py-4">
                  <span className="grid h-[52px] w-[52px] shrink-0 place-items-center rounded-full bg-[var(--kp-accent-soft)] font-serif text-[25px] font-bold text-[var(--kp-accent-deep)]">{index + 1}</span>
                  <div>
                    <b className="block text-[22px]">{item.title}</b>
                    <span className="mt-1.5 block text-[18px] leading-snug text-[var(--kp-muted)]">{item.desc}</span>
                  </div>
                  <span className="ml-auto shrink-0 rounded-full border border-dashed border-[var(--kp-line)] bg-[var(--kp-surface)] px-4 py-1.5 text-[17px] text-[var(--kp-muted)]">待完成</span>
                </div>
              ))}
            </div>
          </section>

          <div className="kproto-auth">
            <ShieldCheckIcon aria-hidden="true" />
            <p>合规边界：校园大数据若上线，仅展示聚合统计，绝不含任何个人身份信息，也不在本终端采集任何个人信息。</p>
          </div>
        </main>
      </div>
    </div>
  )
}
