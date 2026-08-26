import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { LocalDiskDriver } from './modules/storage/local-disk.driver';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: false });
  const config = app.get(ConfigService);

  app.use(
    helmet({
      // helmet's default is `same-origin`, which blocks any cross-origin load
      // of a static asset. Both frontends (admin on :3000, storefront on :3001)
      // fetch images and video from this API on :4000, so with the default
      // EVERY image silently fails to render - no console error that points at
      // the cause, just broken images. See ADR 0008.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());

  app.enableCors({
    origin: config.get<string[]>('cors.origins'),
    credentials: true,
  });

  app.setGlobalPrefix(config.get<string>('apiPrefix')!);

  // Serve uploaded media. Mounted on the PUBLIC subtree only - private assets
  // (bill and receipt scans) live in a sibling directory that is deliberately
  // not reachable from here, so a misconfigured guard elsewhere cannot expose
  // them. The prefix sits outside the API prefix: these are files, not API
  // resources, and their URLs are persisted indirectly via storage keys.
  const localDisk = app.get(LocalDiskDriver);
  app.useStaticAssets(localDisk.getPublicRoot(), {
    prefix: localDisk.getPublicPathPrefix(),
    index: false,
    redirect: false,
    setHeaders: (res) => {
      // Filenames are content-addressed UUIDs and are never reused, so a long
      // cache is safe: a changed image is always a new URL.
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      // Belt-and-braces: a stored file must never be interpreted as markup.
      res.setHeader('X-Content-Type-Options', 'nosniff');
    },
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Retail Shop API')
    .setDescription('Home-made Spices E-commerce Platform - Backend API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = config.get<number>('port')!;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`🚀 API running on http://localhost:${port}/${config.get('apiPrefix')}`);
  // eslint-disable-next-line no-console
  console.log(`📘 Swagger docs on http://localhost:${port}/docs`);
}

bootstrap();
