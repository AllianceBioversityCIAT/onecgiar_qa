import { routes } from '../../app.routes';
import { canAny } from './access-control';
import { navItems } from './nav-items';
import { Permission } from './role-definitions';

const menuFor = (assignments: Parameters<typeof canAny>[0]) =>
  navItems(routes, (p) => canAny(assignments, p)).map((i) => i.path);

describe('navItems (menu derived from the guarded routes)', () => {
  it('a guest sees only the read-only entries', () => {
    expect(menuFor([])).toEqual(['/', '/results']);
  });

  it('an admin sees the administration entries and no assessment roles', () => {
    expect(menuFor([{ role: 'ADMIN' }])).toEqual([
      '/',
      '/results',
      '/cycle',
      '/fields',
      '/assessors',
    ]);
  });

  it('a lead assessor sees the assessment entries, not administration', () => {
    expect(menuFor([{ role: 'LEAD_ASSESSOR', resultTypeKey: 'KP' }])).toEqual(['/', '/results']);
  });

  it('every entry carries the permission its route guard checks', () => {
    const items = navItems(routes, () => true);
    const byPath = new Map(items.map((i) => [i.path, i.permission]));
    for (const route of routes) {
      const permission = (route.data as { permission?: Permission } | undefined)?.permission;
      if (permission && route.path) expect(byPath.get('/' + route.path)).toBe(permission);
    }
  });
});
