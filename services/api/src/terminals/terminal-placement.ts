import { BadRequestException } from '@nestjs/common'
import { cleanNullable } from './terminal-utils'

/** 所在区面向领导展示，限 20 个字（按 Unicode 码位，不是 UTF-16 码元）。 */
export const TERMINAL_AREA_LABEL_MAX_CHARS = 20

/**
 * 中国陆地与南海诸岛的外包矩形（含端点）。
 * 南约 3.86°N、北约 53.55°N、西约 73.66°E、东约 135.05°E。
 * 不接受 0,0 这类明显落在国外的坐标。
 */
export const CHINA_LAT_MIN = 3.86
export const CHINA_LAT_MAX = 53.55
export const CHINA_LNG_MIN = 73.66
export const CHINA_LNG_MAX = 135.05

const GEO_MESSAGE = '经纬度须同时填写且位于中国范围内，或同时清空'

export interface TerminalPlacementInput {
  areaLabel?: string | null
  geoLat?: number | null
  geoLng?: number | null
}

export interface TerminalPlacementPatch {
  areaLabel?: string | null
  geoLat?: number | null
  geoLng?: number | null
}

function rejectGeo(): never {
  throw new BadRequestException({
    error: { code: 'TERMINAL_GEO_INVALID', message: GEO_MESSAGE },
  })
}

function normalizeCoord(value: number | null | undefined, min: number, max: number): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) rejectGeo()
  return value
}

/**
 * 只返回本次请求真正要写的列。缺省字段不出现在补丁里，避免档案局部更新把坐标抹掉。
 * 经纬度必须成对出现：都空=清空，都在中国范围内=写入，只填一个或越界=拒绝。
 */
function isProvided(input: object, key: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(input, key)) return false
  return (input as Record<string, unknown>)[key] !== undefined
}

export function terminalPlacementPatch(input: TerminalPlacementInput): TerminalPlacementPatch {
  const patch: TerminalPlacementPatch = {}
  if (isProvided(input, 'areaLabel')) {
    const cleaned = cleanNullable(input.areaLabel)
    if (typeof cleaned === 'string' && Array.from(cleaned).length > TERMINAL_AREA_LABEL_MAX_CHARS) {
      throw new BadRequestException({
        error: { code: 'TERMINAL_AREA_LABEL_INVALID', message: '所在区不能超过 20 个字' },
      })
    }
    patch.areaLabel = cleaned ?? null
  }
  const hasLat = isProvided(input, 'geoLat')
  const hasLng = isProvided(input, 'geoLng')
  if (!hasLat && !hasLng) return patch
  if (!hasLat || !hasLng) rejectGeo()
  const geoLat = normalizeCoord(input.geoLat, CHINA_LAT_MIN, CHINA_LAT_MAX)
  const geoLng = normalizeCoord(input.geoLng, CHINA_LNG_MIN, CHINA_LNG_MAX)
  if ((geoLat === null) !== (geoLng === null)) rejectGeo()
  patch.geoLat = geoLat
  patch.geoLng = geoLng
  return patch
}
