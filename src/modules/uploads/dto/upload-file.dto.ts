import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { UPLOAD_FOLDERS } from '../../storage/storage.constants';

export class UploadFileDto {
  @ApiPropertyOptional({
    enum: UPLOAD_FOLDERS,
    default: 'misc',
    description: 'Logical destination. Determines the storage path and whether the asset is public.',
  })
  @IsOptional()
  @IsIn(UPLOAD_FOLDERS as unknown as string[])
  folder?: string;
}
