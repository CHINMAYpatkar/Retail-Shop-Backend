import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// Keys considered safe to expose without authentication (storefront needs these
// to render footer/contact/SEO defaults). Everything else stays admin-only.
const PUBLIC_KEYS = ['business_info', 'social_links', 'seo_defaults', 'invoice_settings'];

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
