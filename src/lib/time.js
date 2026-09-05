// Timezone-correct calendar-day helpers.
//
// Every date boundary in LeetTrack goes through here. A day key is a plain
// calendar date string, "YYYY-MM-DD", in the user's chosen timezone. Once we
// have a key, all arithmetic on it is done in UTC so DST transitions can never
// add or drop a day.
//
// A "day" does not have to start at midnight. `dayStartHour` moves the
// boundary later — with 2, anything solved between 00:00 and 01:59 is filed
// under the previous day, because a 1am solve is the tail of last night's
// session, not the start of a new one. The shift is applied to the *wall
// clock* hour in the target zone, not by subtracting hours from the instant,
// so a DST jump can't slide a solve into the wrong day.

const PARTS_FMT = new Map();

function partsFormatter(timeZone) {
  let fmt = PARTS_FMT.get(timeZone);
  if (!fmt) {
    // en-CA formats as YYYY-MM-DD, which is also lexicographically sortable.
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hourCycle: 'h23',
    });
    PARTS_FMT.set(timeZone, fmt);
  }
  return fmt;
}

/** Clamp anything to a usable 0..23 day-start hour. */
export function normaliseHour(value, fallback = 0) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) && n >= 0 && n <= 23 ? n : fallback;
}

/** Day key for an instant, in the given IANA timezone. */
export function dayKey(date, timeZone, dayStartHour = 0) {
  const parts = {};
  for (const { type, value } of partsFormatter(timeZone).formatToParts(date)) {
    parts[type] = value;
  }
  const key = `${parts.year}-${parts.month}-${parts.day}`;
  const start = normaliseHour(dayStartHour, 0);
  if (!start) return key;
  // Some engines render midnight as "24" under an h23 request; % 24 pins it.
  return Number(parts.hour) % 24 < start ? addDays(key, -1) : key;
}

export function todayKey(timeZone, dayStartHour = 0, now = new Date()) {
  return dayKey(now, timeZone, dayStartHour);
}

/** "2:00 AM" — for settings copy, where 02:00 reads like a timestamp. */
export function hourLabel(hour) {
  const h = normaliseHour(hour, 0);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

/** Day key -> UTC epoch ms at midnight. Only ever used as an arithmetic anchor. */
export function keyToUtcMs(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function utcMsToKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function addDays(key, n) {
  return utcMsToKey(keyToUtcMs(key) + n * 86400000);
}

/** Whole days from `a` to `b`; negative when b precedes a. */
export function diffDays(a, b) {
  return Math.round((keyToUtcMs(b) - keyToUtcMs(a)) / 86400000);
}

/** Inclusive list of keys from start to end. */
export function rangeKeys(startKey, endKey) {
  const out = [];
  for (let k = startKey; k <= endKey; k = addDays(k, 1)) out.push(k);
  return out;
}

/** The last `n` keys ending at (and including) endKey. */
export function windowKeys(endKey, n) {
  return rangeKeys(addDays(endKey, -(n - 1)), endKey);
}

/** 0 = Sunday .. 6 = Saturday. */
export function weekdayOf(key) {
  return new Date(keyToUtcMs(key)).getUTCDay();
}

export function monthOf(key) {
  return key.slice(0, 7);
}

/** All keys in a "YYYY-MM" month. */
export function monthDays(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return rangeKeys(`${monthKey}-01`, `${monthKey}-${String(last).padStart(2, '0')}`);
}

export function shiftMonth(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function isValidTimeZone(tz) {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function localTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}
