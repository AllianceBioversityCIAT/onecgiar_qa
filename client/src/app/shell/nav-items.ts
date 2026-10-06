/** Main navigation, as defined by the "QA Platform" mockup. */
export interface NavItem {
  readonly label: string;
  readonly path: string;
  /** SVG path data, 24x24 viewBox, stroked. */
  readonly icon: string;
}

export interface NavGroup {
  readonly label: string;
  readonly items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Assessment',
    items: [
      {
        label: 'Overview',
        path: '/overview',
        icon: 'M4 4h6v8H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 16h6v4H4z',
      },
      {
        label: 'Results',
        path: '/results',
        icon: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9.5 14.5l2 2 3.5-4',
      },
    ],
  },
  {
    // Mockup: only the QA lead sees this group. The stub auth has no roles yet, so it is shown
    // to everyone until roles exist (Yeck, 2026-10-06).
    label: 'Administration',
    items: [
      {
        label: 'Cycle',
        path: '/cycle',
        icon: 'M8 3v4M16 3v4M4 10h16M6 5h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
      },
      {
        label: 'Fields',
        path: '/fields',
        icon: 'M20 6h-8M8 6H4M20 12h-4M12 12H4M20 18h-8M8 18H4M10 4v4M14 10v4M10 16v4',
      },
      {
        label: 'Assessors',
        path: '/assessors',
        icon: 'M15 20v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 3 18.5V20M12.5 8a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0M21 20v-1.5a3.5 3.5 0 0 0-2.5-3.35M15.5 4.65a3.5 3.5 0 0 1 0 6.7',
      },
    ],
  },
];
