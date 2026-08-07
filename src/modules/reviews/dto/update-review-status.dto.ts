import { ApiProperty } from '@nestjs/swagger';
import { ReviewStatus } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateReviewStatusDto {
  @ApiProperty({ enum: ReviewStatus })
  @IsEnum(ReviewStatus)
  status: ReviewStatus;
}
