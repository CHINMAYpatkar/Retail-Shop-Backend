import { Global, Module } from '@nestjs/common';
import { LocalDiskDriver } from './local-disk.driver';
import { StorageService } from './storage.service';

/**
 * Global because almost every content module needs to store or remove a file,
 * and threading the import through each one adds noise without adding clarity.
 */
@Global()
@Module({
  providers: [LocalDiskDriver, StorageService],
  exports: [StorageService, LocalDiskDriver],
})
export class StorageModule {}
