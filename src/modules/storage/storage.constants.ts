/**
 * Single source of truth for what may be uploaded.
 *
 * Keyed by MIME type, and the extension comes from THIS map - never from the
 * client-supplied filename. A filename is attacker-controlled, so trusting its
 * extension is how an "image" ends up on disk as `.html` or `.js`.
 */
export type MediaCategory = 'image' | 'video' | 'document';

export const ALLOWED_MIME_TYPES: Readonly<Record<string, { ext: string; category: MediaCategory }>> =
  {
    'image/jpeg': { ext: 'jpg', category: 'image' },
    'image/png': { ext: 'png', category: 'image' },
    'image/webp': { ext: 'webp', category: 'image' },
    'image/avif': { ext: 'avif', category: 'image' },
    'video/mp4': { ext: 'mp4', category: 'video' },
    'video/webm': { ext: 'webm', category: 'video' },
    'application/pdf': { ext: 'pdf', category: 'document' },
  };

export function isAllowedMimeType(mimeType: string): boolean {
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, mimeType);
}

export function extensionForMimeType(mimeType: string): string {
  return ALLOWED_MIME_TYPES[mimeType]?.ext ?? 'bin';
}

export function categoryForMimeType(mimeType: string): MediaCategory | undefined {
  return ALLOWED_MIME_TYPES[mimeType]?.category;
}

/**
 * Upload folders are part of the on-disk path, so they are an allowlist rather
 * than free text - anything else is a path-traversal vector.
 */
export const UPLOAD_FOLDERS = [
  'products',
  'categories',
  'ingredients',
  'recipes',
  'banners',
  'blogs',
  'reviews',
  'bills',
  'misc',
] as const;

export type UploadFolder = (typeof UPLOAD_FOLDERS)[number];

/** Folders whose contents must NOT be publicly served - business/financial records. */
export const PRIVATE_FOLDERS: readonly UploadFolder[] = ['bills'];

export function isPrivateFolder(folder: string): boolean {
  return (PRIVATE_FOLDERS as readonly string[]).includes(folder);
}

/**
 * Exact shape of a key produced by a storage driver:
 *   <public|private>/<folder>/<YYYY>/<MM>/<uuid>.<ext>
 *
 * Client-supplied keys are matched against this rather than prefix-checked.
 * A prefix check accepts `public/reviews/../../private/bills/x.pdf`, which is
 * a path-traversal payload wearing a legitimate-looking prefix.
 */
const STORAGE_KEY_PATTERN =
  /^(public|private)\/([a-z-]+)\/(\d{4})\/(\d{2})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z0-9]+)$/;

export interface ParsedStorageKey {
  visibility: 'public' | 'private';
  folder: string;
  extension: string;
}

/** Returns the key's parts, or null if it isn't a well-formed key we could have issued. */
export function parseStorageKey(key: string): ParsedStorageKey | null {
  const match = STORAGE_KEY_PATTERN.exec(key);
  if (!match) return null;

  const [, visibility, folder, , , extension] = match;
  if (!(UPLOAD_FOLDERS as readonly string[]).includes(folder)) return null;

  return { visibility: visibility as 'public' | 'private', folder, extension };
}

/** Extensions that belong to a given media category, derived from the MIME map. */
export function extensionsForCategory(category: MediaCategory): string[] {
  return Object.values(ALLOWED_MIME_TYPES)
    .filter((entry) => entry.category === category)
    .map((entry) => entry.ext);
}
