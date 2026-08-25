import { MediaCategory } from './storage.constants';

export type StorageDriverName = 'local' | 's3';

/** A file received by the API, normalised away from multer's shape. */
export interface UploadFile {
  originalName: string;
  mimeType: string;
  buffer: Buffer;
  size: number;
}

export interface StoredObject {
  /**
   * Driver-relative key, e.g. `products/2026/08/<uuid>.webp`.
   *
   * This - not a resolved URL - is what gets persisted. Storing an absolute URL
   * is what makes changing storage backend expensive: every row needs rewriting
   * and every URL already in the wild breaks. Keys stay stable across backends
   * forever; only the resolver changes. See ADR 0008.
   */
  storageKey: string;
  /** Resolved at write time for convenience; null for private assets. */
  url: string | null;
  sizeBytes: number;
  mimeType: string;
  category: MediaCategory;
}

export interface StorageDriver {
  readonly name: StorageDriverName;

  /** Persists the file and returns its key. Folder must be an allowlisted UploadFolder. */
  put(file: UploadFile, folder: string): Promise<StoredObject>;

  /** Removes the object. Must not throw if it is already gone. */
  delete(storageKey: string): Promise<void>;

  /**
   * Resolves the public URL for a key, or null when the asset is private and
   * must be streamed through a guarded route instead.
   */
  publicUrl(storageKey: string): string | null;

  /**
   * Absolute filesystem path for a key, for streaming private files through a
   * guarded controller. Only meaningful for disk-backed drivers; an S3 driver
   * returns null and the caller falls back to a signed URL.
   */
  localPath(storageKey: string): string | null;
}

export const STORAGE_DRIVER = Symbol('STORAGE_DRIVER');
