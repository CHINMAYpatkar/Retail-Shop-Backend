import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class AddMessageDto {
  @ApiProperty()
  @IsString()
  @MaxLength(4000)
  message: string;
}
