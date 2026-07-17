import { Controller, Get, Param } from '@nestjs/common'

@Controller('kiosk/activities')
export class ActivitiesController {
  @Get()
  async findAll() {
    return { data: [] }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return { id }
  }
}
