// @akili-spec assessment/ai-suggestions
/** The shape of the worker's `contract/production.json` (contract 2.0.0). */
export type AiValueKind = 'level' | 'category' | 'use_numbers';
export type AiSignalType = 'scored' | 'indicative';

export interface AiProductionField {
  /** The prompt version of THIS field: scored and indicative fields differ. */
  promptVersion: string;
  valueKind: AiValueKind;
  signal: AiSignalType;
  scale?: { min: number; max: number };
  /** Other catalog fields one suggestion covers (innovation use numbers). */
  coversFieldKeys?: readonly string[];
}

export interface AiProductionContract {
  contractVersion: string;
  /** In the worker's order; the API reads fields and versions from here, never hard-coded. */
  fields: Readonly<Record<string, AiProductionField>>;
}
