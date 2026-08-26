import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MediaType } from '@prisma/client';
import { IsEnum, IsInt, IsOptional, IsString, ValidateIf } from 'class-validator';

/**
 * Records a media asset. Exactly one of `storageKey` (an uploaded file) or
 * `url` (an external link) must be supplied.
 */
export class CreateMediaAssetDto {
  @ApiProperty()
  @IsString()
  fileName: string;

  @ApiProperty({ enum: MediaType })
  @IsEnum(MediaType)
  type: MediaType;

  @ApiPropertyOptional({
    description:
      'Driver-relative key returned by the upload endpoint. Supply this for uploaded files; the URL is derived from it.',
  })
  @IsOptional()
  @IsString()
  storageKey?: string;

  @ApiPropertyOptional({
    description: 'External URL. Only for assets hosted elsewhere - omit when supplying storageKey.',
  })
  @ValidateIf((dto: CreateMediaAssetDto) => !dto.storageKey)
  @IsString()
  url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  folder?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  sizeBytes?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  mimeType?: string;
}
