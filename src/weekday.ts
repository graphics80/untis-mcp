// Weekday parsing and in-week date resolution for the classOnWeekDay tool.
// ISO convention: 1 = Montag … 7 = Sonntag.

const GERMAN_WEEKDAYS: Record<string, number> = {
  montag: 1,
  dienstag: 2,
  mittwoch: 3,
  donnerstag: 4,
  freitag: 5,
  samstag: 6,
  sonntag: 7,
};

// Index by ISO weekday (1–7); index 0 unused.
export const WEEKDAY_NAMES_ISO = [
  '',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag',
  'Sonntag',
] as const;

// Normalize a weekday given as German name (case-insensitive) or ISO number 1–7 → ISO 1–7.
export function parseWeekday(input: string | number): number {
  if (typeof input === 'number') {
    if (Number.isInteger(input) && input >= 1 && input <= 7) return input;
    throw new Error(`Invalid weekday number: ${input} (expected 1–7, 1 = Montag)`);
  }

  const key = input.trim().toLowerCase();
  if (key in GERMAN_WEEKDAYS) return GERMAN_WEEKDAYS[key];

  const n = Number(key);
  if (Number.isInteger(n) && n >= 1 && n <= 7) return n;

  throw new Error(`Invalid weekday: "${input}" (expected Montag–Sonntag or 1–7)`);
}

// Date of the given ISO weekday within the Monday–Sunday week containing the reference date.
// Uses local date fields throughout so the result is internally consistent.
export function dateForWeekdayInWeek(isoWeekday: number, reference: Date): Date {
  const ref = new Date(reference);
  const refIso = ref.getDay() === 0 ? 7 : ref.getDay(); // JS Sunday = 0 → 7
  const monday = new Date(ref);
  monday.setDate(ref.getDate() - (refIso - 1));
  const target = new Date(monday);
  target.setDate(monday.getDate() + (isoWeekday - 1));
  return target;
}

// Format a Date to YYYY-MM-DD using local date fields (not UTC).
export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
