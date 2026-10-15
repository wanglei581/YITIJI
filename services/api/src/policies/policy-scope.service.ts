import { Injectable, Optional } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { TerminalSessionService } from '../terminals/terminal-session.service'
import { kioskJobBoardTerminalRef, type KioskJobBoardRequest } from '../terminals/kiosk-job-board.service'
import { policyScopeMode, type PolicyPublicScope } from './policy-public-visibility'

/** 公开政策相关接口共用的、已验明身份的终端机构解析。 */
@Injectable()
export class PolicyScopeService {
  constructor(
    @Optional() private readonly terminalSessions?: TerminalSessionService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async resolve(req?: KioskJobBoardRequest | { headers?: Record<string, string | string[] | undefined> }): Promise<PolicyPublicScope> {
    if (policyScopeMode() === 'all') return { mode: 'all' }
    const ref = kioskJobBoardTerminalRef(req ?? {})
    const terminalId = ref
    const token = req?.headers?.['x-terminal-session-token']
    if (!terminalId || typeof token !== 'string' || !this.terminalSessions || !this.prisma) {
      return { mode: 'org', orgId: null, state: 'missing' }
    }
    try { await this.terminalSessions.validate(terminalId, token) } catch { return { mode: 'org', orgId: null, state: 'missing' } }
    const terminal = await this.prisma.terminal.findUnique({ where: { id: terminalId }, select: { orgId: true } })
    return terminal?.orgId ? { mode: 'org', orgId: terminal.orgId, state: 'bound' } : { mode: 'org', orgId: null, state: 'unbound' }
  }
}
