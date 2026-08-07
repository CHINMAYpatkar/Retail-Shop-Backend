import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { S3Service } from '../uploads/s3.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { QueryMediaDto } from './dto/query-media.dto';

@Injectable()
export class MediaService {
  constructor(
    private prisma: PrismaService,
    private s3: S3Service,
  ) {}

  async findAll(query: QueryMediaDto) {
    const { page = 1, limit = 30, type, folder, search } = query;
    const where: Prisma.MediaAssetWhereInput = {
      ...(type ? { type } : {}),
      ...(folder ? { folder } : {}),
      ...(search ? { fileName: { contains: search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.mediaAsset.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.mediaAsset.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /** Called after a successful presigned-URL upload to record the asset. */
  create(dto: CreateMediaAssetDto, uploadedBy: string) {
    return this.prisma.mediaAsset.create({
      data: {
        fileName: dto.fileName,
        url: dto.url,
        type: dto.type,
        folder: dto.folder,
        sizeBytes: dto.sizeBytes,
        uploadedBy,
      },
    });
  }

  async remove(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');

    // Best-effort derive the S3 key from the stored URL so we can clean up storage too.
    const key = asset.url.split('.amazonaws.com/')[1];
    if (key) await this.s3.deleteObject(key);

    await this.prisma.mediaAsset.delete({ where: { id } });
    return { message: 'Media asset deleted' };
  }
}
