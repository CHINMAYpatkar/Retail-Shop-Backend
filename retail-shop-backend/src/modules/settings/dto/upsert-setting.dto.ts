import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty } from 'class-validator';

export class UpsertSettingDto {
  @ApiProperty({ description: 'Any JSON-serializable value' })
  @IsNotEmpty()
  value: any;
}
