import { ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryMediaDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: MediaType })
  @IsOptional()
  @IsEnum(MediaType)
  type?: MediaType;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  folder?: string;
}
