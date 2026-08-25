export default () => ({
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  apiPrefix: process.env.API_PREFIX || 'api/v1',

  database: {
    url: process.env.DATABASE_URL,
  },

  jwt: {
    customer: {
      accessSecret: process.env.JWT_ACCESS_SECRET,
      accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      refreshSecret: process.env.JWT_REFRESH_SECRET,
      refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
    },
    admin: {
      accessSecret: process.env.ADMIN_JWT_ACCESS_SECRET,
      accessExpiresIn: process.env.ADMIN_JWT_ACCESS_EXPIRES_IN || '15m',
      refreshSecret: process.env.ADMIN_JWT_REFRESH_SECRET,
      refreshExpiresIn: process.env.ADMIN_JWT_REFRESH_EXPIRES_IN || '7d',
    },
  },

  otp: {
    expiryMinutes: parseInt(process.env.OTP_EXPIRY_MINUTES || '10', 10),
    maxAttempts: parseInt(process.env.OTP_MAX_ATTEMPTS || '5', 10),
    resendCooldownSeconds: parseInt(process.env.OTP_RESEND_COOLDOWN_SECONDS || '60', 10),
  },

  smtp: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM || 'Retail Shop <no-reply@retailshop.com>',
  },

  storage: {
    // 'local' | 's3' - see ADR 0008. S3 stays unimplemented until AWS is set up.
    driver: process.env.STORAGE_DRIVER || 'local',
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    // How stored files are addressed publicly. In production this is the API's
    // public origin (or a CDN in front of it), not localhost.
    publicBaseUrl: process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || '4000'}`,
    publicPathPrefix: '/uploads',
    maxImageSizeMb: parseInt(process.env.MAX_IMAGE_SIZE_MB || '5', 10),
    maxVideoSizeMb: parseInt(process.env.MAX_VIDEO_SIZE_MB || '200', 10),
    maxDocumentSizeMb: parseInt(process.env.MAX_DOCUMENT_SIZE_MB || '10', 10),
  },

  aws: {
    region: process.env.AWS_REGION,
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    bucket: process.env.AWS_S3_BUCKET,
  },

  cors: {
    // Note: this was previously `a || b || c`, which always evaluates to `a` -
    // the storefront/extra ports were never actually in the default list.
    origins: (process.env.CORS_ORIGINS || 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  },

  throttle: {
    ttl: parseInt(process.env.THROTTLE_TTL || '60', 10),
    limit: parseInt(process.env.THROTTLE_LIMIT || '100', 10),
  },
});
