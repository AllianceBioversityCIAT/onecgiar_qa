import { fieldLabel } from './field-label';

describe('fieldLabel', () => {
  const q = 'Which component of the Impact Area is this result intended to impact?';

  it('names the Impact Area of each repeated question', () => {
    expect(fieldLabel('general.gender_impact_areas', q)).toBe(`Gender equality, youth and social inclusion · ${q}`);
    expect(fieldLabel('general.poverty_impact_areas', q)).toBe(`Poverty reduction, livelihoods and jobs · ${q}`);
  });

  it('leaves every other label as the catalog sends it', () => {
    expect(fieldLabel('general.title', 'Title')).toBe('Title');
    expect(fieldLabel('general.unknown_impact_areas', q)).toBe(q);
  });
});
