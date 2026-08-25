/**
 * Detects a file's real type from its leading bytes.
 *
 * The declared `Content-Type` on a multipart part and the filename extension
 * are both supplied by the client, so neither is evidence of anything. Only the
 * bytes are. Everything downstream (the extension written to disk, the stored
 * `mimeType`, the size cap applied) is derived from what this function returns,
 * and the client's claim is never consulted.
 *
 * Hand-rolled rather than using `file-type`: that package is ESM-only from v17
 * and this is a CommonJS build, and the allowlist here is small enough that the
 * signatures are easier to audit than a dependency.
 */
import { ALLOWED_MIME_TYPES } from '../storage/storage.constants';

function ascii(buffer: Buffer, start: number, length: number): string {
  return buffer.subarray(start, start + length).toString('ascii');
}

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  return bytes.every((byte, index) => buffer[index] === byte);
}

/** ISO-BMFF brands we accept as MP4. */
const MP4_BRANDS = new Set([
  'isom',
  'iso2',
  'iso4',
  'iso5',
  'iso6',
  'mp41',
  'mp42',
  'avc1',
  'dash',
  'M4V ',
]);

/** ISO-BMFF brands that mean AVIF rather than MP4. */
const AVIF_BRANDS = new Set(['avif', 'avis']);

export function detectMimeType(buffer: Buffer): string | null {
  if (buffer.length < 12) return null;

  // JPEG - SOI marker
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) return 'image/jpeg';

  // PNG - 8-byte signature
  if (startsWith(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';

  // WebP - RIFF container with a WEBP form type
  if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WEBP') return 'image/webp';

  // PDF
  if (ascii(buffer, 0, 4) === '%PDF') return 'application/pdf';

  // Matroska/WebM - EBML header. Both share it; we only accept WebM, and
  // sharp/browsers treat a mislabelled mkv as an unplayable video rather than
  // as a security problem, so distinguishing the DocType isn't worth the code.
  if (startsWith(buffer, [0x1a, 0x45, 0xdf, 0xa3])) return 'video/webm';

  // ISO base media format - the brand at offset 8 separates AVIF from MP4
  if (ascii(buffer, 4, 4) === 'ftyp') {
    const brand = ascii(buffer, 8, 4);
    if (AVIF_BRANDS.has(brand)) return 'image/avif';
    if (MP4_BRANDS.has(brand)) return 'video/mp4';
    return null;
  }

  return null;
}

/**
 * Returns the file's real MIME type, or null if it is unreadable or not on the
 * allowlist. A null result should always be a 400 - never a fallback to the
 * client's declared type.
 */
export function detectAllowedMimeType(buffer: Buffer): string | null {
  const detected = detectMimeType(buffer);
  if (!detected) return null;
  return Object.prototype.hasOwnProperty.call(ALLOWED_MIME_TYPES, detected) ? detected : null;
}
