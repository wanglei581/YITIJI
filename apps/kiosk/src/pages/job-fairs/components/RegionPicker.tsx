// ============================================================
// RegionPicker — 全国「省 / 市 / 区」地区筛选按钮（下钻选择）
//
// 用户需求：地区筛选要覆盖中国所有省市区，都可选。
// 数据来自 china-division（全国行政区划）。chip 行无法承载 2800+ 区县，
// 故做成「按钮 → 弹层下钻」：省 → 市 → 区，每级可「整个省/整个市」提前停。
// ============================================================

import { useState } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, MapPinIcon, XIcon } from 'lucide-react'
import {
  PROVINCES,
  citiesOf,
  districtsOf,
  isMunicipality,
  regionLabel,
  type RegionSelection,
} from '../../../lib/regions'

type Stage = 'province' | 'city' | 'district'

function OptionGrid({ options, onPick }: { options: string[]; onPick: (v: string) => void }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {options.map((o) => (
        <button
          key={o}
          onClick={() => onPick(o)}
          className="flex min-h-[44px] items-center justify-center rounded-lg bg-neutral-50 px-2 text-center text-sm text-neutral-700 transition-colors hover:bg-primary-50 hover:text-primary-700 active:bg-primary-100"
        >
          {o}
        </button>
      ))}
    </div>
  )
}

export function RegionPicker({
  value,
  onChange,
}: {
  value: RegionSelection
  onChange: (sel: RegionSelection) => void
}) {
  const [open, setOpen] = useState(false)
  const [stage, setStage] = useState<Stage>('province')
  const [draftProvince, setDraftProvince] = useState<string>('')
  const [draftCity, setDraftCity] = useState<string>('')

  const hasSelection = !!(value.province || value.city || value.district)

  const openPicker = () => {
    setStage('province')
    setDraftProvince('')
    setDraftCity('')
    setOpen(true)
  }
  const apply = (sel: RegionSelection) => {
    onChange(sel)
    setOpen(false)
  }
  const pickProvince = (province: string) => {
    setDraftProvince(province)
    if (isMunicipality(province)) {
      setDraftCity('市辖区')
      setStage('district')
    } else {
      setStage('city')
    }
  }
  const pickCity = (city: string) => {
    setDraftCity(city)
    setStage('district')
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className={[
          'flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
          hasSelection ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200',
        ].join(' ')}
      >
        <MapPinIcon className="h-4 w-4" />
        <span className="max-w-[7rem] truncate">{regionLabel(value)}</span>
        {hasSelection ? (
          <XIcon
            className="h-4 w-4 opacity-80"
            onClick={(e) => { e.stopPropagation(); onChange({}) }}
          />
        ) : (
          <ChevronRightIcon className="h-4 w-4 opacity-70" />
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setOpen(false)}>
          <div
            className="flex max-h-[78vh] w-full flex-col rounded-t-2xl bg-white p-5 shadow-xl sm:w-[28rem] sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div className="flex items-center justify-between">
              <p className="text-base font-semibold text-neutral-800">选择地区</p>
              <button onClick={() => setOpen(false)} className="rounded-full p-1 text-neutral-400 hover:bg-neutral-100" aria-label="关闭">
                <XIcon className="h-5 w-5" />
              </button>
            </div>

            {/* 面包屑 */}
            <div className="mt-2 flex flex-wrap items-center gap-1 text-sm">
              <button onClick={() => setStage('province')} className={stage === 'province' ? 'font-semibold text-primary-600' : 'text-neutral-500'}>
                省/直辖市
              </button>
              {(stage === 'city' || stage === 'district') && draftProvince && (
                <>
                  <ChevronRightIcon className="h-3.5 w-3.5 text-neutral-300" />
                  <button
                    onClick={() => !isMunicipality(draftProvince) && setStage('city')}
                    className={stage === 'city' ? 'font-semibold text-primary-600' : 'text-neutral-500'}
                  >
                    {draftProvince}
                  </button>
                </>
              )}
              {stage === 'district' && draftCity && draftCity !== '市辖区' && (
                <>
                  <ChevronRightIcon className="h-3.5 w-3.5 text-neutral-300" />
                  <span className="font-semibold text-primary-600">{draftCity}</span>
                </>
              )}
            </div>

            {/* 顶部快捷：清除 / 整个省 / 整个市 + 返回 */}
            <div className="mt-3 flex items-center gap-2">
              {stage !== 'province' && (
                <button
                  onClick={() => setStage(stage === 'district' && !isMunicipality(draftProvince) ? 'city' : 'province')}
                  className="flex items-center gap-0.5 rounded-lg bg-neutral-100 px-2.5 py-1.5 text-sm text-neutral-600"
                >
                  <ChevronLeftIcon className="h-4 w-4" />返回
                </button>
              )}
              {stage === 'province' && (
                <button onClick={() => apply({})} className="rounded-lg bg-neutral-100 px-3 py-1.5 text-sm font-medium text-neutral-600">
                  全部地区
                </button>
              )}
              {stage === 'city' && (
                <button onClick={() => apply({ province: draftProvince })} className="rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700">
                  整个{draftProvince}
                </button>
              )}
              {stage === 'district' && (
                <button
                  onClick={() => apply({ province: draftProvince, city: isMunicipality(draftProvince) ? undefined : draftCity })}
                  className="rounded-lg bg-primary-50 px-3 py-1.5 text-sm font-medium text-primary-700"
                >
                  {isMunicipality(draftProvince) ? `整个${draftProvince}` : `整个${draftCity}`}
                </button>
              )}
            </div>

            {/* 选项区 */}
            <div className="mt-3 flex-1 overflow-y-auto pb-2">
              {stage === 'province' && <OptionGrid options={PROVINCES} onPick={pickProvince} />}
              {stage === 'city' && <OptionGrid options={citiesOf(draftProvince)} onPick={pickCity} />}
              {stage === 'district' && (
                <OptionGrid
                  options={districtsOf(draftProvince, draftCity)}
                  onPick={(district) =>
                    apply({
                      province: draftProvince,
                      city: isMunicipality(draftProvince) ? undefined : draftCity,
                      district,
                    })
                  }
                />
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
