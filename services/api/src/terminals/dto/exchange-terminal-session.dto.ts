import { IsString, Matches } from 'class-validator'

/** A short-lived value delivered only in the Agent-launched kiosk URL. */
export class ExchangeTerminalSessionDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{32,128}$/)
  bootTicket!: string
}
