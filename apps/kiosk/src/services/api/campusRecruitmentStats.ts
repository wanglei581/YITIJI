import {
  CAMPUS_RECRUITMENT_STATS_NOTES,
  CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
  type ApiResponse,
  type CampusRecruitmentStatsData,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { getTerminalId } from './screensaver'

const EMPTY_STATS: CampusRecruitmentStatsData = {
  groups: [],
  reason: 'no_published_campus_records',
  generatedAt: '2099-01-01T00:00:00.000Z',
  truncated: false,
  scanLimit: CAMPUS_RECRUITMENT_STATS_SCAN_LIMIT,
  notes: CAMPUS_RECRUITMENT_STATS_NOTES,
}

export async function getCampusRecruitmentStats(): Promise<CampusRecruitmentStatsData> {
  if (API_MODE !== 'http') return EMPTY_STATS

  const url = new URL(`${API_BASE_URL}/kiosk/campus/recruitment-stats`, window.location.origin)
  const terminalId = getTerminalId()
  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      ...(terminalId ? { 'x-terminal-id': terminalId } : {}),
    },
    credentials: 'include',
  })

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // keep defaults
    }
    throw new ApiHttpError(code, message, res.status)
  }

  const body = (await res.json()) as ApiResponse<CampusRecruitmentStatsData>
  if (!body?.data || !Array.isArray(body.data.groups)) {
    throw new ApiHttpError('UNKNOWN_ERROR', '校园招聘统计响应缺少 groups', res.status)
  }
  return body.data
}
