/**
 * The only time source of the admin-config services (NFR-4, design 7.7). Bound
 * to `() => new Date()`; the e2e suites override it to pin "today in Rome".
 */
export const ADMIN_CONFIG_CLOCK = Symbol('ADMIN_CONFIG_CLOCK');

export type AdminConfigClock = () => Date;
