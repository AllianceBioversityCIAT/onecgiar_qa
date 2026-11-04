import { describe, expect, it } from 'vitest';
import { classifyResult, DEFAULT_KP_RULES, KP_RULES } from './kp-classifier.js';

// Expected groups are literals from proposal 12.1 and FR-7.
const K = 'knowledge_product.';
const passing = (): Record<string, unknown> => ({
  [K + 'is_melia']: false,
  [K + 'type']: 'Journal Article',
  [K + 'issue_date_cg']: 2025,
  [K + 'issue_date_wos']: 2025,
  [K + 'is_isi_cg']: true,
  [K + 'is_isi_wos']: true,
  [K + 'peer_reviewed_cg']: true,
  [K + 'peer_reviewed_wos']: true,
  [K + 'accessibility_cg']: { accessibility: 'Open Access' },
  [K + 'accessibility_wos']: 'Open Access',
});
const kp = (overrides: Record<string, unknown>, drop: string[] = []) => {
  const values = { ...passing(), ...overrides };
  for (const key of drop) delete values[K + key];
  return classifyResult({ resultTypeKey: 'knowledge_product', values });
};

const AUTO = {
  status: 'auto_validated',
  kpGroup: 'auto_checked',
  awaitsStep: null,
};
const REVIEW = { status: 'pending', kpGroup: 'review', awaitsStep: null };
const NOT_IN_QA = {
  status: 'not_in_qa',
  kpGroup: 'not_in_qa',
  awaitsStep: null,
};

describe('classifyResult: proposal 12.1 table', () => {
  it.each([
    ['journal article, all equal', {}, AUTO],
    [
      'MELIA journal article that meets the check',
      { [K + 'is_melia']: true },
      AUTO,
    ],
    ['not MELIA, other type', { [K + 'type']: 'Book Chapter' }, NOT_IN_QA],
    [
      'MELIA, other type',
      { [K + 'is_melia']: true, [K + 'type']: 'Book Chapter' },
      REVIEW,
    ],
    [
      'MELIA journal article, years differ',
      { [K + 'is_melia']: true, [K + 'issue_date_wos']: 2024 },
      REVIEW,
    ],
    [
      'not MELIA journal article, years differ',
      { [K + 'issue_date_wos']: 2024 },
      REVIEW,
    ],
    ['journal article, ISI 0 on CG', { [K + 'is_isi_cg']: false }, REVIEW],
    ['journal article, ISI 0 on WoS', { [K + 'is_isi_wos']: false }, REVIEW],
    [
      'journal article, peer reviewed 0 on CG',
      { [K + 'peer_reviewed_cg']: false },
      REVIEW,
    ],
    [
      'journal article, peer reviewed 0 on WoS',
      { [K + 'peer_reviewed_wos']: false },
      REVIEW,
    ],
    [
      'journal article, accessibility differs',
      { [K + 'accessibility_wos']: 'Closed' },
      REVIEW,
    ],
    [
      'ISI and peer reviewed as 1',
      {
        [K + 'is_isi_cg']: 1,
        [K + 'is_isi_wos']: 1,
        [K + 'peer_reviewed_cg']: 1,
        [K + 'peer_reviewed_wos']: 1,
      },
      AUTO,
    ],
    ['ISI as 2 is not true', { [K + 'is_isi_cg']: 2 }, REVIEW],
    [
      'type "journal article" lower case',
      { [K + 'type']: 'journal article' },
      AUTO,
    ],
    [
      'type " JOURNAL ARTICLE " padded',
      { [K + 'type']: ' JOURNAL ARTICLE ' },
      AUTO,
    ],
    [
      'years as dates',
      {
        [K + 'issue_date_cg']: '2025-03-01',
        [K + 'issue_date_wos']: '2025-11-30',
      },
      AUTO,
    ],
    ['no type, not MELIA', { [K + 'type']: null }, NOT_IN_QA],
  ])('%s', (_name, overrides, expected) => {
    expect(kp(overrides)).toEqual(expected);
  });
});

describe('classifyResult: accessibility', () => {
  it('"Open Access" equals "open access " ignoring case and trailing spaces', () => {
    expect(
      kp({
        [K + 'accessibility_cg']: { accessibility: 'Open Access' },
        [K + 'accessibility_wos']: 'open access ',
      }),
    ).toEqual(AUTO);
  });
  it('leading spaces are ignored too', () => {
    expect(kp({ [K + 'accessibility_wos']: '  OPEN ACCESS' })).toEqual(AUTO);
  });
});

describe('classifyResult: a null or a missing key fails the check', () => {
  it.each([
    ['issue_date_cg'],
    ['issue_date_wos'],
    ['is_isi_cg'],
    ['is_isi_wos'],
    ['peer_reviewed_cg'],
    ['peer_reviewed_wos'],
    ['accessibility_wos'],
  ])('null %s', (key) => {
    expect(kp({ [K + key]: null })).toEqual(REVIEW);
  });
  it('null accessibility inside the CG object', () => {
    expect(kp({ [K + 'accessibility_cg']: { accessibility: null } })).toEqual(
      REVIEW,
    );
  });
  it('null CG accessibility object', () => {
    expect(kp({ [K + 'accessibility_cg']: null })).toEqual(REVIEW);
  });
  it('two null years are not equal', () => {
    expect(
      kp({ [K + 'issue_date_cg']: null, [K + 'issue_date_wos']: null }),
    ).toEqual(REVIEW);
  });
  it('two null accessibilities are not equal', () => {
    expect(
      kp({
        [K + 'accessibility_cg']: { accessibility: null },
        [K + 'accessibility_wos']: null,
      }),
    ).toEqual(REVIEW);
  });
  it.each([
    ['issue_date_wos'],
    ['is_isi_cg'],
    ['peer_reviewed_wos'],
    ['accessibility_cg'],
  ])('missing key %s', (key) => {
    expect(kp({}, [key])).toEqual(REVIEW);
  });
});

describe('classifyResult: non-KP and wiring', () => {
  it('a policy change is pending with no marker', () => {
    expect(
      classifyResult({ resultTypeKey: 'policy_change', values: passing() }),
    ).toEqual({
      status: 'pending',
      kpGroup: null,
      awaitsStep: null,
    });
  });
  it('the default rule source classifies', () => {
    expect(typeof KP_RULES).toBe('symbol');
    expect(
      DEFAULT_KP_RULES.classify({
        resultTypeKey: 'knowledge_product',
        values: passing(),
      }),
    ).toEqual(AUTO);
  });
});
