import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Keys served without authentication.
 *
 * This list is a disclosure boundary, not a convenience: anything named here is
 * readable by anyone on the internet. Adding a key is a deliberate act, and
 * `cms.e2e-spec.ts` pins the exact set so it cannot grow by accident.
 *
 * The storefront is required to carry no static content, so its entire chrome -
 * logo, announcement bar, USP strip, home section headings and footer - is
 * admin-managed and has to be readable here (SF-30, SF-31).
 *
 * `invoice_settings` was removed. It holds `{ invoicePrefix, gstNumber,
 * footerNote }`, nothing on the storefront reads it, and the admin settings
 * page reaches it through the authenticated `admin/settings` route instead.
 * A GSTIN is not secret, but `footerNote` is free text on an invoice - the
 * natural place for someone to paste bank details - and there was no reason for
 * any of it to be world-readable.
 */
const PUBLIC_KEYS = [
  'business_info',
  'social_links',
  'seo_defaults',
  'branding',
  'announcement',
  'usp_strip',
  'home_sections',
  'footer',
];

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async findAllAdmin() {
    const rows = await this.prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async findOne(key: string) {
    const setting = await this.prisma.setting.findUnique({ where: { key } });
    if (!setting) throw new NotFoundException(`Setting "${key}" not found`);
    return setting;
  }

  upsert(key: string, value: any) {
    return this.prisma.setting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }

  async findPublic() {
    const rows = await this.prisma.setting.findMany({ where: { key: { in: PUBLIC_KEYS } } });
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
}
