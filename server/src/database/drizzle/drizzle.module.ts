import { Inject, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigModule, type ConfigType } from '@nestjs/config';
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import { createPool, type Pool } from 'mysql2/promise';
import { mysqlConfig } from '../../config/mysql.config.js';
import { DRIZZLE, MYSQL_POOL } from './drizzle.constants.js';
import * as schema from './schema/index.js';

export type DrizzleDB = MySql2Database<typeof schema>;

@Module({
  imports: [ConfigModule.forFeature(mysqlConfig)],
  providers: [
    {
      provide: MYSQL_POOL,
      inject: [mysqlConfig.KEY],
      useFactory: (config: ConfigType<typeof mysqlConfig>): Pool =>
        createPool({
          uri: config.url,
          connectionLimit: config.connectionLimit,
        }),
    },
    {
      provide: DRIZZLE,
      inject: [MYSQL_POOL],
      useFactory: (pool: Pool): DrizzleDB =>
        drizzle({ client: pool, schema, mode: 'default' }),
    },
  ],
  exports: [DRIZZLE],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor(@Inject(MYSQL_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
