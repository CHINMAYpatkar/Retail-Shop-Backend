import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class QueryReviewsDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: ['latest', 'highest', 'lowest'] })
  @IsOptional()
  @IsIn(['latest', 'highest', 'lowest'])
  sort?: string;
}
