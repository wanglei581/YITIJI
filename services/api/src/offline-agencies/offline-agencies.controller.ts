import { Controller, Get, Param } from '@nestjs/common'

@Controller('kiosk/offline-agencies')
export class OfflineAgenciesController {
  @Get()
  async findAll() {
    return { data: [], total: 0 }
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return { id, name: '', status: 'active' }
  }
}
