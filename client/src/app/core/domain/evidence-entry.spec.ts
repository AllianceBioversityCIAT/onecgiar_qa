import { formatValue } from '../../pages/workspace/review/review.mapper';
import { valueLines } from '../../pages/sp/sp-format';
import { evidenceEntry } from './evidence-entry';

/** As Reporting sends one evidence (qatest 10151, 24-nov-2026), plus the F-022 fields. */
const evidence = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  source: 0,
  link: 'https://cgspace.cgiar.org/handle/1',
  is_public_file: false,
  file_name: null,
  gender_related: false,
  climate_related: true,
  innovation_use_related: null,
  knowledge_product_related_flag: null,
  description: 'Table 3, page 12',
  ...over,
});
const labels = { evidence_sources: { '0': 'Link' } };

describe('evidenceEntry (F-022)', () => {
  it('drops the *_related flags, tags a private link and reads description as "Where to find it"', () => {
    expect(evidenceEntry(evidence())).toEqual({
      source: 0,
      link: 'https://cgspace.cgiar.org/handle/1 (Private)',
      file_name: null,
      where_to_find_it: 'Table 3, page 12',
    });
  });

  it('leaves a public or unknown file without the tag', () => {
    expect(evidenceEntry(evidence({ is_public_file: true }))['link']).toBe('https://cgspace.cgiar.org/handle/1');
    expect(evidenceEntry(evidence({ is_public_file: null }))['link']).toBe('https://cgspace.cgiar.org/handle/1');
  });

  it('tags the uploaded file when there is no link, and says Private when there is neither', () => {
    expect(evidenceEntry(evidence({ link: null, file_url: 'https://files/x.pdf' }))['file_url']).toBe('https://files/x.pdf (Private)');
    expect(evidenceEntry(evidence({ link: '' }))['access']).toBe('Private');
  });

  it('returns any other object as it came', () => {
    const toc = { level: 1, target: 4 };
    expect(evidenceEntry(toc)).toBe(toc);
  });
});

describe('evidence on both screens (F-022)', () => {
  it('Review reads the evidence without the flags', () => {
    expect(formatValue({ value: [evidence()], labels, notApplicable: false, subfieldLists: { source: 'evidence_sources' } })).toBe(
      'Source: Link · Link: https://cgspace.cgiar.org/handle/1 (Private) · Where to find it: Table 3, page 12',
    );
  });

  it('the Science Program view reads it the same way', () => {
    expect(valueLines([evidence()], labels)).toEqual([
      { label: null, text: 'Source: Link · Link: https://cgspace.cgiar.org/handle/1 (Private) · Where to find it: Table 3, page 12' },
    ]);
  });
});
