import { IsString, Matches } from 'class-validator'

export class ClaimPickupDto {
  @IsString()
  @Matches(/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/)
  code!: string
}
