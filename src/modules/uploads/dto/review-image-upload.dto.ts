import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ReviewImageUploadDto {
  @ApiProperty({ description: 'Product the image will be attached to. Gates on a delivered order.' })
  @IsUUID()
  productId: string;
}
