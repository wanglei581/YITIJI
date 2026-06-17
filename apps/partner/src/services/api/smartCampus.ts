import { API_MODE } from './client'
import { partnerMockAdapter } from './partnerMockAdapter'
import { partnerHttpAdapter } from './partnerHttpAdapter'
import type {
  PartnerSmartCampusTerminal,
  SaveSmartCampusConfigPayload,
  TerminalSmartCampusConfigView,
} from './types'

export type {
  PartnerSmartCampusTerminal,
  SaveSmartCampusConfigPayload,
  TerminalSmartCampusConfigView,
}

interface PartnerSmartCampusServiceInterface {
  getSmartCampusTerminals(): Promise<PartnerSmartCampusTerminal[]>
  saveSmartCampusConfig(terminalId: string, payload: SaveSmartCampusConfigPayload): Promise<TerminalSmartCampusConfigView>
}

const adapter: PartnerSmartCampusServiceInterface =
  API_MODE === 'http' ? partnerHttpAdapter : partnerMockAdapter

export const getSmartCampusTerminals = () => adapter.getSmartCampusTerminals()
export const saveSmartCampusConfig = (terminalId: string, payload: SaveSmartCampusConfigPayload) =>
  adapter.saveSmartCampusConfig(terminalId, payload)
