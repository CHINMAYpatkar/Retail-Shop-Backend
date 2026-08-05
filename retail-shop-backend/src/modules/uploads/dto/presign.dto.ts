import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';

const ALLOWED_FOLDERS = ['products', 'banners', 'recipes', 'reviews', 'blogs', 'ingredients', 'categories', 'misc'];

export class PresignDto {
  @ApiProperty()
  @IsString()
  fileName: string;

  @ApiProperty({ example: 'image/jpeg' })
  @IsString()
  contentType: string;

  @ApiPropertyOptional({ enum: ALLOWED_FOLDERS, default: 'misc' })
  @IsOptional()
  @IsIn(ALLOWED_FOLDERS)
  folder?: string;
}
