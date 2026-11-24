// @akili-spec admin-config/field-configuration
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import {
  DRIZZLE,
  MYSQL_POOL,
} from '../../database/drizzle/drizzle.constants.js';
import {
  FIELD_CONFIG_EFFECTIVE,
  FieldConfigModule,
} from './field-config.module.js';
import { FieldConfigService } from './field-config.service.js';

describe('FieldConfigModule wiring (P-6, T-2 forward pointer)', () => {
  it('resolves every provider of the read flows, including the catalog client that needs the clock and the catalogs config, and exports only the effective port', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [FieldConfigModule],
    })
      .overrideProvider(MYSQL_POOL)
      .useValue({ end: async () => undefined })
      .overrideProvider(DRIZZLE)
      .useValue({})
      .compile();

    const effective = moduleRef.get(FIELD_CONFIG_EFFECTIVE);
    expect(effective).toBeInstanceOf(FieldConfigService);
    expect(Reflect.getMetadata('exports', FieldConfigModule)).toEqual([
      FIELD_CONFIG_EFFECTIVE,
    ]);
    await moduleRef.close();
  });
});
