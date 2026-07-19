import { Module } from '@nestjs/common'
import { JwtVerifierModule } from '../common/jwt-verifier.module'
import { TerminalsController } from './terminals.controller'
import { AdminTerminalsController } from './admin-terminals.controller'
import { AdminPrintersController } from './admin-printers.controller'
import { AdminToolboxController } from './admin-toolbox.controller'
import { TerminalAgentService } from './terminals-agent.service'
import { TerminalAdminService } from './terminals-admin.service'
import { TerminalsService } from './terminals.service'
import { TerminalToolboxService } from './terminal-toolbox.service'
import { ToolboxGovernanceService } from './toolbox-governance.service'
import { TerminalCapabilitiesService } from './terminal-capabilities.service'

@Module({
  imports: [JwtVerifierModule],
  controllers: [TerminalsController, AdminTerminalsController, AdminPrintersController, AdminToolboxController],
  providers: [
    TerminalAgentService,
    TerminalAdminService,
    TerminalsService,
    TerminalToolboxService,
    ToolboxGovernanceService,
    TerminalCapabilitiesService,
  ],
  exports: [
    TerminalAgentService,
    TerminalAdminService,
    TerminalsService,
    TerminalToolboxService,
    ToolboxGovernanceService,
    TerminalCapabilitiesService,
  ],
})
export class TerminalsModule {}
