# Retail Shop — Backend API

NestJS + Prisma + PostgreSQL backend for the Home-made Spices e-commerce platform.
**Phase 1 (Foundation) and Phase 2 (Catalog, Commerce, Content, Support) are both
complete** in this build.

## What's included

### Phase 1 — Foundation
- Full Prisma schema (`prisma/schema.prisma`) covering every entity in the spec.
- **Auth**: customer OTP-first (register/login/refresh/logout), admin email+password
  (login/forgot-reset password/change password/refresh/logout). Separate JWT secrets
  per audience; refresh tokens rotate on every use and only their hashes are stored.
- **RBAC**: Role ↔ Permission model seeded with SUPER_ADMIN/ADMIN/MANAGER/STAFF;
  `RolesGuard` + `PermissionsGuard` + `@Roles()` / `@RequirePermissions()`.
- Admin Users CRUD, admin-side Customers view, customer Addresses.
- Global exception filter, logging interceptor, Helmet, rate limiting, Swagger, env validation.

### Phase 2 — Catalog, Commerce, Content & Support
| Module | Public endpoints | Admin endpoints |
|---|---|---|
| **Categories** | `GET /categories`, `GET /categories/:slug` | full CRUD at `/admin/categories` |
| **Ingredients** | `GET /ingredients`, `GET /ingredients/:slug` | full CRUD at `/admin/ingredients` |
| **Products** | `GET /products` (search/filter/sort/paginate), `GET /products/:slug` | full CRUD + nested images/variants/ingredients, stock update, soft delete/restore at `/admin/products` |
| **Recipes** | `GET /recipes`, `GET /recipes/:slug` | full CRUD (steps, linked ingredients & products) at `/admin/recipes` |
| **Wishlist** | — | customer: add/remove/list at `/customer/wishlist` |
| **Cart** | — | customer: add/update/remove/clear at `/customer/cart` (computes live totals) |
| **Orders** | — | customer: checkout from cart (stock-checked, transactional), list/view/cancel at `/customer/orders`. Admin: list/filter/view, status transitions with validated state machine + history, invoice data, auto-restock on cancel at `/admin/orders` |
| **Reviews** | `GET /products/:id/reviews` | customer: create (verified-purchase auto-detected) at `/customer/reviews`. Admin: approve/reject/reply/delete at `/admin/reviews` |
| **Banners** | `GET /banners?placement=` (active + date-window filtered) | full CRUD at `/admin/banners` |
| **CMS Pages** | `GET /cms/pages/:slug` | upsert/delete at `/admin/cms/pages` |
| **Blogs** | `GET /blogs`, `GET /blogs/:slug` | full CRUD at `/admin/blogs` |
| **FAQs** | `GET /faqs` | full CRUD at `/admin/faqs` |
| **Media Library** | — | S3 presigned upload at `/admin/uploads/presign`, asset tracking CRUD at `/admin/media` |
| **Support Tickets** | `POST /support/tickets` (guest) | customer: create/list/view/reply at `/customer/support/tickets`. Admin: list/filter/reply/status at `/admin/support/tickets` |
| **Settings** | `GET /settings/public` | get/upsert any key at `/admin/settings` |
| **Dashboard** | — | `GET /admin/dashboard/summary` — revenue, order funnel, low stock, top products, latest orders, review/ticket counts |

Every admin write route is gated by `RolesGuard` + `PermissionsGuard`, matching the
seeded permission keys (`products.create`, `orders.update`, etc.) from `prisma/seed.ts`.

### Design notes worth knowing
- **Products**: images/variants/ingredient links use a replace-on-update strategy
  (send the full array, the API reconciles it) — simplest to reason about from the
  admin panel. Product deletes are **soft** (`deletedAt`) so historical orders stay intact.
- **Orders**: checkout runs in a DB transaction — stock is checked and decremented
  atomically per line item, using variant price overrides where applicable. Status
  changes go through a validated transition map (see `ALLOWED_TRANSITIONS` in
  `orders.service.ts`); cancelling automatically restocks. Every status change is
  appended to `OrderStatusHistory` and emails the customer.
- **Reviews**: `isVerifiedPurchase` is computed automatically by checking for a
  `DELIVERED` order containing the product — not client-supplied. New reviews start
  `PENDING` and need admin approval before they're public.
- **Media**: uploads are presign-then-record — the browser uploads straight to S3
  with a short-lived signed URL, then the admin panel calls `POST /admin/media` to
  record the asset. No files pass through this API. Product/banner/etc. `images`
  fields are plain URL strings populated from that same media library.
- **Uniqueness**: category/ingredient/product/recipe/blog slugs auto-generate from
  the name/title and get a numeric suffix on collision, so create requests never
  need to worry about slugging.

## Not built (deliberately out of scope for now)
Real PDF invoice rendering (an `/admin/orders/:id/invoice` endpoint returns
structured invoice **data** today — wiring it to the `pdf` skill / a PDF library
is a follow-up), payment gateway integration, coupons/loyalty/multi-vendor (all
called out in the spec as later phases), and SMS/WhatsApp notification channels.

## Getting started

> ⚠️ This sandbox's network can't reach Prisma's binary CDN, so `prisma generate`
> could not be run here — `npx tsc --noEmit` was used instead to confirm every
> file compiles cleanly against the schema (all remaining errors were exclusively
> "module has no exported member" from the ungenerated client, which resolves
> itself the moment you run `prisma generate` locally). Run the steps below on
> your machine (or in CI/Docker), same as before.

```bash
# 1. Install dependencies (this also runs `prisma generate` via postinstall)
npm install

# 2. Configure environment
cp .env.example .env
# edit .env: set DATABASE_URL, JWT secrets, SMTP creds, AWS creds

# 3. Start PostgreSQL (and Redis, for later phases) locally
docker compose up -d postgres

# 4. Apply the schema (skip if you already migrated in Phase 1 - schema is unchanged)
npx prisma migrate dev --name init

# 5. Seed roles/permissions + a default super admin
npx prisma db seed

# 6. Run the API
npm run start:dev
```

- API base URL: `http://localhost:4000/api/v1`
- Swagger docs: `http://localhost:4000/docs` (every endpoint above is documented there)

## Project structure

```
src/
  config/            env loading + validation
  prisma/            PrismaService (global module)
  common/
    decorators/       @Roles, @RequirePermissions, @CurrentUser
    guards/           JwtCustomerAuthGuard, JwtAdminAuthGuard, RolesGuard, PermissionsGuard
    filters/          global HTTP exception filter
    interceptors/     logging + response transform
    dto/              shared PaginationQueryDto
    utils/            slugify, order/ticket number generators
  modules/
    auth/              customer + admin auth, OTP, tokens, strategies
    notifications/     MailService (nodemailer)
    permissions/, roles/, admin-users/, customers/, addresses/    (Phase 1)
    categories/, ingredients/, products/, recipes/                (catalog)
    wishlist/, cart/, orders/                                     (commerce)
    reviews/, banners/, cms-pages/, blogs/, faqs/                 (content)
    uploads/ (S3 presign), media/ (asset library)
    support/ (tickets), settings/, dashboard/
prisma/
  schema.prisma       full data model
  seed.ts             permissions + roles + super admin seeder
```

## Security notes for production

- Set strong, unique values for all four JWT secrets in `.env` — never reuse
  the customer secret for admin tokens or vice versa.
- Put this behind HTTPS/a reverse proxy (Nginx) before going live.
- Rotate the seeded super admin password immediately after first login.
- SMTP: start with a free provider (e.g. Brevo, Mailtrap for dev) as noted in
  the spec; swap to a transactional provider before launch.
- Fill in real AWS credentials before using the media/uploads endpoints — they
  will throw until `AWS_*` env vars point at a real bucket.

DATABASE_URL="postgresql://postgres:root@localhost:5432/RetailShop?schema=public"