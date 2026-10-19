import { registerAs } from '@nestjs/config';

/**
 * Upstream catalog sources (user-management design § 9): the Reporting API
 * (result types) and CLARISA (Science Programs). Base URLs (validated as
 * `https://` in `validateEnv`) and the shared API key.
 */
export const catalogsConfig = registerAs('catalogs', () => ({
  reportingApiUrl: process.env.REPORTING_API_URL!,
  clarisaApiUrl: process.env.CLARISA_API_URL!,
  // Secret: read only here, never logged. Same key for both sources; sent only to Reporting.
  apiKey: process.env.CLARISA_API_KEY!,
}));
