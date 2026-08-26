import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';
import { UploadFile } from '../storage/storage.types';

/** Longest edge, in pixels, that a stored image is allowed to have. */
const MAX_DIMENSION = 2400;

@Injectable()
export class ImageProcessorService {
  private readonly logger = new Logger(ImageProcessorService.name);
  private readonly enabled: boolean;

  constructor(private config: ConfigService) {
    this.enabled = this.config.get<string>('storage.processImages') !== 'false';
  }

  /**
   * Re-encodes an uploaded image to WebP.
   *
   * Re-encoding is a security measure as much as an optimisation:
   *
   *  - It strips ALL metadata, including EXIF GPS coordinates. Customers upload
   *    review photos straight from a phone, and those routinely carry the exact
   *    location the photo was taken. Serving that back publicly would leak a
   *    customer's home address.
   *  - It neutralises polyglot files - a payload that is a valid image AND a
   *    valid script. Decoding to raw pixels and re-encoding cannot preserve the
   *    non-image half.
   *
   * `sharp` does not copy metadata unless explicitly asked via `.withMetadata()`,
   * so stripping is the default behaviour here rather than an extra step.
   */
  async processImage(file: UploadFile): Promise<UploadFile> {
    if (!this.enabled) return file;

    try {
      const output = await sharp(file.buffer, { failOn: 'error' })
        .rotate() // bake in EXIF orientation before the tag is discarded
        .resize({
          width: MAX_DIMENSION,
          height: MAX_DIMENSION,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 82 })
        .toBuffer();

      return {
        originalName: file.originalName,
        mimeType: 'image/webp',
        buffer: output,
        size: output.byteLength,
      };
    } catch (error) {
      // A file that passed magic-byte detection but cannot be decoded is
      // either corrupt or crafted. Storing the original would defeat the
      // point of re-encoding, so it is rejected by the caller.
      this.logger.warn(
        `Image processing failed for ${file.originalName}: ${(error as Error).message}`,
      );
      throw error;
    }
  }
}
