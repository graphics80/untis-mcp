// BZZ class-linking ("Partnerklasse") rule engine.
//
// At the BZZ a vocational class attends lessons that are kept under several
// separate WebUntis classes (Fachunterricht, Berufsmaturität BM, Allgemein-
// bildung ABU/AB). A cancellation in one of those companion classes also
// affects the main class, so to build a complete cancellation calendar the
// timetables of the linked classes must be merged. This module resolves, for a
// single class, the display names and WebUntis IDs of its companion classes.
//
// Tracks (prefixes): IA (Informatik App-Entwicklung), ME (Mediamatik),
// IM (Informatik Mittelschule), BM (Berufsmaturität), AB (Allgemeinbildung).
// Class name format: <TRACK><YEAR><SUFFIX>, e.g. "IA23a", "ME24 c", "BM23 a".
// Whitespace and case are irrelevant: "IA23a" == "IA 23 a" == "ia23A".

export interface ClassLike {
  id: number;
  name: string;
  longName?: string;
}

// Whitespace removal + lowercase. Used for both matching and lookup so that
// "IA23 a", "IA 23 a" and "ia23A" all collapse to the same key "ia23a".
export function normalizeClassName(name: string): string {
  return name.toLowerCase().replace(/\s+/g, '');
}

// Declarative linking rules. `match` runs against the normalized name; capture
// $1 = year digits, $2 = suffix letter(s). `companions` are display-name
// templates with $1/$2 substituted. The first matching rule wins. A class can
// have multiple companions. Rules are kept bidirectionally so a link resolves
// from either side; they are independent entries (no automatic inversion).
const RULES: Array<{ match: RegExp; companions: string[] }> = [
  { match: /^me(\d+)([ab])$/, companions: ['AB$1 $2'] },
  { match: /^me(\d+)([cd])$/, companions: ['BM$1 $2'] },
  { match: /^me(\d+)([ef])$/, companions: ['AB$1 $2'] },
  { match: /^ia(\d+)([ab])$/, companions: ['BM$1 $2'] },
  { match: /^ia(\d+)(c)$/, companions: ['AB$1 c'] },
  { match: /^ab(\d+)([ab])$/, companions: ['ME$1 $2'] },
  { match: /^ab(\d+)(c)$/, companions: ['IA$1 a', 'IA$1 b'] },
  { match: /^ab(\d+)([ef])$/, companions: ['ME$1 $2'] },
  { match: /^bm(\d+)([ab])$/, companions: ['IA$1 $2'] },
  { match: /^bm(\d+)([cd])$/, companions: ['ME$1 $2'] },
  { match: /^bm(\d+)([ef])$/, companions: ['ME$1 $2'] },
];

// Find the first matching rule and expand its companion templates into display
// names (e.g. template "BM$1 $2" + captures ["23","a"] → "BM23 a"). Returns []
// when no rule matches.
export function getCompanionNames(className: string): string[] {
  const norm = normalizeClassName(className);
  for (const rule of RULES) {
    const m = rule.match.exec(norm);
    if (m) {
      return rule.companions.map((t) =>
        t.replace(/\$1/g, m[1]).replace(/\$2/g, m[2] ?? ''),
      );
    }
  }
  return [];
}

// Index classes by normalized name for O(1) lookup. Pass this into the lookup
// helpers to avoid quadratic re-normalization when resolving many classes.
export function buildClassMap(classes: ClassLike[]): Map<string, ClassLike> {
  const map = new Map<string, ClassLike>();
  for (const c of classes) map.set(normalizeClassName(c.name), c);
  return map;
}

function asMap(classes: ClassLike[] | Map<string, ClassLike>): Map<string, ClassLike> {
  return classes instanceof Map ? classes : buildClassMap(classes);
}

// Resolve a class's companion display names to the real WebUntis classes and
// return their IDs. Non-existent companion classes are silently skipped.
export function getCompanionClassIds(
  className: string,
  classes: ClassLike[] | Map<string, ClassLike>,
): number[] {
  const map = asMap(classes);
  const ids: number[] = [];
  for (const name of getCompanionNames(className)) {
    const c = map.get(normalizeClassName(name));
    if (c) ids.push(c.id);
  }
  return ids;
}

// Years for which an "IA<year>c" class exists. Used to decide whether an
// IA a/b class needs a manual BM/ABU variant choice.
export function getIAYearsWithC(classes: ClassLike[]): Set<string> {
  const set = new Set<string>();
  for (const c of classes) {
    const m = /^ia(\d+)c$/.exec(normalizeClassName(c.name));
    if (m) set.add(m[1]);
  }
  return set;
}

// Resolve the two possible companion sides of an IA class:
//   BM side:  "BM<year> <suffix>"
//   ABU side: "AB<year> c"
// Each side is null when that class does not exist. Returns null if the given
// name is not an IA<year><letter> class.
export function getIAVariants(
  iaName: string,
  classes: ClassLike[] | Map<string, ClassLike>,
): { bm: ClassLike | null; abu: ClassLike | null } | null {
  const m = /^ia(\d+)([a-z])$/.exec(normalizeClassName(iaName));
  if (!m) return null;
  const [, year, suffix] = m;
  const map = asMap(classes);
  return {
    bm: map.get(normalizeClassName(`BM${year}${suffix}`)) ?? null,
    abu: map.get(normalizeClassName(`AB${year}c`)) ?? null,
  };
}

// True ONLY for "IA<year>a/b" whose year has no "IA<year>c". Without a "c"
// class the ABU pairing between a and b is ambiguous, so the user must choose
// the variant (BM or ABU) manually. With a "c" the mapping is unambiguous.
export function iaNeedsDialog(name: string, yearsWithC: Set<string>): boolean {
  const m = /^ia(\d+)([ab])$/.exec(normalizeClassName(name));
  if (!m) return false;
  return !yearsWithC.has(m[1]);
}

export interface CompanionResolution {
  class: { id: number; name: string } | null;
  classFound: boolean;
  companionNames: string[];
  fetchIds: number[];
  variantChoiceRequired: boolean;
  variants?: {
    bm: { id: number; name: string } | null;
    abu: { id: number; name: string } | null;
  };
  variantApplied?: 'BM' | 'ABU';
}

const slim = (c: ClassLike | null): { id: number; name: string } | null =>
  c ? { id: c.id, name: c.name } : null;

// Resolve companions for a single class.
//   `self` is the class to resolve. It may be a real class (found in the active
//   list) or just a name (when the lookup name isn't an active class).
//   `selfId` is self's WebUntis id, or null when self isn't an active class.
// IA a/b without an IA c in its year is the special case: without an explicit
// `variant` the result flags `variantChoiceRequired` and exposes both options
// so the caller can ask the user; with a `variant` the chosen side is resolved.
export function resolveClassCompanions(
  self: { id: number | null; name: string },
  classes: ClassLike[] | Map<string, ClassLike>,
  variant?: 'BM' | 'ABU',
): CompanionResolution {
  const map = asMap(classes);
  const yearsWithC = getIAYearsWithC([...map.values()]);
  const selfFound = self.id !== null;
  const selfSlim = selfFound ? { id: self.id as number, name: self.name } : null;
  const baseFetchIds = selfFound ? [self.id as number] : [];

  if (iaNeedsDialog(self.name, yearsWithC)) {
    const variants = getIAVariants(self.name, map) ?? { bm: null, abu: null };
    if (!variant) {
      return {
        class: selfSlim,
        classFound: selfFound,
        companionNames: [],
        fetchIds: baseFetchIds,
        variantChoiceRequired: true,
        variants: { bm: slim(variants.bm), abu: slim(variants.abu) },
      };
    }
    const chosen = variant === 'BM' ? variants.bm : variants.abu;
    return {
      class: selfSlim,
      classFound: selfFound,
      companionNames: chosen ? [chosen.name] : [],
      fetchIds: chosen ? [...baseFetchIds, chosen.id] : baseFetchIds,
      variantChoiceRequired: false,
      variantApplied: variant,
    };
  }

  const companionNames = getCompanionNames(self.name);
  const companionIds = getCompanionClassIds(self.name, map);
  return {
    class: selfSlim,
    classFound: selfFound,
    companionNames,
    fetchIds: [...baseFetchIds, ...companionIds],
    variantChoiceRequired: false,
  };
}
