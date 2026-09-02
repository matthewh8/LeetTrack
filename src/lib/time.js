// Timezone-correct calendar-day helpers.
//
// Every date boundary in LeetTrack goes through here. A day key is a plain
// calendar date string, "YYYY-MM-DD", in the user's chosen timezone. Once we
// have a key, all arithmetic on it is done in UTC so DST transitions can never
// add or drop a day.

/** Day key for an instant, in the given IANA timezone. */
export function dayKey(date, timeZone) {
  // en-CA formats as YYYY-MM-DD, which is also lexicographically sortable.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function todayKey(timeZone, now = new Date()) {
  return dayKey(now, timeZone);
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
