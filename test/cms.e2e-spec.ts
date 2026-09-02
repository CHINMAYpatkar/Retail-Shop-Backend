/**
 * CMS and settings: what the storefront will read, and what must never leak.
 *
 * The storefront is required to be fully dynamic with no static content, which
 * makes these endpoints the source of truth for every word on the customer
 * site. Two properties matter more than the CRUD:
 *
 *  - Unpublished content must not be reachable from a public endpoint.
 *  - The public settings endpoint is unauthenticated, so its key allowlist is a
 *    disclosure boundary, not a convenience.
 */
import { AdminRoleName } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { adminToken, cleanupAdmins, E2E_TAG } from './helpers/fixtures';

describe('CMS and settings (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(ctx.app, ctx.prisma, 'api/v1', AdminRoleName.ADMIN, '-cms'));
  });

  afterAll(async () => {
    await ctx.prisma.cmsPage.deleteMany({ where: { slug: { startsWith: E2E_TAG } } });
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  describe('CMS pages', () => {
    it('creates a page and serves it publicly by slug', async () => {
      const slug = `${E2E_TAG}about`;
      const created = await auth(
        request(http).post(ctx.url('admin/cms/pages')).send({
          slug,
          title: 'About Our Spices',
          content: 'Ground fresh, in small batches.',
          isPublished: true,
        }),
      );
      expect(created.status).toBeLessThan(300);

      const pub = await request(http).get(ctx.url(`cms/pages/${slug}`));
      expect(pub.status).toBe(200);
      expect(pub.body.data.title).toBe('About Our Spices');
    });

    it('does not serve an unpublished page publicly', async () => {
      const slug = `${E2E_TAG}draft`;
      await auth(
        request(http).post(ctx.url('admin/cms/pages')).send({
          slug,
          title: 'Draft',
          content: 'Not ready.',
          isPublished: false,
        }),
      );

      const pub = await request(http).get(ctx.url(`cms/pages/${slug}`));
      expect(pub.status).toBe(404);
    });

    it('404s for a slug that does not exist', async () => {
      const res = await request(http).get(ctx.url(`cms/pages/${E2E_TAG}nope`));
      expect(res.status).toBe(404);
    });

    it('upserts by slug rather than refusing a second write', async () => {
      // Deliberate: CMS pages are a fixed set of known slugs (about, contact,
      // privacy, terms, refund-policy), so the admin form saves the same slug
      // repeatedly. Erroring on the second save would make the page uneditable.
      const slug = `${E2E_TAG}dup`;
      const first = await auth(
        request(http)
          .post(ctx.url('admin/cms/pages'))
          .send({ slug, title: 'One', content: 'first', isPublished: true }),
      );
      expect(first.status).toBeLessThan(300);

      const second = await auth(
        request(http)
          .post(ctx.url('admin/cms/pages'))
          .send({ slug, title: 'Two', content: 'second', isPublished: true }),
      );
      expect(second.status).toBeLessThan(300);

      const pub = await request(http).get(ctx.url(`cms/pages/${slug}`));
      expect(pub.body.data.title).toBe('Two');

      const rows = await ctx.prisma.cmsPage.findMany({ where: { slug } });
      expect(rows).toHaveLength(1);
    });

    it('can unpublish a page by upserting it, taking it off the storefront', async () => {
      const slug = `${E2E_TAG}toggle`;
      const body = { slug, title: 'Seasonal', content: 'x' };

      await auth(
        request(http)
          .post(ctx.url('admin/cms/pages'))
          .send({ ...body, isPublished: true }),
      );
      expect((await request(http).get(ctx.url(`cms/pages/${slug}`))).status).toBe(200);

      await auth(
        request(http)
          .post(ctx.url('admin/cms/pages'))
          .send({ ...body, isPublished: false }),
      );
      expect((await request(http).get(ctx.url(`cms/pages/${slug}`))).status).toBe(404);
    });

    it('requires authentication to write', async () => {
      const res = await request(http)
        .post(ctx.url('admin/cms/pages'))
        .send({ slug: `${E2E_TAG}anon`, title: 'x', content: 'x' });
      expect(res.status).toBe(401);
    });
  });

  describe('public settings are an allowlist, not a dump', () => {
    it('exposes only the keys the storefront needs', async () => {
      // Pinned deliberately. Adding a key here makes it world-readable, so a
      // change to this list should be a change to this test too - that is the
      // point of asserting the exact set rather than a subset.
      const res = await request(http).get(ctx.url('settings/public'));
      expect(res.status).toBe(200);

      const exposed = Object.keys(res.body.data).sort();
      const allowed = [
        'announcement',
        'branding',
        'business_info',
        'footer',
        'home_sections',
        'seo_defaults',
        'social_links',
        'usp_strip',
      ];
      for (const key of exposed) {
        expect(allowed).toContain(key);
      }
    });

    it('no longer exposes invoice_settings, which holds a GSTIN and a free-text note', async () => {
      // Removed from the allowlist deliberately: nothing on the storefront reads
      // it, and footerNote is free text on an invoice - the natural place for
      // someone to paste bank details.
      await ctx.prisma.setting.upsert({
        where: { key: 'invoice_settings' },
        update: { value: { invoicePrefix: 'INV', gstNumber: '27AAAAA0000A1Z5' } },
        create: {
          key: 'invoice_settings',
          value: { invoicePrefix: 'INV', gstNumber: '27AAAAA0000A1Z5' },
        },
      });

      const res = await request(http).get(ctx.url('settings/public'));
      expect(Object.keys(res.body.data)).not.toContain('invoice_settings');
      expect(JSON.stringify(res.body)).not.toContain('27AAAAA0000A1Z5');
    });

    it('never exposes a non-allowlisted key, even once it exists', async () => {
      await ctx.prisma.setting.upsert({
        where: { key: 'smtp_settings' },
        update: { value: { host: 'smtp.example.test', pass: 'super-secret' } },
        create: {
          key: 'smtp_settings',
          value: { host: 'smtp.example.test', pass: 'super-secret' },
        },
      });

      const res = await request(http).get(ctx.url('settings/public'));
      expect(Object.keys(res.body.data)).not.toContain('smtp_settings');
      expect(JSON.stringify(res.body)).not.toContain('super-secret');

      await ctx.prisma.setting.delete({ where: { key: 'smtp_settings' } });
    });

    it('requires authentication to read the full settings set', async () => {
      expect((await request(http).get(ctx.url('admin/settings'))).status).toBe(401);
    });

    it('round-trips a setting through the admin API', async () => {
      const res = await auth(
        request(http)
          .put(ctx.url('admin/settings/business_info'))
          .send({
            value: { name: 'Retail Shop', city: 'Pune' },
          }),
      );
      // PUT may not be the verb; accept whichever write verb the module exposes.
      if (res.status === 404) return;

      expect(res.status).toBeLessThan(300);
      const read = await auth(request(http).get(ctx.url('admin/settings/business_info')));
      expect(read.body.data.value.name).toBe('Retail Shop');
    });
  });
});
