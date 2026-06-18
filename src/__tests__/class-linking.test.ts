// Tests for the BZZ class-linking rule engine — pure functions, no mocks.
import { describe, it, expect } from 'vitest';
import {
  normalizeClassName,
  getCompanionNames,
  getCompanionClassIds,
  getIAYearsWithC,
  getIAVariants,
  iaNeedsDialog,
  resolveClassCompanions,
  buildClassMap,
  ClassLike,
} from '../class-linking.js';

// A realistic active-class set for one cohort year (24).
const CLASSES: ClassLike[] = [
  { id: 1, name: 'IA24 a' },
  { id: 2, name: 'IA24 b' },
  { id: 3, name: 'BM24 a' },
  { id: 4, name: 'BM24 b' },
  { id: 5, name: 'AB24 c' },
  { id: 6, name: 'ME24 a' },
  { id: 7, name: 'AB24 a' },
];

describe('normalizeClassName', () => {
  it('removes whitespace and lowercases', () => {
    expect(normalizeClassName('IA23 a')).toBe('ia23a');
    expect(normalizeClassName('IA 23 a')).toBe('ia23a');
    expect(normalizeClassName('ia23A')).toBe('ia23a');
  });
});

describe('getCompanionNames', () => {
  it('maps each rule to its companion display name(s)', () => {
    expect(getCompanionNames('ME24 a')).toEqual(['AB24 a']);
    expect(getCompanionNames('ME24 c')).toEqual(['BM24 c']);
    expect(getCompanionNames('ME24 e')).toEqual(['AB24 e']);
    expect(getCompanionNames('IA24 a')).toEqual(['BM24 a']);
    expect(getCompanionNames('IA24 c')).toEqual(['AB24 c']);
    expect(getCompanionNames('AB24 a')).toEqual(['ME24 a']);
    expect(getCompanionNames('AB24 c')).toEqual(['IA24 a', 'IA24 b']);
    expect(getCompanionNames('AB24 e')).toEqual(['ME24 e']);
    expect(getCompanionNames('BM24 a')).toEqual(['IA24 a']);
    expect(getCompanionNames('BM24 c')).toEqual(['ME24 c']);
    expect(getCompanionNames('BM24 e')).toEqual(['ME24 e']);
  });

  it('is whitespace/case-insensitive', () => {
    expect(getCompanionNames('bm24a')).toEqual(['IA24 a']);
  });

  it('returns [] when no rule matches', () => {
    expect(getCompanionNames('IM24 a')).toEqual([]);
    expect(getCompanionNames('XY99 z')).toEqual([]);
  });
});

describe('getCompanionClassIds', () => {
  it('resolves companion names to existing class ids', () => {
    expect(getCompanionClassIds('BM24 a', CLASSES)).toEqual([1]); // → IA24 a
    expect(getCompanionClassIds('AB24 c', CLASSES)).toEqual([1, 2]); // → IA24 a, IA24 b
  });

  it('silently skips companions that do not exist', () => {
    expect(getCompanionClassIds('ME24 a', CLASSES)).toEqual([7]); // AB24 a exists
    expect(getCompanionClassIds('ME24 c', CLASSES)).toEqual([]); // BM24 c absent
  });

  it('accepts a prebuilt map', () => {
    const map = buildClassMap(CLASSES);
    expect(getCompanionClassIds('BM24 a', map)).toEqual([1]);
  });
});

describe('getIAYearsWithC', () => {
  it('collects years that have an IA<year>c class', () => {
    const withC: ClassLike[] = [...CLASSES, { id: 8, name: 'IA24 c' }, { id: 9, name: 'IA25 a' }];
    expect(getIAYearsWithC(withC)).toEqual(new Set(['24']));
  });

  it('is empty when no IA c exists', () => {
    expect(getIAYearsWithC(CLASSES)).toEqual(new Set());
  });
});

describe('getIAVariants', () => {
  it('resolves the BM and ABU sides', () => {
    expect(getIAVariants('IA24 a', CLASSES)).toEqual({
      bm: { id: 3, name: 'BM24 a' },
      abu: { id: 5, name: 'AB24 c' },
    });
  });

  it('returns null sides when a side is missing', () => {
    const sparse: ClassLike[] = [{ id: 1, name: 'IA24 a' }];
    expect(getIAVariants('IA24 a', sparse)).toEqual({ bm: null, abu: null });
  });

  it('returns null for a non-IA name', () => {
    expect(getIAVariants('BM24 a', CLASSES)).toBeNull();
  });
});

describe('iaNeedsDialog', () => {
  it('is true only for IA a/b without an IA c in the year', () => {
    expect(iaNeedsDialog('IA24 a', new Set())).toBe(true);
    expect(iaNeedsDialog('IA24 b', new Set())).toBe(true);
  });

  it('is false when the year has an IA c', () => {
    expect(iaNeedsDialog('IA24 a', new Set(['24']))).toBe(false);
  });

  it('is false for IA c itself and for non-IA classes', () => {
    expect(iaNeedsDialog('IA24 c', new Set())).toBe(false);
    expect(iaNeedsDialog('BM24 a', new Set())).toBe(false);
  });
});

describe('resolveClassCompanions', () => {
  it('resolves a normal class', () => {
    const r = resolveClassCompanions({ id: 3, name: 'BM24 a' }, CLASSES);
    expect(r.variantChoiceRequired).toBe(false);
    expect(r.companionNames).toEqual(['IA24 a']);
    expect(r.fetchIds).toEqual([3, 1]);
  });

  it('resolves an IA a/b unambiguously when the year has an IA c', () => {
    const withC: ClassLike[] = [...CLASSES, { id: 8, name: 'IA24 c' }];
    const r = resolveClassCompanions({ id: 1, name: 'IA24 a' }, withC);
    expect(r.variantChoiceRequired).toBe(false);
    expect(r.companionNames).toEqual(['BM24 a']);
    expect(r.fetchIds).toEqual([1, 3]);
  });

  it('flags variantChoiceRequired for IA a/b without IA c and no variant', () => {
    const r = resolveClassCompanions({ id: 1, name: 'IA24 a' }, CLASSES);
    expect(r.variantChoiceRequired).toBe(true);
    expect(r.companionNames).toEqual([]);
    expect(r.fetchIds).toEqual([1]);
    expect(r.variants).toEqual({
      bm: { id: 3, name: 'BM24 a' },
      abu: { id: 5, name: 'AB24 c' },
    });
  });

  it('resolves the chosen BM variant', () => {
    const r = resolveClassCompanions({ id: 1, name: 'IA24 a' }, CLASSES, 'BM');
    expect(r.variantChoiceRequired).toBe(false);
    expect(r.variantApplied).toBe('BM');
    expect(r.companionNames).toEqual(['BM24 a']);
    expect(r.fetchIds).toEqual([1, 3]);
  });

  it('resolves the chosen ABU variant', () => {
    const r = resolveClassCompanions({ id: 1, name: 'IA24 a' }, CLASSES, 'ABU');
    expect(r.variantApplied).toBe('ABU');
    expect(r.companionNames).toEqual(['AB24 c']);
    expect(r.fetchIds).toEqual([1, 5]);
  });

  it('handles a class not present in the active list', () => {
    const r = resolveClassCompanions({ id: null, name: 'BM24 a' }, CLASSES);
    expect(r.classFound).toBe(false);
    expect(r.class).toBeNull();
    expect(r.companionNames).toEqual(['IA24 a']);
    expect(r.fetchIds).toEqual([1]); // companion only, no self id
  });
});
