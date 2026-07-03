import { MapPinIcon } from 'lucide-react'

// 高德静态地图 key（生产/合规优先）。未配置则回退 OSM 嵌入（演示用，无 key）。
const AMAP_KEY = (import.meta.env as Record<string, string | undefined>).VITE_AMAP_KEY

/**
 * 场馆地图块：优先用机构提供的静态导览图；否则用经纬度出高德静态图（配 key）
 * 或 OSM 嵌入（无 key 演示）；都没有则占位提示扫码在手机查看。
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
  const cls = 'h-full w-full'
  if (mapImageUrl) {
    return <img src={mapImageUrl} alt={`${venue}位置导览图`} className={`${cls} object-cover`} />
  }
  if (lat != null && lng != null) {
    if (AMAP_KEY) {
      const src = `https://restapi.amap.com/v3/staticmap?location=${lng},${lat}&zoom=15&size=750*400&scale=2&markers=mid,,A:${lng},${lat}&key=${AMAP_KEY}`
      return <img src={src} alt={`${venue}地图`} className={`${cls} object-cover`} />
    }
    const d = 0.012
    const bbox = `${(lng - d).toFixed(5)},${(lat - d * 0.62).toFixed(5)},${(lng + d).toFixed(5)},${(lat + d * 0.62).toFixed(5)}`
    const src = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`
    return <iframe src={src} title={`${venue}位置地图`} className={`${cls} border-0`} loading="lazy" />
  }
  return (
    <div className={`${cls} flex flex-col items-center justify-center gap-1.5 bg-neutral-50 text-neutral-400`}>
      <MapPinIcon className="h-7 w-7" />
      <span className="text-xs">暂无地图，可扫码在手机查看</span>
    </div>
  )
}
