/**
 * Boots the real application for end-to-end specs.
 *
 * Deliberately mirrors `src/main.ts`: the same global prefix, the same
 * ValidationPipe settings, the same cookie parser. A test harness that
 * configures the app differently from production tests something that does not
 * exist - the classic version being a ValidationPipe without
 * `forbidNonWhitelisted`, which makes every "rejects unknown field" spec pass
 * vacuously.
 *
 * What is NOT mirrored, and why:
 *  - Swagger, helmet and the static mount play no part in API behaviour here.
 *  - The throttle limit is raised, because the suite fires far more requests
 *    per minute than a human ever would and would otherwise fail on 429s that
 *    say nothing about correctness. Throttling itself is covered separately.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaService;
  /** Full path for a route, e.g. url('admin/products') -> '/api/v1/admin/products'. */
  url: (path: string) => string;
}

export async function createTestApp(): Promise<TestContext> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  const config = app.get(ConfigService);
  const prefix = config.get<string>('apiPrefix') || 'api/v1';

  app.use(cookieParser());
  app.setGlobalPrefix(prefix);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  await app.init();

  const prisma = app.get(PrismaService);
  await assertDisposableDatabase(prisma);

  return {
    app,
    prisma,
    url: (path: string) => `/${prefix}/${path.replace(/^\/+/, '')}`,
  };
}

/**
 * Asks the database itself what its name is.
 *
 * `setup-e2e.ts` already checks the connection string, but a string is a claim
 * about intent, not a fact about the connection. Config precedence between
 * `.env` and `.env.test` is exactly the kind of thing that quietly changes, and
 * the consequence here is destroying real data. This asks the server.
 */
async function assertDisposableDatabase(prisma: PrismaService): Promise<void> {
  const rows = await prisma.$queryRaw<{ current_database: string }[]>`SELECT current_database()`;
  const name = rows[0]?.current_database;

  if (!name?.endsWith('_test')) {
    throw new Error(
      `REFUSING TO RUN: connected to database "${name}", which does not end in _test. ` +
        'These specs delete rows.',
    );
  }
}

export async function closeTestApp(ctx: TestContext): Promise<void> {
  await ctx.prisma.$disconnect();
  await ctx.app.close();
}
