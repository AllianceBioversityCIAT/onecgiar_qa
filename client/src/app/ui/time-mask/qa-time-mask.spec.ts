import { maskTime } from './qa-time-mask';

describe('maskTime', () => {
  it('adds the colon after the hour while typing', () => {
    expect(maskTime('1')).toBe('1');
    expect(maskTime('13')).toBe('13:');
    expect(maskTime('13:3')).toBe('13:3');
    expect(maskTime('1330')).toBe('13:30');
  });

  it('pads a single-digit hour that cannot start a two-digit one', () => {
    expect(maskTime('9')).toBe('09:');
    expect(maskTime('930')).toBe('09:30');
  });

  it('drops letters and extra digits', () => {
    expect(maskTime('1a3b')).toBe('13:');
    expect(maskTime('123456')).toBe('12:34');
  });

  it('does not re-add the colon while deleting', () => {
    expect(maskTime('13', true)).toBe('13');
  });
});
