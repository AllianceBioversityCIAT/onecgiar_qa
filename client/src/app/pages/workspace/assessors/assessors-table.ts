/**
 * Responsive team table, driven by the width of the table container (`@container`):
 * - < 640px: stacked person cards (no header row; ⋯ pinned top-right, role + result types on one line, progress below).
 * - 640–949px: four columns; the role sits under the person.
 * - >= 950px: the five mockup columns.
 */
export const CELL = {
  row:
    'relative grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 bg-(--surface) px-4 py-3 hover:bg-(--surface-2) ' +
    '@min-[640px]:min-h-24 @min-[640px]:grid-cols-[minmax(0,1fr)_minmax(0,200px)_minmax(0,210px)_32px] @min-[640px]:gap-y-0.5 @min-[640px]:px-5 @min-[640px]:py-2 ' +
    '@min-[950px]:grid-cols-[minmax(0,1fr)_160px_220px_260px_32px] @min-[950px]:gap-y-0',
  person:
    'col-span-2 row-start-1 pr-10 @min-[640px]:col-span-1 @min-[640px]:col-start-1 @min-[640px]:self-end @min-[640px]:pr-0 @min-[950px]:self-stretch',
  role:
    'col-start-1 row-start-2 ml-[30px] justify-self-start @min-[640px]:self-start ' +
    '@min-[950px]:col-start-2 @min-[950px]:row-start-1 @min-[950px]:ml-0 @min-[950px]:self-center @min-[950px]:justify-self-stretch',
  types:
    'col-start-2 row-start-2 @min-[640px]:col-start-2 @min-[640px]:row-span-2 @min-[640px]:row-start-1 ' +
    '@min-[950px]:col-start-3 @min-[950px]:row-span-1',
  progress:
    'col-span-2 row-start-3 ml-[38px] max-w-[360px] @min-[640px]:col-span-1 @min-[640px]:col-start-3 @min-[640px]:row-span-2 @min-[640px]:row-start-1 @min-[640px]:ml-0 @min-[640px]:max-w-none ' +
    '@min-[950px]:col-start-4 @min-[950px]:row-span-1',
  menu:
    'absolute top-2 right-2 @min-[640px]:relative @min-[640px]:col-start-4 @min-[640px]:row-span-2 @min-[640px]:row-start-1 @min-[640px]:justify-self-end ' +
    '@min-[950px]:col-start-5 @min-[950px]:row-span-1',
} as const;
