// Field labels as the catalog sends them, made unique where Reporting repeats one: the five
// "Which component of the Impact Area is this result intended to impact?" questions differ only by the
// tag they hang from (`general.<area>_impact_areas` ← `general.<area>_tag`). María Julia, 23-nov demo.

const IMPACT_AREAS: Readonly<Record<string, string>> = {
  gender: 'Gender equality, youth and social inclusion',
  climate: 'Climate adaptation and mitigation',
  nutrition: 'Nutrition, health and food security',
  environment: 'Environmental health and biodiversity',
  poverty: 'Poverty reduction, livelihoods and jobs',
};

const IMPACT_AREA_KEY = /^general\.([a-z]+)_impact_areas$/;

/** The label to show for a catalog field: its own, led by the Impact Area when the catalog repeats the question (first, so a cut-off row still tells them apart). */
export function fieldLabel(key: string, label: string): string {
  const area = IMPACT_AREAS[IMPACT_AREA_KEY.exec(key)?.[1] ?? ''];
  return area ? `${area} · ${label}` : label;
}
