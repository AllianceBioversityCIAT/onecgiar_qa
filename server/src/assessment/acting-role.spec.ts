// @akili-spec admin/acts-as-reviewer
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { actingRoleCodes, asCaller, parseActingRole } from './acting-role.js';

describe('X-Acting-Role header (admin/acts-as-reviewer)', () => {
  it('names the enabled reviewer roles only (TPB joined with P2-3916, PPU with P2-3917)', () => {
    expect(actingRoleCodes()).toEqual([
      'ASSESSOR',
      'LEAD_ASSESSOR',
      'TPB',
      'PPU',
    ]);
  });

  it('reads a role, absent or blank as no role', () => {
    expect(parseActingRole('ASSESSOR')).toBe('ASSESSOR');
    expect(parseActingRole(' LEAD_ASSESSOR ')).toBe('LEAD_ASSESSOR');
    expect(parseActingRole(['LEAD_ASSESSOR', 'ASSESSOR'])).toBe(
      'LEAD_ASSESSOR',
    );
    expect(parseActingRole('TPB')).toBe('TPB');
    expect(parseActingRole(undefined)).toBeUndefined();
    expect(parseActingRole('  ')).toBeUndefined();
  });

  it('refuses any other value with 400 VALIDATION_FAILED naming the header', () => {
    for (const bad of ['ADMIN', 'GUEST', 'assessor', 'ppu', 'X']) {
      let caught: unknown;
      try {
        parseActingRole(bad);
      } catch (error) {
        caught = error;
      }
      expect(caught, bad).toBeInstanceOf(BadRequestException);
      expect((caught as BadRequestException).getResponse()).toMatchObject({
        code: 'VALIDATION_FAILED',
        fields: [{ field: 'X-Acting-Role', code: 'INVALID' }],
      });
    }
  });

  it('adds the role to the caller only when one is named', () => {
    const user = { id: 1 } as Parameters<typeof asCaller>[0];
    expect(asCaller(user, undefined)).toBe(user);
    expect(asCaller(user, 'ASSESSOR')).toEqual({
      id: 1,
      actingRole: 'ASSESSOR',
    });
  });
});
