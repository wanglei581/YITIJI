import agentPackage from '../package.json'

/**
 * Immutable version of the running payload.
 *
 * Do not source this value from ProgramData configuration: the installer
 * deliberately preserves that file across upgrades, so it can contain the
 * version that originally provisioned the terminal.
 */
export const AGENT_RUNTIME_VERSION = agentPackage.version
