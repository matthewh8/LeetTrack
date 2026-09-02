// Guards the two things unit tests can't see: that the manifest points at files
// that exist, and that the pure logic modules stay free of chrome.* so they
// remain testable outside a browser.
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Comments legitimately mention chrome.*; only real code should trip the check.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const fail = [];
const ok = [];

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const refs = [
  manifest.background.service_worker,
  manifest.options_ui.page,
  manifest.action.default_popup,
  ...Object.values(manifest.icons),
  ...Object.values(manifest.action.default_icon),
  ...manifest.content_scripts.flatMap((c) => c.js),
];
for (const r of refs) {
  (existsSync(r) ? ok : fail).push(`manifest ref ${r}${existsSync(r) ? '' : ' MISSING'}`);
}

// Every href/src inside the two HTML pages must resolve.
for (const page of ['src/ui/dashboard.html', 'src/ui/popup.html']) {
  const html = readFileSync(page, 'utf8');
  for (const m of html.matchAll(/(?:href|src)="([^"#][^"]*)"/g)) {
    const p = join('src/ui', m[1]);
    (existsSync(p) ? ok : fail).push(`${page} -> ${m[1]}${existsSync(p) ? '' : ' MISSING'}`);
  }
}

const PURE = ['time.js', 'streak.js', 'scheduler.js', 'stats.js'];
for (const f of PURE) {
  const src = stripComments(readFileSync(join('src/lib', f), 'utf8'));
  if (/\bchrome\./.test(src)) fail.push(`src/lib/${f} references chrome.* — must stay pure`);
  else ok.push(`src/lib/${f} is chrome-free`);
}

// The MAIN-world interceptor must never touch extension APIs; it has no access.
const interceptor = stripComments(readFileSync('src/content/interceptor.js', 'utf8'));
if (/\bchrome\./.test(interceptor)) fail.push('interceptor.js touches chrome.* but runs in the page world');
else ok.push('interceptor.js stays in page world');

for (const f of readdirSync('src/lib')) {
  const src = readFileSync(join('src/lib', f), 'utf8');
  for (const m of src.matchAll(/from '(\.[^']+)'/g)) {
    const p = join('src/lib', m[1]);
    if (!existsSync(p)) fail.push(`src/lib/${f} imports missing ${m[1]}`);
  }
}

console.log(ok.map((s) => `  ok  ${s}`).join('\n'));
if (fail.length) {
  console.error(`\n${fail.length} problem(s):\n` + fail.map((s) => `  FAIL ${s}`).join('\n'));
  process.exit(1);
}
console.log(`\nall ${ok.length} static checks passed`);
