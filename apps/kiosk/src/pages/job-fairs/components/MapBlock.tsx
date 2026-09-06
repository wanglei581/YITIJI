import { MapPinIcon } from 'lucide-react'

const AMAP_KEY = (import.meta.env as Record<string, string | undefined>).VITE_AMAP_KEY
const MAP_UNAVAILABLE_COPY = '暂无地图，请以场馆地址为准'

/**
 * 场馆地图块：优先用机构提供的静态导览图；有高德 key 才用经纬度出静态图。
 * 无 key 时不得嵌 OSM iframe（招聘会坐标不得外发境外，内网也会空白）。
 */
export function MapBlock({
  lat,
  lng,
  mapImageUrl,
  venue,
}: {
  lat?: number
  lng?: number
  mapImageUrl?: string
  venue: string
}) {
  const cls = 'h-full min-h-[15rem] w-full'
  if (mapImageUrl) {
    return <img src={mapImageUrl} alt={`${venue}位置导览图`} className={`${cls} object-cover`} />
  }
  if (lat != null && lng != null && AMAP_KEY) {
    const src = `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=15&size=750*400&scale=2&markers=mid,,A:${lng},${lat}&key=${AMAP_KEY}`
    return <img src={src} alt={`${venue}地图`} className={`${cls} object-cover`} />
  }
  return (
    <div
      className={`${cls} flex flex-col items-center justify-center gap-1.5 bg-neutral-50 text-neutral-400`}
      data-map-fallback="no-amap"
    >
      <MapPinIcon className="h-7 w-7" />
      <span className="text-xs">{MAP_UNAVAILABLE_COPY}</span>
    </div>
  )
}
