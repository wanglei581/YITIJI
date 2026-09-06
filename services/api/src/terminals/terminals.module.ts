import { Module } from '@nestjs/common'
import { FilesModule } from '../files/files.module'
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
import { TerminalCredentialSecurityService } from './terminal-credential-security.service'
import { TerminalScanDeletionAuditService } from './terminal-scan-deletion-audit.service'
import { ReleaseObservationService } from './release-observation.service'
import { AdminReleaseObservationController } from './admin-release-observation.controller'
import { TerminalHeartbeatRetentionTask } from './terminal-heartbeat-retention.task'

@Module({
  imports: [JwtVerifierModule, FilesModule],
  controllers: [
    TerminalsController,
    AdminTerminalsController,
    AdminReleaseObservationController,
    AdminPrintersController,
    AdminToolboxController,
  ],
  providers: [
    TerminalAgentService,
    TerminalCredentialSecurityService,
    TerminalScanDeletionAuditService,
    ReleaseObservationService,
    TerminalAdminService,
    TerminalsService,
    TerminalToolboxService,
    ToolboxGovernanceService,
    TerminalCapabilitiesService,
    TerminalHeartbeatRetentionTask,
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
