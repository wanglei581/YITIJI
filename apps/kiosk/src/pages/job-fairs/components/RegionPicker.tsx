// ============================================================
// RegionPicker — 全国「省 / 市 / 区」地区筛选按钮（下钻选择）
//
// 用户需求：地区筛选要覆盖中国所有省市区，都可选。
// 数据来自 china-division（全国行政区划）。chip 行无法承载 2800+ 区县，
// 故做成「按钮 → 弹层下钻」：省 → 市 → 区，每级可「整个省/整个市」提前停。
//
// 2026-09-20 随 /job-fairs 迁入青序流光：配色与触控尺寸改用 qx / dw 令牌
// （原来的 primary-*/neutral-* 是暖褐旧壳的颜色，落在青序页上两套色系会打架）。
// 顺带把选项格的 min-h-[44px] 提到 --qx-tap-min（48px），补上 CLAUDE.md §9 的下限。
// 下钻逻辑一字未改。
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
    <div className="qxfw-optgrid">
      {options.map((o) => (
        <button key={o} type="button" className="qxfw-opt" onClick={() => onPick(o)}>
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
      {/*
        清除是独立动作，不能和「打开选择器」共用一个点击区 —— 触屏上误触代价太大。
        2026-09-20 修正实现方式：原来把清除做成 <button> **内部**的 role="button" span。
        嵌套可交互元素在 HTML 里是非法的，读屏软件只看得见外层那一个控件，
        而 stopPropagation 只挡冒泡、挡不住「两个控件叠在一起」这件事本身。
        改成兄弟按钮：两个真 <button>，各自 ≥48px 触控区，读屏也能分别念出来。
      */}
      <span className="qxfw-chipgrp">
        <button
          type="button"
          onClick={openPicker}
          aria-pressed={hasSelection}
          className={`dw-chip${hasSelection ? ' on' : ''}`}
        >
          <MapPinIcon size={20} aria-hidden />
          <span>{regionLabel(value)}</span>
          {hasSelection ? null : <ChevronRightIcon size={20} aria-hidden />}
        </button>
        {hasSelection ? (
          <button
            type="button"
            className="qxfw-chip-clear"
            aria-label="清除地区筛选"
            onClick={() => onChange({})}
          >
            <XIcon size={20} aria-hidden />
          </button>
        ) : null}
      </span>

      {open && (
        <div className="qxfw-sheet" role="dialog" aria-modal="true" aria-label="选择地区" onClick={() => setOpen(false)}>
          <div className="qxfw-sheet-panel" onClick={(e) => e.stopPropagation()}>
            <div className="qxfw-sheet-head">
              <p>选择地区</p>
              <button type="button" className="qxfw-overlay-close" onClick={() => setOpen(false)} aria-label="关闭">
                <XIcon size={26} aria-hidden />
              </button>
            </div>

            <div className="qxfw-sheet-crumbs">
              <button type="button" aria-current={stage === 'province'} onClick={() => setStage('province')}>
                省/直辖市
              </button>
              {(stage === 'city' || stage === 'district') && draftProvince && (
                <>
                  <ChevronRightIcon size={18} aria-hidden />
                  <button
                    type="button"
                    aria-current={stage === 'city'}
                    onClick={() => !isMunicipality(draftProvince) && setStage('city')}
                  >
                    {draftProvince}
                  </button>
                </>
              )}
              {stage === 'district' && draftCity && draftCity !== '市辖区' && (
                <>
                  <ChevronRightIcon size={18} aria-hidden />
                  <span>{draftCity}</span>
                </>
              )}
            </div>

            <div className="dw-fgrp">
              <div className="fc">
                {stage !== 'province' && (
                  <button
                    type="button"
                    className="dw-chip"
                    onClick={() => setStage(stage === 'district' && !isMunicipality(draftProvince) ? 'city' : 'province')}
                  >
                    <ChevronLeftIcon size={20} aria-hidden />返回
                  </button>
                )}
                {stage === 'province' && (
                  <button type="button" className="dw-chip" onClick={() => apply({})}>全部地区</button>
                )}
                {stage === 'city' && (
                  <button type="button" className="dw-chip ok" onClick={() => apply({ province: draftProvince })}>
                    整个{draftProvince}
                  </button>
                )}
                {stage === 'district' && (
                  <button
                    type="button"
                    className="dw-chip ok"
                    onClick={() => apply({ province: draftProvince, city: isMunicipality(draftProvince) ? undefined : draftCity })}
                  >
                    {isMunicipality(draftProvince) ? `整个${draftProvince}` : `整个${draftCity}`}
                  </button>
                )}
              </div>
            </div>

            <div className="qxfw-sheet-opts">
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
