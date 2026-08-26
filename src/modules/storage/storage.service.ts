import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { LocalDiskDriver } from './local-disk.driver';
import { StorageDriver, StoredObject, UploadFile } from './storage.types';

/**
 * The single entry point every module uses to store or remove a file.
 *
 * Callers never touch a driver directly, which is what keeps the eventual S3
 * migration a contained change: add an S3Driver, flip STORAGE_DRIVER, and no
 * call site moves. See ADR 0008.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly driver: StorageDriver;

  constructor(
    private config: ConfigService,
    private localDisk: LocalDiskDriver,
  ) {
    const configured = this.config.get<string>('storage.driver') || 'local';

    if (configured === 's3') {
      // Deliberately not silently falling back: an operator who set s3 and got
      // local disk would think their files were in the bucket. Fail loudly at
      // boot instead of quietly writing to a disk nobody backs up.
      throw new Error(
        'STORAGE_DRIVER=s3 is not implemented yet. Set STORAGE_DRIVER=local until the S3 driver lands.',
      );
    }

    this.driver = this.localDisk;
  }

  /**
   * Verifies the uploads root is writable at boot, mirroring the SMTP
   * check - a storage misconfiguration should be an obvious startup log line,
   * not something discovered when an admin's first upload fails.
   */
  async onModuleInit(): Promise<void> {
    if (this.driver.name !== 'local') return;

    const root = this.localDisk.getRoot();
    try {
      // Create both subtrees up front so the static mount has a real directory
      // to point at on a cold start.
      await fs.mkdir(this.localDisk.getPublicRoot(), { recursive: true });
      await fs.mkdir(root + '/private', { recursive: true });
      await fs.access(root);
      this.logger.log(`Storage driver "local" ready - uploads root: ${root}`);
    } catch (error) {
      this.logger.error(
        `Uploads root is NOT writable (${root}). File uploads will fail. ` +
          `Reason: ${(error as Error).message}`,
      );
    }
  }

  put(file: UploadFile, folder: string): Promise<StoredObject> {
    return this.driver.put(file, folder);
  }

  delete(storageKey: string): Promise<void> {
    return this.driver.delete(storageKey);
  }

  /**
   * Resolves a stored key to a public URL, or null for private assets (bill
   * and receipt scans), which are streamed through a guarded route instead.
   *
   * Always prefer this over a persisted URL column so a driver change doesn't
   * require rewriting rows.
   */
  publicUrl(storageKey: string): string | null {
    return this.driver.publicUrl(storageKey);
  }

  localPath(storageKey: string): string | null {
    return this.driver.localPath(storageKey);
  }

  get driverName(): string {
    return this.driver.name;
  }
}
