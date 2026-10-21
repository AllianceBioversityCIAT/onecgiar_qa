import { signal } from '@angular/core';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** Compares two cell values for sorting: numbers by value, text as is. */
export function compareValues(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Column sort state shared by every list page (Results, Assessors…): which column, which
 * direction, the header click rule and the aria-sort value. Create one per list, in the view.
 */
export class TableSort<K extends string> {
  readonly key = signal<K | null>(null);
  readonly dir = signal<SortDir>('asc');

  /** Header click: a new column starts ascending; the active column flips. */
  toggle(key: K): void {
    const active = this.key() === key;
    this.dir.set(active && this.dir() === 'asc' ? 'desc' : 'asc');
    this.key.set(key);
  }

  /** Explicit pick (card-mode "Sort by"); null = back to the list's own order. */
  set(sort: SortState<K> | null): void {
    this.key.set(sort?.key ?? null);
    this.dir.set(sort?.dir ?? 'asc');
  }

  ariaSort(key: K): 'ascending' | 'descending' | 'none' {
    if (this.key() !== key) return 'none';
    return this.dir() === 'asc' ? 'ascending' : 'descending';
  }

  /** Sorted copy of rows; reads the signals, so call it inside a computed. No column = rows as given. */
  apply<T>(rows: readonly T[], value: (row: T, key: K) => string | number): readonly T[] {
    const key = this.key();
    if (!key) return rows;
    const dir = this.dir() === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => compareValues(value(a, key), value(b, key)) * dir);
  }
}
