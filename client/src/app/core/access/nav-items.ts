import { Routes } from '@angular/router';
import { AccessRouteData } from './permission-guard';
import { Permission } from './role-definitions';

/** Menu entry declared on the route itself, so the menu and the guard read the same definition. */
export interface NavRouteData extends AccessRouteData {
  readonly nav?: {
    readonly label: string;
    readonly group: 'assessment' | 'administration';
    readonly order: number;
  };
}

export interface NavItem {
  readonly path: string;
  readonly label: string;
  readonly group: 'assessment' | 'administration';
  readonly permission: Permission;
}

/**
 * Builds the shell navigation from the route table, keeping only what `canAny` allows.
 * A route without `data.nav` is not a menu entry; one without `data.permission` needs only READ.
 */
export function navItems(routes: Routes, canAny: (permission: Permission) => boolean): NavItem[] {
  return collect(routes, canAny, '')
    .sort((a, b) => a.order - b.order)
    .map(({ order: _order, ...item }) => item);
}

function collect(
  routes: Routes,
  canAny: (permission: Permission) => boolean,
  parent: string,
): (NavItem & { order: number })[] {
  const items: (NavItem & { order: number })[] = [];
  for (const route of routes) {
    const path = [parent, route.path].filter(Boolean).join('/');
    const data = route.data as NavRouteData | undefined;
    if (data?.nav) {
      const permission = data.permission ?? Permission.READ;
      if (canAny(permission)) {
        items.push({
          path: '/' + path,
          label: data.nav.label,
          group: data.nav.group,
          permission,
          order: data.nav.order,
        });
      }
    }
    if (route.children) items.push(...collect(route.children, canAny, path));
  }
  return items;
}
