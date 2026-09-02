import { detectMimeType, detectAllowedMimeType } from './file-signature';

/** Builds a buffer with `bytes` at the front, padded so it clears the 12-byte floor. */
function withHeader(bytes: number[], padTo = 32): Buffer {
  const buf = Buffer.alloc(padTo);
  Buffer.from(bytes).copy(buf, 0);
  return buf;
}

/** An ISO-BMFF header with `ftyp` at offset 4 and the brand at offset 8. */
function ftyp(brand: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('ftyp', 4, 'ascii');
  buf.write(brand, 8, 'ascii');
  return buf;
}

/** A RIFF container with the given form type at offset 8. */
function riff(form: string): Buffer {
  const buf = Buffer.alloc(32);
  buf.write('RIFF', 0, 'ascii');
  buf.write(form, 8, 'ascii');
  return buf;
}

const JPEG = withHeader([0xff, 0xd8, 0xff, 0xe0]);
const PNG = withHeader([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.7'), Buffer.alloc(24)]);

describe('detectMimeType', () => {
  it('detects JPEG from the SOI marker', () => {
    expect(detectMimeType(JPEG)).toBe('image/jpeg');
  });

  it('detects PNG from its 8-byte signature', () => {
    expect(detectMimeType(PNG)).toBe('image/png');
  });

  it('detects WebP from a RIFF container with a WEBP form type', () => {
    expect(detectMimeType(riff('WEBP'))).toBe('image/webp');
  });

  it('rejects a RIFF container that is not WebP', () => {
    // A .wav is also RIFF. Accepting the container alone would let audio through
    // an image endpoint.
    expect(detectMimeType(riff('WAVE'))).toBeNull();
  });

  it('detects PDF', () => {
    expect(detectMimeType(PDF)).toBe('application/pdf');
  });

  it('detects WebM from the EBML header', () => {
    expect(detectMimeType(withHeader([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
  });

  it('separates AVIF from MP4 by the ISO-BMFF brand', () => {
    expect(detectMimeType(ftyp('avif'))).toBe('image/avif');
    expect(detectMimeType(ftyp('isom'))).toBe('video/mp4');
    expect(detectMimeType(ftyp('mp42'))).toBe('video/mp4');
  });

  it('rejects an unknown ISO-BMFF brand rather than guessing MP4', () => {
    // 'qt  ' is QuickTime. Guessing would write an unplayable file with a .mp4
    // extension and a lying mimeType in the database.
    expect(detectMimeType(ftyp('qt  '))).toBeNull();
  });

  it('returns null for a buffer too short to identify', () => {
    expect(detectMimeType(Buffer.from([0xff, 0xd8, 0xff]))).toBeNull();
  });

  it('returns null for an empty buffer', () => {
    expect(detectMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('rejects content that is dangerous or simply not allowed', () => {
  it('rejects HTML named as an image, because the filename is never consulted', () => {
    const html = Buffer.concat([Buffer.from('<!DOCTYPE html><script>x</script>'), Buffer.alloc(8)]);
    expect(detectMimeType(html)).toBeNull();
  });

  it('rejects SVG, a script-execution vector dressed as an image', () => {
    const svg = Buffer.concat([
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'),
      Buffer.alloc(8),
    ]);
    expect(detectMimeType(svg)).toBeNull();
  });

  it('rejects a Windows executable', () => {
    expect(detectMimeType(withHeader([0x4d, 0x5a, 0x90, 0x00]))).toBeNull();
  });

  it('rejects a ZIP, which covers the office and jar family too', () => {
    expect(detectMimeType(withHeader([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it('rejects a GIF, which is simply not on the allowlist', () => {
    expect(detectMimeType(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(26)]))).toBeNull();
  });

  it('is not fooled by a valid signature that appears later in the file', () => {
    // Signatures are anchored at offset 0, so a polyglot hiding PNG bytes at an
    // offset must not be accepted.
    const buf = Buffer.alloc(64);
    PNG.copy(buf, 16);
    expect(detectMimeType(buf)).toBeNull();
  });
});

describe('detectAllowedMimeType', () => {
  it('passes through a detected type that is on the allowlist', () => {
    expect(detectAllowedMimeType(JPEG)).toBe('image/jpeg');
  });

  it('returns null rather than falling back to a client-declared type', () => {
    expect(detectAllowedMimeType(Buffer.alloc(32))).toBeNull();
  });

  it('agrees with detectMimeType for everything the detector can produce', () => {
    // Guards against the detector and the allowlist drifting apart: a type the
    // detector recognises but the allowlist rejects is a 400 with no clear cause.
    for (const buf of [JPEG, PNG, riff('WEBP'), PDF, ftyp('avif'), ftyp('isom')]) {
      expect(detectAllowedMimeType(buf)).toBe(detectMimeType(buf));
    }
  });
});
