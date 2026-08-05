import { plainToInstance } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumberString, IsOptional, validateSync } from 'class-validator';

enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

class EnvironmentVariables {
  @IsEnum(NodeEnv)
  @IsOptional()
  NODE_ENV: NodeEnv;

  @IsNumberString()
  @IsOptional()
  PORT: string;

  @IsNotEmpty()
  DATABASE_URL: string;

  @IsNotEmpty()
  JWT_ACCESS_SECRET: string;

  @IsNotEmpty()
  JWT_REFRESH_SECRET: string;

  @IsNotEmpty()
  ADMIN_JWT_ACCESS_SECRET: string;

  @IsNotEmpty()
  ADMIN_JWT_REFRESH_SECRET: string;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });
  const errors = validateSync(validatedConfig, { skipMissingProperties: false });

  if (errors.length > 0) {
    throw new Error(
      `Environment validation failed:\n${errors
        .map((e) => Object.values(e.constraints || {}).join(', '))
        .join('\n')}`,
    );
  }
  return validatedConfig;
}
