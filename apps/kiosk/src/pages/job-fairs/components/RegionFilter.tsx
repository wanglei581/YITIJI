// ============================================================
// RegionFilter — 招聘会地区级联筛选（省 → 市 → 区）
//
// 用户需求：顶部按省/市/区选择，显示该地区的招聘会。
// 以 chip 行级联呈现（贴近参考图的城市 chip 风格，扩展到三级）：
//   选省 → 出市行；选市且该市有区 → 出区行。
//   未选的层级视为「全部」。
// ============================================================

import { useMemo } from 'react'
import { MapPinIcon } from 'lucide-react'
import { buildRegionTree, type RegionFairLike, type RegionSelection } from '../../../lib/regions'

function ChipRow({
  label,
  options,
  active,
  onPick,
}: {
  label: string
  options: string[]
  active: string | undefined
  onPick: (v: string | undefined) => void
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-8 shrink-0 text-xs font-medium text-gray-400">{label}</span>
      <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
        <button
          onClick={() => onPick(undefined)}
          className={[
            'flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-medium transition-colors',
            !active ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
          ].join(' ')}
        >
          全部
        </button>
        {options.map((o) => (
          <button
            key={o}
            onClick={() => onPick(o)}
            className={[
              'flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-medium transition-colors',
              active === o ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200',
            ].join(' ')}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  )
}

export function RegionFilter({
  fairs,
  value,
  onChange,
}: {
  fairs: RegionFairLike[]
  value: RegionSelection
  onChange: (sel: RegionSelection) => void
}) {
  const tree = useMemo(() => buildRegionTree(fairs), [fairs])

  const provinces = tree.map((p) => p.province)
  const cities = value.province
    ? (tree.find((p) => p.province === value.province)?.cities ?? [])
    : []
  const districts = value.city
    ? (cities.find((c) => c.city === value.city)?.districts ?? [])
    : []

  if (provinces.length === 0) return null

  return (
    <div className="space-y-2 rounded-xl border border-gray-100 bg-white p-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-500">
        <MapPinIcon className="h-3.5 w-3.5 text-primary-500" />
        地区筛选
      </div>
      <ChipRow
        label="省"
        options={provinces}
        active={value.province}
        onPick={(province) => onChange({ province })}
      />
      {value.province && cities.length > 0 && (
        <ChipRow
          label="市"
          options={cities.map((c) => c.city)}
          active={value.city}
          onPick={(city) => onChange({ province: value.province, city })}
        />
      )}
      {value.city && districts.length > 0 && (
        <ChipRow
          label="区"
          options={districts}
          active={value.district}
          onPick={(district) => onChange({ province: value.province, city: value.city, district })}
        />
      )}
    </div>
  )
}
