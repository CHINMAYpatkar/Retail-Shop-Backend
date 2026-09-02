/**
 * Upload authorization and type handling.
 *
 * The security property under test is that the FILE BYTES decide the type.
 * A filename and a declared Content-Type are both attacker-controlled, so an
 * "image" that is really HTML must be refused however convincingly it is
 * labelled.
 */
import { AdminRoleName } from '@prisma/client';
import { promises as fs } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins } from './helpers/fixtures';

/** A real 8x8 PNG, produced rather than hard-coded so it is genuinely decodable. */
async function pngBytes(): Promise<Buffer> {
  return sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 60, b: 20 } },
  })
    .png()
    .toBuffer();
}

describe('Uploads (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  const tokens = {} as Record<string, string>;
  const created: string[] = [];

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    for (const role of [
      AdminRoleName.SUPER_ADMIN,
      AdminRoleName.ADMIN,
      AdminRoleName.MANAGER,
      AdminRoleName.STAFF,
    ]) {
      const { token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', role, '-upload');
      tokens[role] = token;
    }
  });

  afterAll(async () => {
    // Remove only the bytes these specs wrote.
    const root = process.env.UPLOAD_DIR || './uploads-test';
    for (const key of created) {
      await fs.rm(join(root, key), { force: true }).catch(() => undefined);
    }
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  function upload(
    role: string,
    folder: string,
    buffer: Buffer,
    filename: string,
    contentType: string,
  ) {
    return request(http)
      .post(ctx.url('admin/uploads'))
      .set('Authorization', `Bearer ${tokens[role]}`)
      .field('folder', folder)
      .attach('file', buffer, { filename, contentType });
  }

  describe('authorization', () => {
    it('refuses STAFF, whose grant is orders.view and support.view only', async () => {
      const res = await upload(
        AdminRoleName.STAFF,
        'products',
        await pngBytes(),
        'a.png',
        'image/png',
      );
      expect(res.status).toBe(403);
    });

    it('allows MANAGER to upload product media', async () => {
      const res = await upload(
        AdminRoleName.MANAGER,
        'products',
        await pngBytes(),
        'a.png',
        'image/png',
      );
      expect(res.status).toBeLessThan(300);
      if (res.body?.data?.storageKey) created.push(res.body.data.storageKey);
    });

    it('refuses MANAGER the private bills folder', async () => {
      // Bill scans are readable only by back-office roles, so a MANAGER writing
      // there would create a file they could never read back.
      const res = await upload(
        AdminRoleName.MANAGER,
        'bills',
        await pngBytes(),
        'a.png',
        'image/png',
      );
      expect(res.status).toBe(403);
    });

    it('allows ADMIN the private bills folder', async () => {
      const res = await upload(
        AdminRoleName.ADMIN,
        'bills',
        await pngBytes(),
        'a.png',
        'image/png',
      );
      expect(res.status).toBeLessThan(300);
      if (res.body?.data?.storageKey) created.push(res.body.data.storageKey);
    });

    it('refuses an unauthenticated upload', async () => {
      const res = await request(http)
        .post(ctx.url('admin/uploads'))
        .attach('file', await pngBytes(), { filename: 'a.png', contentType: 'image/png' });
      expect(res.status).toBe(401);
    });
  });

  describe('type detection is based on bytes, not on what the client claims', () => {
    it('refuses HTML dressed up as a PNG', async () => {
      const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script><!-- padding -->');
      const res = await upload(AdminRoleName.ADMIN, 'products', html, 'photo.png', 'image/png');
      expect(res.status).toBe(400);
    });

    it('refuses an SVG, however it is labelled', async () => {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>');
      const res = await upload(AdminRoleName.ADMIN, 'products', svg, 'logo.jpg', 'image/jpeg');
      expect(res.status).toBe(400);
    });

    it('refuses an empty file', async () => {
      const res = await upload(
        AdminRoleName.ADMIN,
        'products',
        Buffer.alloc(0),
        'a.png',
        'image/png',
      );
      expect(res.status).toBe(400);
    });

    it('accepts a real PNG even when the declared Content-Type is wrong', async () => {
      // The mirror image of the attack: the bytes are fine, the label is not.
      const res = await upload(
        AdminRoleName.ADMIN,
        'products',
        await pngBytes(),
        'mislabelled.pdf',
        'application/pdf',
      );
      expect(res.status).toBeLessThan(300);
      if (res.body?.data?.storageKey) created.push(res.body.data.storageKey);
    });

    it('refuses an unknown folder', async () => {
      const res = await upload(AdminRoleName.ADMIN, 'etc', await pngBytes(), 'a.png', 'image/png');
      expect(res.status).toBe(400);
    });
  });

  describe('stored result', () => {
    it('re-encodes an image and names it from a UUID, not the client filename', async () => {
      const res = await upload(
        AdminRoleName.ADMIN,
        'products',
        await pngBytes(),
        '../../evil name.png',
        'image/png',
      );
      expect(res.status).toBeLessThan(300);

      const key: string = res.body.data.storageKey;
      created.push(key);

      expect(key).toMatch(/^public\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.(webp|png|jpg|avif)$/);
      expect(key).not.toContain('evil');
      expect(key).not.toContain('..');
    });

    it('strips EXIF, including GPS, by re-encoding', async () => {
      // A customer photo carrying home coordinates is a privacy leak that
      // survives forever once it is on a public URL.
      const withExif = await sharp({
        create: { width: 8, height: 8, channels: 3, background: { r: 1, g: 2, b: 3 } },
      })
        .withMetadata({ exif: { IFD0: { Copyright: 'e2e', Software: 'e2e-gps-marker' } } })
        .jpeg()
        .toBuffer();

      const res = await upload(AdminRoleName.ADMIN, 'products', withExif, 'geo.jpg', 'image/jpeg');
      expect(res.status).toBeLessThan(300);

      const key: string = res.body.data.storageKey;
      created.push(key);

      const root = process.env.UPLOAD_DIR || './uploads-test';
      const stored = await fs.readFile(join(root, key));
      const meta = await sharp(stored).metadata();
      expect(meta.exif).toBeUndefined();
      expect(stored.includes(Buffer.from('e2e-gps-marker'))).toBe(false);
    });
  });
});
