import { registerAs } from '@nestjs/config';

export const mysqlConfig = registerAs('mysql', () => ({
  url: process.env.DATABASE_URL!,
  connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 10),
}));
