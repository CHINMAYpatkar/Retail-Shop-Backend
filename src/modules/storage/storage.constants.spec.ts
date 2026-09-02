import {
  parseStorageKey,
  isAllowedMimeType,
  extensionForMimeType,
  categoryForMimeType,
  isPrivateFolder,
  extensionsForCategory,
  ALLOWED_MIME_TYPES,
} from './storage.constants';

const uuid = '0f8fad5b-d9cb-469f-a165-70867728950e';
/** Built by char code so no escape sequence has to survive an editor or a shell. */
const BACKSLASH = String.fromCharCode(92);
const validKey = `public/products/2026/09/${uuid}.jpg`;

describe('parseStorageKey', () => {
  it('parses a well-formed public key', () => {
    expect(parseStorageKey(validKey)).toEqual({
      visibility: 'public',
      folder: 'products',
      extension: 'jpg',
    });
  });

  it('parses a well-formed private key', () => {
    expect(parseStorageKey(`private/bills/2026/01/${uuid}.pdf`)).toEqual({
      visibility: 'private',
      folder: 'bills',
      extension: 'pdf',
    });
  });

  // The reason this function validates the whole shape instead of checking a
  // prefix: a prefix check accepts every one of these.
  describe('rejects path traversal', () => {
    const payloads: [string, string][] = [
      [
        'dot-dot climbing out of public into private',
        `public/reviews/../../private/bills/${uuid}.pdf`,
      ],
      [
        'dot-dot climbing out of the storage root',
        'public/products/2026/09/../../../../etc/passwd',
      ],
      ['leading dot-dot', `../private/bills/2026/09/${uuid}.pdf`],
      ['url-encoded dot-dot', `public/products/2026/09/..%2f..%2f${uuid}.jpg`],
      ['windows separators', ['public', 'products', '2026', '09', `${uuid}.jpg`].join(BACKSLASH)],
      ['leading slash', `/public/products/2026/09/${uuid}.jpg`],
      ['doubled separator', `public//products/2026/09/${uuid}.jpg`],
      ['trailing traversal after a valid key', `${validKey}/../../x.jpg`],
    ];

    it.each(payloads)('%s', (_label, payload) => {
      expect(parseStorageKey(payload)).toBeNull();
    });
  });

  it('rejects an absolute path', () => {
    expect(parseStorageKey('C:/Windows/System32/config/sam')).toBeNull();
    expect(parseStorageKey('/etc/shadow')).toBeNull();
  });

  it('rejects a null byte, which can truncate a path in a native call', () => {
    expect(parseStorageKey(`public/products/2026/09/${uuid}.jpg\0.png`)).toBeNull();
  });

  it('rejects an unknown visibility segment', () => {
    expect(parseStorageKey(`internal/products/2026/09/${uuid}.jpg`)).toBeNull();
  });

  it('rejects a folder that is not on the allowlist', () => {
    expect(parseStorageKey(`public/secrets/2026/09/${uuid}.jpg`)).toBeNull();
  });

  it('rejects a filename that is not a UUID', () => {
    // A non-UUID name was not issued by a driver, so it is a guess at best.
    expect(parseStorageKey('public/products/2026/09/photo.jpg')).toBeNull();
  });

  it('rejects a malformed date segment', () => {
    expect(parseStorageKey(`public/products/26/9/${uuid}.jpg`)).toBeNull();
  });

  it('rejects a missing extension', () => {
    expect(parseStorageKey(`public/products/2026/09/${uuid}`)).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(parseStorageKey('')).toBeNull();
  });

  it('rejects trailing whitespace or a newline', () => {
    expect(parseStorageKey(`${validKey}\n`)).toBeNull();
    expect(parseStorageKey(`${validKey} `)).toBeNull();
  });

  it('is case-sensitive, matching what the drivers actually issue', () => {
    expect(parseStorageKey(`PUBLIC/products/2026/09/${uuid}.jpg`)).toBeNull();
    expect(parseStorageKey(`public/products/2026/09/${uuid.toUpperCase()}.jpg`)).toBeNull();
  });
});

describe('mime allowlist', () => {
  it('accepts only listed types', () => {
    expect(isAllowedMimeType('image/jpeg')).toBe(true);
    expect(isAllowedMimeType('image/svg+xml')).toBe(false);
    expect(isAllowedMimeType('text/html')).toBe(false);
  });

  it('is not fooled by inherited object properties', () => {
    // A bare `in` or a truthy index check would say yes to all three.
    expect(isAllowedMimeType('constructor')).toBe(false);
    expect(isAllowedMimeType('__proto__')).toBe(false);
    expect(isAllowedMimeType('toString')).toBe(false);
  });

  it('falls back to .bin for an unknown type, never to a real extension', () => {
    expect(extensionForMimeType('application/x-msdownload')).toBe('bin');
  });

  it('maps every allowed type to a category', () => {
    for (const mime of Object.keys(ALLOWED_MIME_TYPES)) {
      expect(categoryForMimeType(mime)).toBeDefined();
    }
  });

  it('never issues an extension that could be served as executable content', () => {
    // Guards the allowlist against a future addition that would be served from
    // the public static mount and interpreted by a browser.
    const dangerous = ['html', 'htm', 'js', 'mjs', 'svg', 'php', 'exe', 'bat', 'sh'];
    for (const entry of Object.values(ALLOWED_MIME_TYPES)) {
      expect(dangerous).not.toContain(entry.ext);
    }
  });

  it('lists extensions per category', () => {
    expect(extensionsForCategory('document')).toEqual(['pdf']);
    expect(extensionsForCategory('image').sort()).toEqual(['avif', 'jpg', 'png', 'webp']);
  });
});

describe('private folders', () => {
  it('treats bills as private because they are financial records', () => {
    expect(isPrivateFolder('bills')).toBe(true);
  });

  it('treats customer-facing media as public', () => {
    expect(isPrivateFolder('products')).toBe(false);
    expect(isPrivateFolder('reviews')).toBe(false);
  });

  it('does not report an unknown folder as private', () => {
    expect(isPrivateFolder('nope')).toBe(false);
  });
});
