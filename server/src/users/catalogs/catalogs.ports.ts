/** A result type as the forms need it: the catalog key and its display name. */
export interface ResultTypeOption {
  key: string;
  name: string;
}

/** A Science Program: the canonical CLARISA id (D8), its code and its name. */
export interface ScienceProgramOption {
  id: number;
  code: string;
  name: string;
}

/** A grantable role (`PROGRAM` is never one, D6). */
export interface GrantableRoleOption {
  code: string;
  name: string;
  scopeType: 'global' | 'result_type' | 'program';
}

/** Source of result types (Reporting). Throws `UpstreamUnavailableError`. */
export interface ResultTypeSource {
  list(): Promise<ResultTypeOption[]>;
}

/** Source of Science Programs (CLARISA). Throws `UpstreamUnavailableError`. */
export interface ScienceProgramSource {
  list(): Promise<ScienceProgramOption[]>;
}

export const RESULT_TYPE_SOURCE = Symbol('RESULT_TYPE_SOURCE');
export const SCIENCE_PROGRAM_SOURCE = Symbol('SCIENCE_PROGRAM_SOURCE');

/** Time source of the catalog cache (ms); injectable so tests move it. */
export const CATALOG_CLOCK = Symbol('CATALOG_CLOCK');
