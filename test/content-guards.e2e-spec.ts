/**
 * Delete guards on content that is expensive to recreate.
 *
 * Recipes and blog posts are hard-deleted — no soft delete, no trash view — so
 * a misclick loses real authoring effort with nothing to restore. Rather than
 * add soft delete, these follow the pattern already documented for this
 * project: an ACTIVE recipe and a PUBLISHED post simply cannot be deleted.
 *
 * That turns an irreversible one-click mistake into a reversible two-step one.
 * The tests below are the whole contract: refuse while live, allow once hidden,
 * and leave the row intact when refusing.
 */
import { AdminRoleName } from '@prisma/client';
import request from 'supertest';
import { createTestApp, closeTestApp, TestContext } from './helpers/app';
import { E2E_TAG, adminToken, cleanupAdmins } from './helpers/fixtures';

describe('Content delete guards (e2e)', () => {
  let ctx: TestContext;
  let http: any;
  let token: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    http = ctx.app.getHttpServer();
    ({ token } = await adminToken(
      ctx.app,
      ctx.prisma,
      'api/v1',
      AdminRoleName.SUPER_ADMIN,
      '-guards',
    ));
  });

  afterAll(async () => {
    await ctx.prisma.recipe.deleteMany({ where: { slug: { startsWith: E2E_TAG } } });
    await ctx.prisma.blog.deleteMany({ where: { slug: { startsWith: E2E_TAG } } });
    await cleanupAdmins(ctx.prisma);
    await closeTestApp(ctx);
  });

  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);

  describe('recipes', () => {
    async function makeRecipe(label: string, isActive: boolean) {
      return ctx.prisma.recipe.create({
        data: {
          name: `${E2E_TAG}${label}`,
          slug: `${E2E_TAG}${label}`,
          steps: [],
          isActive,
        },
      });
    }

    it('refuses to delete a recipe that is still active', async () => {
      const recipe = await makeRecipe('active-recipe', true);

      const res = await auth(request(http).delete(ctx.url(`admin/recipes/${recipe.id}`)));

      expect(res.status).toBe(400);
      // The message has to say what to do instead, or the admin is just stuck.
      expect(String(res.body.message)).toMatch(/deactivate/i);
    });

    it('leaves the recipe intact when it refuses', async () => {
      // A guard that half-deletes is worse than no guard.
      const recipe = await makeRecipe('intact-recipe', true);
      await auth(request(http).delete(ctx.url(`admin/recipes/${recipe.id}`)));

      expect(await ctx.prisma.recipe.findUnique({ where: { id: recipe.id } })).not.toBeNull();
    });

    it('allows deleting once it has been deactivated', async () => {
      const recipe = await makeRecipe('inactive-recipe', false);

      const res = await auth(request(http).delete(ctx.url(`admin/recipes/${recipe.id}`)));

      expect(res.status).toBeLessThan(300);
      expect(await ctx.prisma.recipe.findUnique({ where: { id: recipe.id } })).toBeNull();
    });

    it('still 404s for a recipe that does not exist', async () => {
      // The guard must not turn a missing row into a confusing 400.
      const res = await auth(
        request(http).delete(ctx.url('admin/recipes/00000000-0000-4000-8000-000000000404')),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('blog posts', () => {
    async function makePost(label: string, isPublished: boolean) {
      return ctx.prisma.blog.create({
        data: {
          title: `${E2E_TAG}${label}`,
          slug: `${E2E_TAG}${label}`,
          content: 'body',
          isPublished,
        },
      });
    }

    it('refuses to delete a published post', async () => {
      const post = await makePost('published-post', true);

      const res = await auth(request(http).delete(ctx.url(`admin/blogs/${post.id}`)));

      expect(res.status).toBe(400);
      expect(String(res.body.message)).toMatch(/unpublish/i);
      expect(await ctx.prisma.blog.findUnique({ where: { id: post.id } })).not.toBeNull();
    });

    it('allows deleting a draft', async () => {
      const post = await makePost('draft-post', false);

      const res = await auth(request(http).delete(ctx.url(`admin/blogs/${post.id}`)));

      expect(res.status).toBeLessThan(300);
      expect(await ctx.prisma.blog.findUnique({ where: { id: post.id } })).toBeNull();
    });
  });

  describe('banners still accept the dates they advertise', () => {
    /**
     * `create`/`update` used to carry `data: dto as any`. Removing it was safe,
     * but the cast had been silencing type checking on a payload that includes
     * ISO date strings for DateTime columns — so these pin that a scheduled
     * banner round-trips, which is the field nobody exercises until a campaign
     * is due to go live.
     */
    it('accepts a banner scheduled with ISO date strings', async () => {
      const res = await auth(
        request(http)
          .post(ctx.url('admin/banners'))
          .send({
            title: `${E2E_TAG}scheduled`,
            imageUrl: '/uploads/public/banners/x.jpg',
            placement: 'HOME_HERO',
            startsAt: '2026-11-01T00:00:00.000Z',
            endsAt: '2026-11-30T00:00:00.000Z',
          }),
      );

      expect(res.status).toBeLessThan(300);
      expect(new Date(res.body.data.startsAt).toISOString()).toBe('2026-11-01T00:00:00.000Z');

      await ctx.prisma.banner.delete({ where: { id: res.body.data.id } });
    });

    it('accepts a banner with no schedule at all', async () => {
      const res = await auth(
        request(http)
          .post(ctx.url('admin/banners'))
          .send({
            title: `${E2E_TAG}unscheduled`,
            imageUrl: '/uploads/public/banners/y.jpg',
            placement: 'HOME_HERO',
          }),
      );

      expect(res.status).toBeLessThan(300);
      expect(res.body.data.startsAt).toBeNull();

      await ctx.prisma.banner.delete({ where: { id: res.body.data.id } });
    });
  });
});
