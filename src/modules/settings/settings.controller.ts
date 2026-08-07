import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';

@ApiTags('Settings (Public)')
@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get('public')
  findPublic() {
    return this.service.findPublic();
  }
}
