// Downloads the family's Google calendars (secret iCal addresses), expands recurring events
// for a window around today and writes them encrypted to data.enc.json for the tablet app.
//
// Env:
//   CALENDARS          one calendar per line: "<osoba> <iCal URL>", osoba = praca | mato | manzelka | spolocne
//   CALENDAR_PASSWORD  password the tablet uses to decrypt the data
//   CALENDAR_TZ        optional, default Europe/Bratislava
import { webcrypto as crypto } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const PERSON = { praca: 'work', mato: 'me', manzelka: 'wife', spolocne: 'fam', work: 'work', me: 'me', wife: 'wife', fam: 'fam' };
const DEFAULT_TZ = process.env.CALENDAR_TZ || 'Europe/Bratislava';
const DAY = 86400000;

const lines = (process.env.CALENDARS || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
const password = process.env.CALENDAR_PASSWORD || '';
if (!lines.length || !password) {
  console.log('CALENDARS alebo CALENDAR_PASSWORD nie je nastavené, aplikácia zostane v ukážkovom režime.');
  process.exit(0);
}

// Window of events the tablet needs: the month view in the screensaver plus a few weeks ahead
const now = Date.now();
const winStart = now - 40 * DAY;
const winEnd = now + 70 * DAY;

// ---------- time zones ----------
const fmtCache = {};
function tzOffset(ts, tz) {
  let f = fmtCache[tz];
  if (!f) {
    try {
      f = fmtCache[tz] = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    } catch (e) {
      return tzOffset(ts, DEFAULT_TZ);
    }
  }
  const p = Object.fromEntries(f.formatToParts(new Date(ts)).map(x => [x.type, +x.value || 0]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ts / 1000) * 1000;
}
function zonedToUtc(y, mo, d, h, mi, s, tz) {
  const guess = Date.UTC(y, mo, d, h, mi, s);
  let ts = guess - tzOffset(guess, tz);
  ts = guess - tzOffset(ts, tz);
  return ts;
}

// ---------- ICS parsing ----------
function unescapeText(v) {
  return v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}
function parseProps(block) {
  const props = [];
  for (const raw of block) {
    const i = raw.indexOf(':');
    if (i < 0) continue;
    const head = raw.slice(0, i).split(';');
    const params = {};
    head.slice(1).forEach(p => { const [k, v = ''] = p.split('='); params[k.toUpperCase()] = v.replace(/^"|"$/g, ''); });
    props.push({ name: head[0].toUpperCase(), params, value: raw.slice(i + 1) });
  }
  return props;
}
// Returns { allDay, y, mo, d, h, mi, s, tz } in the event's wall clock, or null
function parseDate(prop) {
  if (!prop) return null;
  const v = prop.value.trim();
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined || prop.params.VALUE === 'DATE') return { allDay: true, y: +y, mo: +mo - 1, d: +d };
  return { allDay: false, y: +y, mo: +mo - 1, d: +d, h: +h, mi: +mi, s: +s, tz: z ? 'UTC' : (prop.params.TZID || DEFAULT_TZ) };
}
function toTs(dt) {
  if (dt.allDay) return Date.UTC(dt.y, dt.mo, dt.d);
  return dt.tz === 'UTC' ? Date.UTC(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.s) : zonedToUtc(dt.y, dt.mo, dt.d, dt.h, dt.mi, dt.s, dt.tz);
}
function parseDuration(v) {
  const m = (v || '').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, sign, w = 0, d = 0, h = 0, mi = 0, s = 0] = m;
  return (sign === '-' ? -1 : 1) * ((+w * 7 + +d) * DAY + (+h * 3600 + +mi * 60 + +s) * 1000);
}

function parseIcs(text) {
  const unfolded = text.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of unfolded) {
    if (line === 'BEGIN:VEVENT') cur = [];
    else if (line === 'END:VEVENT') { if (cur) events.push(parseProps(cur)); cur = null; }
    else if (cur) cur.push(line);
  }
  return events.map(props => {
    const get = n => props.find(p => p.name === n);
    const all = n => props.filter(p => p.name === n);
    return {
      uid: get('UID')?.value || '',
      summary: unescapeText(get('SUMMARY')?.value || '(bez názvu)'),
      location: unescapeText(get('LOCATION')?.value || ''),
      status: (get('STATUS')?.value || '').toUpperCase(),
      start: parseDate(get('DTSTART')),
      end: parseDate(get('DTEND')),
      duration: parseDuration(get('DURATION')?.value),
      rrule: get('RRULE')?.value || null,
      exdates: all('EXDATE').flatMap(p => p.value.split(',').map(v => parseDate({ value: v, params: p.params }))).filter(Boolean),
      recurrenceId: parseDate(get('RECURRENCE-ID'))
    };
  });
}

// ---------- recurrence ----------
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
function untilTs(v) {
  const u = v && parseDate({ value: v, params: {} });
  if (!u) return null;
  return u.allDay ? toTs(u) + DAY - 1 : toTs(u);
}
function parseRule(r) {
  const o = Object.fromEntries(r.split(';').map(p => p.split('=')));
  return {
    freq: o.FREQ,
    interval: +(o.INTERVAL || 1),
    count: o.COUNT ? +o.COUNT : null,
    until: untilTs(o.UNTIL),
    byday: o.BYDAY ? o.BYDAY.split(',').map(x => { const m = x.match(/^([+-]?\d+)?([A-Z]{2})$/); return { n: m[1] ? +m[1] : 0, wd: WD[m[2]] }; }) : null,
    bymonthday: o.BYMONTHDAY ? o.BYMONTHDAY.split(',').map(Number) : null,
    bymonth: o.BYMONTH ? o.BYMONTH.split(',').map(n => +n - 1) : null
  };
}
// Does calendar day `t` (UTC midnight of the local date) match the rule anchored at `s0`?
function matches(rule, s0, t) {
  const a = new Date(s0), b = new Date(t);
  const diffDays = Math.round((t - s0) / DAY);
  const wd = b.getUTCDay(), dom = b.getUTCDate(), mon = b.getUTCMonth();
  const dim = new Date(Date.UTC(b.getUTCFullYear(), mon + 1, 0)).getUTCDate();
  const nth = Math.ceil(dom / 7), nthLast = -Math.ceil((dim - dom + 1) / 7);
  const dayOk = () => {
    if (rule.byday) return rule.byday.some(x => x.wd === wd && (!x.n || x.n === nth || x.n === nthLast));
    if (rule.bymonthday) return rule.bymonthday.some(n => n === dom || (n < 0 && dim + n + 1 === dom));
    return dom === a.getUTCDate();
  };
  switch (rule.freq) {
    case 'DAILY':
      return diffDays % rule.interval === 0 && (!rule.byday || rule.byday.some(x => x.wd === wd)) && (!rule.bymonth || rule.bymonth.includes(mon));
    case 'WEEKLY': {
      const monday = x => x - ((new Date(x).getUTCDay() + 6) % 7) * DAY;
      const weeks = Math.round((monday(t) - monday(s0)) / (7 * DAY));
      const days = rule.byday ? rule.byday.map(x => x.wd) : [a.getUTCDay()];
      return weeks % rule.interval === 0 && days.includes(wd);
    }
    case 'MONTHLY': {
      const months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + mon - a.getUTCMonth();
      return months % rule.interval === 0 && dayOk();
    }
    case 'YEARLY': {
      const years = b.getUTCFullYear() - a.getUTCFullYear();
      const months = rule.bymonth || [a.getUTCMonth()];
      return years % rule.interval === 0 && months.includes(mon) && dayOk();
    }
  }
  return false;
}

function expand(ev) {
  const s = ev.start;
  let dur = ev.end ? toTs(ev.end) - toTs(s) : ev.duration;
  if (dur == null || dur < 0) dur = s.allDay ? DAY : 0;
  const one = startTs => ({ startTs, endTs: startTs + dur });
  if (!ev.rrule) return [one(toTs(s))];

  const rule = parseRule(ev.rrule);
  if (!rule.freq) return [one(toTs(s))];
  const ex = new Set(ev.exdates.map(toTs));
  const s0 = Date.UTC(s.y, s.mo, s.d);
  const out = [];
  let n = 0;
  // Walk day by day from the first occurrence; simple and exact for the rules Google produces
  for (let t = s0; t <= winEnd; t += DAY) {
    if (!matches(rule, s0, t)) continue;
    const d = new Date(t);
    const st = s.allDay ? t : toTs({ ...s, y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate() });
    if (rule.until != null && st > rule.until) break;
    n++;
    if (rule.count != null && n > rule.count) break;
    if (!ex.has(st)) out.push(one(st));
  }
  return out;
}

// ---------- build ----------
function isoDate(ts) { return new Date(ts).toISOString().slice(0, 10); }

async function load(line) {
  const [who, url] = line.split(/\s+/);
  const p = PERSON[(who || '').toLowerCase()];
  if (!p || !url) throw new Error('riadok musí byť "<osoba> <adresa>", osoba = praca | mato | manzelka | spolocne');
  const res = await fetch(url.replace(/^webcal:/, 'https:'));
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const items = parseIcs(await res.text());

  const overridden = new Map();
  items.filter(e => e.recurrenceId).forEach(e => {
    if (!overridden.has(e.uid)) overridden.set(e.uid, new Set());
    overridden.get(e.uid).add(toTs(e.recurrenceId));
  });

  const out = [];
  for (const ev of items) {
    if (!ev.start || ev.status === 'CANCELLED') continue;
    const skip = !ev.recurrenceId && overridden.get(ev.uid);
    for (const occ of expand(ev)) {
      if (skip && skip.has(occ.startTs)) continue;
      if (occ.endTs < winStart || occ.startTs > winEnd) continue;
      let t = ev.summary;
      const imp = /^!/.test(t);
      if (imp) t = t.replace(/^!\s*/, '');
      out.push({
        t, p, imp,
        a: ev.start.allDay,
        s: ev.start.allDay ? isoDate(occ.startTs) : new Date(occ.startTs).toISOString(),
        e: ev.start.allDay ? isoDate(occ.endTs) : new Date(occ.endTs).toISOString(),
        loc: ev.location || undefined
      });
    }
  }
  return out;
}

const b64 = buf => Buffer.from(buf).toString('base64');
async function encrypt(obj) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 200000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { v: 1, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}

const events = [];
const errors = [];
for (const [i, line] of lines.entries()) {
  try {
    const list = await load(line);
    events.push(...list);
    console.log(`Kalendár ${i + 1}: ${list.length} udalostí`);
  } catch (e) {
    // Never print the URL itself, it is a secret
    errors.push(i + 1);
    console.log(`Kalendár ${i + 1}: chyba – ${e.message}`);
  }
}
events.sort((x, y) => (x.s < y.s ? -1 : x.s > y.s ? 1 : 0));
writeFileSync('data.enc.json', JSON.stringify(await encrypt({ updated: new Date().toISOString(), errors, events })));
console.log(`Spolu ${events.length} udalostí zapísaných do data.enc.json`);
