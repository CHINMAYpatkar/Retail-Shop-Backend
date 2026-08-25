import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MediaType, OrderStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  categoryForMimeType,
  extensionsForCategory,
  isPrivateFolder,
  MediaCategory,
  parseStorageKey,
  UPLOAD_FOLDERS,
  UploadFolder,
} from '../storage/storage.constants';
import { StorageService } from '../storage/storage.service';
import { UploadFile } from '../storage/storage.types';
import { detectAllowedMimeType } from './file-signature';
import { ImageProcessorService } from './image-processor.service';

export interface UploadResult {
  storageKey: string;
  url: string | null;
  mimeType: string;
  sizeBytes: number;
  category: MediaCategory;
  mediaType: MediaType;
  fileName: string;
}

const CATEGORY_TO_MEDIA_TYPE: Record<MediaCategory, MediaType> = {
  image: MediaType.IMAGE,
  video: MediaType.VIDEO,
  document: MediaType.DOCUMENT,
};

@Injectable()
export class UploadsService {
  constructor(
    private config: ConfigService,
    private storage: StorageService,
    private imageProcessor: ImageProcessorService,
    private prisma: PrismaService,
  ) {}

  /**
   * Validates, processes and stores one uploaded file.
   *
   * Order matters: detect the real type from the bytes FIRST, then apply the
   * cap for that type, then re-encode. Trusting the declared type for any of
   * those steps would let a caller pick which rules apply to their own file.
   */
  async handleUpload(
    multerFile: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    folder: string,
  ): Promise<UploadResult> {
    const safeFolder = this.assertFolder(folder);

    if (!multerFile?.buffer?.length) {
      throw new BadRequestException('Uploaded file is empty');
    }

    // The client's declared mimetype is deliberately ignored - see file-signature.ts
    const detectedMime = detectAllowedMimeType(multerFile.buffer);
    if (!detectedMime) {
      throw new BadRequestException(
        'Unsupported or unrecognised file type. Allowed: JPEG, PNG, WebP, AVIF, MP4, WebM, PDF.',
      );
    }

    const category = categoryForMimeType(detectedMime)!;
    this.assertWithinSizeLimit(multerFile.buffer.byteLength, category);

    let file: UploadFile = {
      originalName: multerFile.originalname,
      mimeType: detectedMime,
      buffer: multerFile.buffer,
      size: multerFile.buffer.byteLength,
    };

    if (category === 'image') {
      try {
        file = await this.imageProcessor.processImage(file);
      } catch {
        // Passed signature detection but won't decode: corrupt or crafted.
        // Storing the original would defeat the purpose of re-encoding.
        throw new BadRequestException('Image could not be processed and was rejected');
      }
    }

    const stored = await this.storage.put(file, safeFolder);

    return {
      storageKey: stored.storageKey,
      url: stored.url,
      mimeType: stored.mimeType,
      sizeBytes: stored.sizeBytes,
      category: stored.category,
      mediaType: CATEGORY_TO_MEDIA_TYPE[stored.category],
      fileName: multerFile.originalname,
    };
  }

  /**
   * The only path by which a customer can write a file to this server, so the
   * gate matters more than the upload does.
   *
   * Two restrictions, both enforced BEFORE anything is written to disk:
   *  - the customer must have a DELIVERED order containing this product, the
   *    same condition that governs whether they may review it at all
   *  - the result must be an image; video and documents are admin-only
   */
  async handleCustomerReviewUpload(
    multerFile: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    customerId: string,
    productId: string,
  ): Promise<UploadResult> {
    await this.assertDeliveredPurchase(customerId, productId);

    // Detect before storing so a non-image is rejected without ever hitting disk.
    const detected = detectAllowedMimeType(multerFile?.buffer ?? Buffer.alloc(0));
    if (!detected || categoryForMimeType(detected) !== 'image') {
      throw new BadRequestException('Only images (JPEG, PNG, WebP, AVIF) may be attached to a review');
    }

    return this.handleUpload(multerFile, 'reviews');
  }

  /**
   * Mirrors the verified-purchase rule in ReviewsService. Deliberately a
   * ForbiddenException rather than NotFound: the customer is authenticated and
   * the product exists, they simply haven't received it yet.
   */
  async assertDeliveredPurchase(customerId: string, productId: string): Promise<void> {
    const purchase = await this.prisma.orderItem.findFirst({
      where: { productId, order: { customerId, status: OrderStatus.DELIVERED } },
      select: { id: true },
    });

    if (!purchase) {
      throw new ForbiddenException(
        'You can only attach images to a product you have received in a delivered order',
      );
    }
  }

  /**
   * Validates that a client-supplied key really is one of our own review
   * uploads. Without this, `images: ['private/bills/...']` in a review payload
   * would surface a private financial document on a public product page.
   *
   * Matches the key's full shape rather than its prefix. A prefix check accepts
   * `public/reviews/../../private/bills/x.pdf` - a traversal payload wearing a
   * legitimate-looking prefix.
   */
  assertReviewImageKeys(keys: string[]): void {
    const imageExtensions = extensionsForCategory('image');

    for (const key of keys) {
      const parsed = parseStorageKey(key);

      const valid =
        parsed !== null &&
        parsed.visibility === 'public' &&
        parsed.folder === 'reviews' &&
        imageExtensions.includes(parsed.extension);

      if (!valid) {
        throw new BadRequestException(
          'Review images must be keys returned by POST /customer/uploads/review-image',
        );
      }
    }
  }

  private assertFolder(folder: string): UploadFolder {
    if (!(UPLOAD_FOLDERS as readonly string[]).includes(folder)) {
      throw new BadRequestException(
        `Unknown folder "${folder}". Allowed: ${UPLOAD_FOLDERS.join(', ')}`,
      );
    }
    return folder as UploadFolder;
  }

  private assertWithinSizeLimit(sizeBytes: number, category: MediaCategory): void {
    const limitMb = {
      image: this.config.get<number>('storage.maxImageSizeMb')!,
      video: this.config.get<number>('storage.maxVideoSizeMb')!,
      document: this.config.get<number>('storage.maxDocumentSizeMb')!,
    }[category];

    if (sizeBytes > limitMb * 1024 * 1024) {
      throw new PayloadTooLargeException(
        `${category} exceeds the ${limitMb}MB limit (received ${(sizeBytes / 1024 / 1024).toFixed(1)}MB)`,
      );
    }
  }

  /** True when the folder's contents must never be publicly served. */
  isPrivateTarget(folder: string): boolean {
    return isPrivateFolder(folder);
  }
}
