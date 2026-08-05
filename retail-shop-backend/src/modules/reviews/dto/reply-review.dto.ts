import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ReplyReviewDto {
  @ApiProperty()
  @IsString()
  @MaxLength(2000)
  reply: string;
}
