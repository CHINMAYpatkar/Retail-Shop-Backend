import { Injectable, NotFoundException } from '@nestjs/common';
import { MediaAsset, Prisma, StorageDriverName } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateMediaAssetDto } from './dto/create-media-asset.dto';
import { QueryMediaDto } from './dto/query-media.dto';

/**
 * The media library.
 *
 * An asset is one of two things:
 *  - an uploaded file, identified by `storageKey`, whose URL is resolved from
 *    that key at read time; or
 *  - an external link, which only ever has a `url`.
 *
 * Callers must not read `asset.url` straight off the row - go through
 * `toResponse()`, which picks the right source. See ADR 0008.
 */
@Injectable()
export class MediaService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
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

    return {
      items: items.map((item) => this.toResponse(item)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /** The raw row, for callers that need `storageKey` itself (e.g. private-document streaming). */
  async findRecord(id: string): Promise<MediaAsset> {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');
    return asset;
  }

  /**
   * Records an asset. Two shapes are supported:
   *  - upload: `storageKey` present, `url` derived from it
   *  - external link: `url` present, no `storageKey`
   *
   * `url` is still persisted for uploads as a convenience/debugging value, but
   * it is never the source of truth - see `toResponse()`.
   */
  async create(dto: CreateMediaAssetDto, uploadedBy: string) {
    const asset = await this.prisma.mediaAsset.create({
      data: {
        fileName: dto.fileName,
        type: dto.type,
        folder: dto.folder,
        sizeBytes: dto.sizeBytes,
        mimeType: dto.mimeType,
        storageKey: dto.storageKey,
        // Only stamp a driver when we actually own the bytes.
        driver: dto.storageKey ? this.currentDriver() : null,
        // Private assets resolve to null and are streamed through a guarded
        // route; the column stores an empty string rather than a URL that 404s.
        url: dto.storageKey ? (this.storage.publicUrl(dto.storageKey) ?? '') : dto.url!,
        uploadedBy,
      },
    });

    return this.toResponse(asset);
  }

  async remove(id: string) {
    const asset = await this.prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Media asset not found');

    // Only delete bytes we own. An external link has nothing to clean up, and
    // an asset stored on a different driver than the one currently configured
    // is left alone rather than being deleted from the wrong backend.
    if (asset.storageKey && asset.driver === this.currentDriver()) {
      await this.storage.delete(asset.storageKey);
    }

    await this.prisma.mediaAsset.delete({ where: { id } });
    return { message: 'Media asset deleted' };
  }

  /** Resolves the URL from `storageKey` for uploads, falling back to the stored link. */
  private toResponse(asset: MediaAsset) {
    return {
      ...asset,
      url: asset.storageKey ? this.storage.publicUrl(asset.storageKey) : asset.url,
      isUploaded: Boolean(asset.storageKey),
      isPrivate: Boolean(asset.storageKey && !this.storage.publicUrl(asset.storageKey)),
    };
  }

  private currentDriver(): StorageDriverName {
    return this.storage.driverName === 's3' ? StorageDriverName.S3 : StorageDriverName.LOCAL;
  }
}
