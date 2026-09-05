// Re-filing history when the day boundary moves.
//
// Day keys are baked into rows at record time: `attempt.day`, and the whole
// `days` rollup is keyed by them. Changing the day-start hour (or the
// timezone) therefore doesn't retroactively fix anything on its own — a 1am
// solve recorded under midnight rules stays filed on the wrong day, and the
// streak keeps counting it there. This recomputes both from the one thing that
// never changes, the attempt's epoch timestamp.
//
// Pure: takes a state object, returns a new one. No chrome.*, no Date.now().

import { dayKey } from './time.js';

/**
 * @param {{attempts:Array, days:Object}} state
 * @param {string} timeZone
 * @param {number} dayStartHour
 * @returns {{attempts:Array, days:Object, moved:number, rebuiltFrom:string|null}}
 */
export function rekeyState(state, timeZone, dayStartHour) {
  const source = state.attempts || [];
  let moved = 0;

  const attempts = source.map((a) => {
    const day = dayKey(new Date(a.at), timeZone, dayStartHour);
    if (day === a.day) return a;
    moved += 1;
    return { ...a, day };
  });

  if (!attempts.length) {
    return { attempts, days: { ...(state.days || {}) }, moved: 0, rebuiltFrom: null };
  }

  // Attempts are the evidence, so the rollup can only be rebuilt for the span
  // they cover. Anything older is left exactly as it was: attempts are capped
  // at 5000, and there is no way to re-file a day whose rows have been trimmed.
  // The boundary spans both placements — a row can only move earlier, so the
  // old rollup entry it used to sit in has to be rebuilt too.
  let from = attempts[0].day;
  for (const a of attempts) if (a.day < from) from = a.day;
  for (const a of source) if (a.day && a.day < from) from = a.day;

  const rebuilt = {};
  for (const a of attempts) {
    const d = rebuilt[a.day] || (rebuilt[a.day] = { attempts: 0, accepted: 0, solved: 0, slugs: [] });
    d.attempts += 1;
    if (a.verdict === 'Accepted') {
      d.accepted += 1;
      if (!d.slugs.includes(a.slug)) d.slugs.push(a.slug);
    }
  }
  for (const d of Object.values(rebuilt)) d.solved = d.slugs.length;

  const days = {};
  for (const [key, value] of Object.entries(state.days || {})) {
    if (key < from) days[key] = value;
  }
  Object.assign(days, rebuilt);

  return { attempts, days, moved, rebuiltFrom: from };
}
