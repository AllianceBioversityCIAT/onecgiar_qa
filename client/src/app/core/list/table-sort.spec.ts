import { TableSort } from './table-sort';

type Key = 'name' | 'score';
const rows = [
  { name: 'b', score: 2 },
  { name: 'a', score: 3 },
  { name: 'c', score: 1 },
];
const value = (r: (typeof rows)[number], k: Key) => r[k];

describe('TableSort', () => {
  it('keeps the given order until a column is picked', () => {
    const sort = new TableSort<Key>();
    expect(sort.apply(rows, value)).toBe(rows);
    expect(sort.ariaSort('name')).toBe('none');
  });

  it('starts a new column ascending and flips the active one', () => {
    const sort = new TableSort<Key>();
    sort.toggle('name');
    expect(sort.apply(rows, value).map((r) => r.name)).toEqual(['a', 'b', 'c']);
    expect(sort.ariaSort('name')).toBe('ascending');
    sort.toggle('name');
    expect(sort.apply(rows, value).map((r) => r.name)).toEqual(['c', 'b', 'a']);
    sort.toggle('score');
    expect(sort.dir()).toBe('asc');
    expect(sort.ariaSort('name')).toBe('none');
    expect(sort.apply(rows, value).map((r) => r.score)).toEqual([1, 2, 3]);
  });

  it('takes an explicit pick and goes back to the default order with null', () => {
    const sort = new TableSort<Key>();
    sort.set({ key: 'score', dir: 'desc' });
    expect(sort.apply(rows, value).map((r) => r.score)).toEqual([3, 2, 1]);
    sort.set(null);
    expect(sort.key()).toBeNull();
    expect(sort.dir()).toBe('asc');
  });

  it('never mutates the input', () => {
    const sort = new TableSort<Key>();
    sort.toggle('name');
    sort.apply(rows, value);
    expect(rows.map((r) => r.name)).toEqual(['b', 'a', 'c']);
  });
});
