(() => {
  "use strict";
  const API = "https://lavdvbscgvtojenavuec.supabase.co/functions/v1/nft-tips-data";
  const $ = (id) => document.getElementById(id);
  const mem = {}; let ls = null; try { ls = window["local" + "Storage"]; ls.getItem("x"); } catch { ls = null; }
  const store = {
    getItem: (k) => mem[k] ?? (ls ? ls.getItem(k) : null),
    setItem: (k, v, keep) => { mem[k] = v; if (ls && keep) ls.setItem(k, v); },
    removeItem: (k) => { delete mem[k]; if (ls) ls.removeItem(k); },
  };
  let cache = null; // {start,end,rows,last_sync}
  const DEFAULTS = {
    office: "Rosa Hernandez, Rachel McFarland",
    fallback: "Troy McKay",
    five: "Troy McKay, Tabitha",
    dockRoles: "Dock, ON CALL",
    comm: [],
    commNo: "Troy McKay, Jodi Maynard",
    commRemote: "T Crawford",
    vquipFee: "10.26",
  };
  // Peek login name -> payout name
  const COMM_ALIAS = { "t crawford": "Tabitha" };
  const IN_RATE = 0.05, OUT_RATE = 0.07;
  let settings = load();
  let timesheet = null; // {byDate: {date: [{name, role, hours}]}, dates:Set, fileName}
  let lastReport = null;

  function load() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save() {
    settings.office = $("office").value; settings.fallback = $("fallback").value;
    settings.five = $("five").value; settings.dockRoles = $("dockRoles").value;
    settings.commNo = $("commNo").value; settings.commRemote = $("commRemote").value; settings.vquipFee = $("vquipFee").value;
    settings.comm = [...document.querySelectorAll(".comm")].map((r) => ({ name: r.querySelector(".cn").value, amt: r.querySelector(".ca").value }));
  }
  const list = (s) => String(s || "").split(",").map((x) => x.trim()).filter(Boolean);
  const norm = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
  const money = (n) => (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const r2 = (n) => { const c = Math.round(Number((Math.abs(n) * 100).toFixed(6))); return (n < 0 ? -c : c) / 100; };
  const cents = (n) => Math.round(Number((n * 100).toFixed(6)));
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ymd = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const fmtDate = (s) => { const [y, m, d] = s.split("-").map(Number); return `${m}/${d}/${String(y).slice(2)}`; };
  const dow = (s) => { const [y, m, d] = s.split("-").map(Number); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, m - 1, d).getDay()]; };
  function days(start, end) { const out = []; const [y, m, d] = start.split("-").map(Number); const c = new Date(y, m - 1, d); while (ymd(c) <= end) { out.push(ymd(c)); c.setDate(c.getDate() + 1); } return out; }
  // Match a person by full name or by first name (so "Tabitha" or "Annie" works).
  function matches(person, name) { const a = norm(person), b = norm(name); if (!a || !b) return false; const single = !a.includes(" ") || !b.includes(" "); return a === b || (single && a.split(" ")[0] === b.split(" ")[0]); }

  // Split cents across weights; first listed gets its rounded share, last gets remainder (matches the office sheet).
  function splitByHours(amount, people) {
    const total = people.reduce((s, p) => s + p.hours, 0);
    if (!total) return people.map(() => 0);
    const c = cents(amount); let used = 0;
    return people.map((p, i) => { if (i === people.length - 1) return (c - used) / 100; const v = Math.round((c * p.hours) / total); used += v; return v / 100; });
  }

  /* ---------- Half-month quick picks ---------- */
  function halfMonth(which) {
    const t = new Date(); let y = t.getFullYear(), m = t.getMonth(), first = t.getDate() <= 15;
    if (which === "prev") { if (first) { m -= 1; if (m < 0) { m = 11; y -= 1; } first = false; } else first = true; }
    const last = new Date(y, m + 1, 0).getDate();
    return first ? [ymd(new Date(y, m, 1)), ymd(new Date(y, m, 15))] : [ymd(new Date(y, m, 16)), ymd(new Date(y, m, last))];
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    const rows = []; let row = [], f = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
      else f += ch;
    }
    if (f || row.length) { row.push(f); rows.push(row); }
    return rows;
  }
  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
  function parseDate(s) {
    s = String(s || "").trim();
    let m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
    if (m) { const mi = MONTHS.indexOf(m[1].toLowerCase()); if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) { const y = m[3].length === 2 ? "20" + m[3] : m[3]; return `${y}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`; }
    m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    return null;
  }
  // "2:25pm" -> minutes after midnight
  function clock(s) {
    const m = String(s || "").trim().toLowerCase().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/);
    if (!m) return null; let h = Number(m[1]) % 12; if (m[3] === "pm") h += 12; if (!m[3]) h = Number(m[1]);
    return h * 60 + Number(m[2]);
  }
  const hm = (m) => `${((Math.floor(m / 60) + 11) % 12) + 1}:${String(m % 60).padStart(2, "0")} ${Math.floor(m / 60) % 24 < 12 ? "AM" : "PM"}`;
  const toMin = (t) => (t ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)) : null);
  const ov = (a1, a2, b1, b2) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  // Hours a dock shift counts toward tips: only the part between first boat out and last boat back.
  function dockCounted(s, w) {
    if (!w || w.out === null || w.back === null || s.inM === null || s.outM === null) return { h: s.hours, how: "paid hours (no clock or rental times)" };
    let mins = ov(s.inM, s.outM, w.out, w.back);
    if (s.bs !== null && s.be !== null && s.be > s.bs) mins -= ov(s.bs, s.be, w.out, w.back);
    else if (s.unpaid > 0 && s.outM > s.inM) mins -= Math.round(s.unpaid * 60 * (mins / (s.outM - s.inM)));
    return { h: r2(Math.max(0, mins) / 60), how: "rental window" };
  }
  const CAPTAIN_WEEKDAY = 20;
  // Per-booking captain overrides, saved on this device: "rule" (default), "all" (captain keeps whole tip), "none" (all to pool)
  const CAP_KEY = "nftTipsCapModes";
  const capMode = (() => { try { return new Map(Object.entries(JSON.parse(window["local" + "Storage"].getItem(CAP_KEY) || "{}"))); } catch { return new Map(); } })();
  const saveCap = () => { try { window["local" + "Storage"].setItem(CAP_KEY, JSON.stringify(Object.fromEntries(capMode))); } catch {} };
  // Per-booking commission overrides, saved on this device: "in" (5%), "out" (7%), "none"
  const COMM_KEY = "nftTipsCommModes";
  const commMode = (() => { try { return new Map(Object.entries(JSON.parse(window["local" + "Storage"].getItem(COMM_KEY) || "{}"))); } catch { return new Map(); } })();
  const saveCommModes = () => { try { window["local" + "Storage"].setItem(COMM_KEY, JSON.stringify(Object.fromEntries(commMode))); } catch {} };
  // Commission on staff-made bookings by trip date. Phone app or remote login = 7%, office computer = 5%.
  // Peek sales-agent tag, e.g. "Rosa H.  (In-Office)", "Nicole C. (Remote)", "TABITHA CRAWFORD - Remote"
  const TAG_RE = /\((in.?office|remote)\)|-\s*(in.?office|remote)\s*$/i;
  const FIRST_NAME = { rosa: "Rosa Hernandez", rachel: "Rachel McFarland", rachael: "Rachel McFarland", annie: "Annie Huang", brianna: "Brianna Ramirez", nicole: "Tabitha", tabitha: "Tabitha", troy: "Troy McKay", jodi: "Jodi Maynard" };
  function parseTag(t) {
    const m = String(t || "").match(TAG_RE); if (!m) return null;
    const where = /remote/i.test(m[1] || m[2]) ? "out" : "in";
    const raw = String(t).replace(TAG_RE, "").trim();
    const first = norm(raw).split(" ")[0];
    return { where, name: FIRST_NAME[first] || raw, raw: String(t).replace(/\s+/g, " ").trim() };
  }
  // Commission on staff bookings by trip date. Peek tag decides who and 5%/7%; otherwise phone or remote login = 7%, office computer = 5%.
  // Sales = value - tips - vQuip fee ($10.26 per boat, not on Water Rentals).
  function computeComm(bookings, ts) {
    const no = list(settings.commNo), remote = list(settings.commRemote);
    const fee = parseFloat(settings.vquipFee) || 0;
    const rows = [], flags = [], by = {};
    for (const b of bookings || []) {
      const tag = parseTag(b.reseller);
      const payee = tag ? tag.name : (COMM_ALIAS[norm(b.by)] || b.by);
      if (!payee || no.some((n) => matches(n, payee))) continue;
      const boats = Math.max(1, b.tickets || 1);
      const vq = /water rental/i.test(b.product || "") ? 0 : r2(fee * boats);
      const base = Math.max(0, r2(b.value - (b.tip || 0) - vq));
      let auto, how;
      if (b.no_show) { auto = "none"; how = "no-show"; }
      else if (base <= 0) { auto = "none"; how = "$0 after vQuip fee"; }
      else if (b.source === "website") { auto = "none"; how = `website, tagged ${tag.raw}`; }
      else if (tag) { auto = tag.where; how = tag.raw; }
      else if (remote.some((n) => matches(n, b.by))) { auto = "out"; how = "remote only (no tag)"; }
      else if (b.source && b.source !== "backend") { auto = "out"; how = "phone app (no tag)"; }
      else { auto = "in"; how = "office computer (no tag)"; }
      const mode = commMode.get(b.id) || auto;
      const rate = mode === "in" ? IN_RATE : mode === "out" ? OUT_RATE : 0;
      const comm = r2(base * rate);
      // Untagged office-computer bookings made while the person wasn't clocked in on Homebase.
      let clocked = null;
      if (auto === "in" && !tag && b.booked_at && ts) {
        const bd = b.booked_at.slice(0, 10), bm = toMin(b.booked_at.slice(11, 16));
        const onHB = Object.values(ts.byDate).some((arr) => arr.some((x) => matches(x.name, payee)));
        if (onHB && bd >= ts.first && bd <= ts.last) {
          const prev = ymdAdd(bd, -1);
          clocked = (ts.byDate[bd] || []).some((x) => matches(x.name, payee) && x.inM !== null && x.outM !== null && bm >= x.inM && bm <= x.outM)
            || (ts.byDate[prev] || []).some((x) => matches(x.name, payee) && x.outM > 1440 && bm + 1440 <= x.outM);
          if (!clocked && !commMode.has(b.id)) flags.push(`${b.id} (${payee}, trip ${fmtDate(b.date)}) has no In-Office/Remote tag and was booked at ${to12(b.booked_at.slice(11, 16))} on ${fmtDate(bd)}, when ${payee.split(" ")[0]} wasn't clocked in. Counted at 5%; change it to 7% if it was remote.`);
        }
      }
      if (b.source === "website" && !b.no_show && !commMode.has(b.id)) flags.push(`${b.id} (trip ${fmtDate(b.date)}) was booked on the website but tagged ${tag.raw}. Not counted; set a rate in Commissions if it should be.`);
      rows.push({ ...b, payee, base, vq, boats, auto, how, mode, rate, comm, clocked });
      const t = (by[payee] ||= { inN: 0, inBase: 0, inComm: 0, outN: 0, outBase: 0, outComm: 0, comm: 0 });
      if (mode === "in") { t.inN++; t.inBase += base; t.inComm = r2(t.inComm + comm); } else if (mode === "out") { t.outN++; t.outBase += base; t.outComm = r2(t.outComm + comm); }
      t.comm = r2(t.comm + comm);
    }
    rows.sort((a, b) => a.payee.localeCompare(b.payee) || a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    return { rows, flags, by };
  }
  const ymdAdd = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const isWeekend = (d) => { const g = new Date(d + "T12:00:00Z").getUTCDay(); return g === 0 || g === 6; };
  function readTimesheet(text, fileName) {
    const rows = parseCSV(text);
    let hi = -1, cols = {};
    const byDate = {}; let shifts = 0, period = "";
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (/payroll period/i.test(r[0] || "")) period = r[1] || "";
      if (norm(r[0]) === "name" && r.some((c) => /clock in date/i.test(c))) {
        hi = i; cols = {};
        r.forEach((c, j) => (cols[norm(c)] = j));
        continue;
      }
      if (hi < 0) continue;
      const name = (r[cols["name"]] || "").trim();
      if (!name || name === "-") continue;
      const d = parseDate(r[cols["clock in date"]]);
      if (!d) continue;
      const hrsCol = cols["total paid hours"] ?? cols["actual hours"];
      const hours = parseFloat(r[hrsCol]) || 0;
      const inM = clock(r[cols["clock in time"]]);
      let outM = clock(r[cols["clock out time"]]);
      const od = parseDate(r[cols["clock out date"]]);
      if (outM !== null && od && od > d) outM += 1440;
      const bs = clock(r[cols["break start"]]), be = clock(r[cols["break end"]]);
      const unpaid = parseFloat(r[cols["unpaid breaks"]]) || 0;
      (byDate[d] ||= []).push({ name, role: (r[cols["role"]] || "").trim(), hours, inM, outM, bs, be, unpaid });
      shifts++;
    }
    if (!shifts) throw new Error("This doesn't look like a Homebase timesheet export (no Name / Clock in date rows found).");
    const ds = Object.keys(byDate).sort();
    return { byDate, fileName, shifts, period, first: ds[0], last: ds[ds.length - 1] };
  }

  /* ---------- API ---------- */
  async function api(body) {
    const res = await fetch(API, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password: store.getItem("nftTipsPw") || "", ...body }) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 401) { lock(); throw new Error("Password no longer valid. Please unlock again."); }
    if (!res.ok) throw new Error(j.error || "Server error " + res.status);
    return j;
  }

  /* ---------- Calculation ---------- */
  function compute(start, end, rows, ts, windows, staffBookings) {
    windows = windows || {};
    const C = computeComm(staffBookings, ts);
    const officeNames = list(settings.office), fallback = settings.fallback.trim(), five = list(settings.five);
    const dockRoles = list(settings.dockRoles).map(norm);
    const isOffice = (n) => officeNames.some((o) => matches(o, n));
    const dayList = days(start, end);
    // Captain rule: Mon–Fri the captain gets the first $20 of the tip, the rest goes to the pool; Sat/Sun the captain gets it all.
    const capRows = [];
    rows = rows.map((r) => {
      const mode = capMode.get(r.id) || "rule";
      const isCap = Array.isArray(r.captains) && mode !== "none";
      const wk = isWeekend(r.date);
      const toCap = !isCap ? 0 : mode === "all" ? r.tip : (wk ? r.tip : Math.min(CAPTAIN_WEEKDAY, r.tip));
      const x = { ...r, isCap, mode, toCap: r2(toCap), pool: r2(r.tip - toCap) };
      if (Array.isArray(r.captains)) capRows.push(x);
      return x;
    });
    const gross = r2(rows.reduce((s, r) => s + r.tip, 0));
    const captainTotal = r2(rows.reduce((s, r) => s + r.toCap, 0));
    const tipsByDay = {}; rows.forEach((r) => { (tipsByDay[r.date] ||= []).push(r); });
    const total = r2(rows.reduce((s, r) => s + r.pool, 0));
    const notes = [];
    const officePay = Object.fromEntries(officeNames.map((n) => [n, 0]));
    let fallbackOffice = 0;
    const dockPeople = {}; let dockUnassigned = 0; const shiftFlags = [], flaggedShort = new Set();
    const daily = dayList.map((d) => {
      const dayTips = r2((tipsByDay[d] || []).reduce((s, r) => s + r.pool, 0));
      const office = r2(dayTips * 0.15), docks = r2(dayTips * 0.75), tenth = r2(dayTips * 0.10);
      const shifts = ts.byDate[d] || [];
      const hrs = officeNames.map((n) => ({ name: n, hours: r2(shifts.filter((s) => matches(n, s.name)).reduce((a, s) => a + s.hours, 0)) }));
      const working = hrs.filter((h) => h.hours > 0);
      const split = Object.fromEntries(officeNames.map((n) => [n, 0])); let fb = 0;
      if (working.length) { const amts = splitByHours(office, working); working.forEach((w, i) => { split[w.name] = amts[i]; officePay[w.name] += amts[i]; }); }
      else { fb = office; fallbackOffice += office; }
      // dock estimate (reference only)
      const dockShifts = {}, dockPaid = {};
      const wd = windows[d]; const w = wd ? { out: toMin(wd.first_out), back: toMin(wd.last_back) } : null;
      shifts.forEach((s) => { if (!isOffice(s.name) && !(fallback && matches(fallback, s.name)) && dockRoles.includes(norm(s.role)) && s.hours > 0) { const c = dockCounted(s, w); dockShifts[s.name] = (dockShifts[s.name] || 0) + c.h; dockPaid[s.name] = (dockPaid[s.name] || 0) + s.hours; } });
      const dp = Object.entries(dockShifts).filter(([, hours]) => hours > 0).map(([name, hours]) => ({ name, hours }));
      // Troy covers the docks from the first boat out until the first dock staff clocks in (all day if nobody does).
      let cover = 0;
      if (fallback && w && w.out !== null && w.back !== null && w.back > w.out) {
        const ins = shifts.filter((s) => !isOffice(s.name) && !matches(fallback, s.name) && dockRoles.includes(norm(s.role)) && s.inM !== null && s.outM !== null && s.outM > w.out && s.inM < w.back).map((s) => s.inM);
        const firstIn = ins.length ? Math.min(...ins) : w.back;
        cover = r2(Math.max(0, Math.min(firstIn, w.back) - w.out) / 60);
        if (cover > 0) dp.push({ name: fallback, hours: cover, cover: true });
        // Flag dock shifts that look like clock-in mistakes.
        shifts.filter((s) => !isOffice(s.name) && !matches(fallback, s.name) && dockRoles.includes(norm(s.role)) && s.inM !== null && s.outM !== null && s.outM > s.inM).forEach((s) => {
          const t = `${s.name} ${hm(s.inM)}–${hm(s.outM % 1440)}`;
          if (s.outM <= w.out) shiftFlags.push(`${dow(d)} ${fmtDate(d)}: ${t} clocked out before the first boat went out (${hm(w.out)}).`);
          else if (s.inM >= w.back) shiftFlags.push(`${dow(d)} ${fmtDate(d)}: ${t} clocked in after the last boat came back (${hm(w.back)}).`);
          else { const dayMin = shifts.filter((o) => o.name === s.name && o.inM !== null && o.outM !== null).reduce((m, o) => m + Math.max(0, o.outM - o.inM), 0);
            if (dayMin < 180 && !flaggedShort.has(d + s.name)) { flaggedShort.add(d + s.name); shiftFlags.push(`${dow(d)} ${fmtDate(d)}: ${s.name} worked only ${(dayMin / 60).toFixed(2)} hrs (${shifts.filter((o) => o.name === s.name && o.inM !== null && o.outM !== null).map((o) => `${hm(o.inM)}–${hm(o.outM % 1440)}`).join(", ")}) on a day with rentals ${hm(w.out)}–${hm(w.back)}.`); } }
        });
        if (cover >= 1) shiftFlags.push(`${dow(d)} ${fmtDate(d)}: ${fallback} credited ${cover.toFixed(2)} dock hrs because no dock staff was clocked in from ${hm(w.out)}. Check for a missing dock clock-in.`);
      }
      Object.keys(dockPaid).forEach((n) => { (dockPeople[n] ||= { hours: 0, amt: 0, paid: 0 }); dockPeople[n].paid = (dockPeople[n].paid || 0) + dockPaid[n]; });
      const dockSplit = {};
      if (dp.length && docks > 0) { const a = splitByHours(docks, dp); dp.forEach((p, i) => { dockSplit[p.name] = a[i]; (dockPeople[p.name] ||= { hours: 0, amt: 0, paid: 0 }); dockPeople[p.name].hours += p.hours; dockPeople[p.name].amt += a[i]; }); }
      else if (docks > 0) dockUnassigned += docks;
      dp.forEach((p) => { if (!(p.name in dockSplit)) { (dockPeople[p.name] ||= { hours: 0, amt: 0, paid: 0 }); dockPeople[p.name].hours += p.hours; } });
      return { d, cover, coverAmt: cover > 0 ? (dockSplit[fallback] || 0) : 0, count: (tipsByDay[d] || []).length, dayTips, office, docks, tenth, hrs, split, fb, dockSplit, dockHours: dp.reduce((a, p) => a + p.hours, 0), win: wd || null, dockDetail: dp.map((p) => `${p.name.split(" ")[0]} ${p.hours.toFixed(2)}`).join(", ") };
    });
    const officeTotal = r2(daily.reduce((s, x) => s + x.office, 0));
    const docksTotal = r2(total * 0.75), fivePct = r2(total * 0.05);
    const troyDock = r2(daily.reduce((s, x) => s + x.coverAmt, 0));
    const docksToChristian = r2(docksTotal - troyDock);

    // Payout
    const payout = [];
    const add = (name, tips, label) => { let p = payout.find((x) => matches(x.name, name)); if (!p) payout.push((p = { name, tips: 0, parts: [], comm: 0 })); p.tips = r2(p.tips + tips); if (label) p.parts.push(label); };
    officeNames.forEach((n) => add(n, r2(officePay[n]), "office by hours"));
    if (fallback) add(fallback, r2(fallbackOffice), "office days with no office staff");
    if (fallback && troyDock > 0) add(fallback, troyDock, "dock coverage (no dock staff on)");
    five.forEach((n) => add(n, fivePct, "5%"));
    if (captainTotal > 0) add("Captains (total)", captainTotal, "paid on the spot");
    payout.forEach((p) => { if (p.parts.length > 1) p.parts = [...new Set(p.parts)]; });
    Object.entries(C.by).forEach(([n, t]) => { if (t.comm > 0) { add(n, 0); const p = payout.find((x) => matches(x.name, n)); p.autoComm = r2((p.autoComm || 0) + t.comm); } });
    payout.forEach((p) => (p.comm = p.autoComm || 0));
    settings.comm.forEach((c) => { const a = parseFloat(c.amt); if (c.name.trim() && c.amt !== "" && !isNaN(a)) { add(c.name.trim(), 0); const p = payout.find((x) => matches(x.name, c.name.trim())); p.comm = r2(a); p.manual = true; } });
    payout.forEach((p) => (p.total = r2(p.tips + p.comm)));

    // Checks
    if (ts.first > start || ts.last < end) notes.push(`The timesheet covers ${fmtDate(ts.first)}–${fmtDate(ts.last)}, which doesn't cover the whole period. Days outside it count as "no office staff".`);
    const fbDays = daily.filter((x) => x.fb > 0);
    if (fbDays.length && fallback) notes.push(`No office staff clocked in on ${fbDays.map((x) => fmtDate(x.d)).join(", ")}, so those office shares (${money(r2(fbDays.reduce((s, x) => s + x.fb, 0)))}) go to ${fallback}.`);
    daily.forEach((x) => { if (x.docks > 0 && !x.dockHours) notes.push(`${dow(x.d)} ${fmtDate(x.d)}: no dock hours found, so ${money(x.docks)} of the dock estimate is unassigned.`); });
    const diff = r2(total - officeTotal - docksTotal - fivePct * 2);
    if (Math.abs(diff) > Math.max(0.05, 0.01 * dayList.length)) notes.push(`Check: office + docks + 5% shares differ from total tips by ${money(diff)}.`);
    const anomalies = daily.reduce((s, x) => s + (x.win?.anomalies?.length || 0), 0);
    if (anomalies) notes.push(`${anomalies} vQuip check-out/in time${anomalies > 1 ? "s" : ""} looked wrong (test scans or scans on another day). Those bookings use their scheduled Peek time instead. Details are in the Dock window table.`);
    const nCap = capRows.filter((r) => r.isCap).length;
    if (capRows.length) notes.push(`${nCap} captained booking${nCap === 1 ? "" : "s"} with tips found from Peek notes. Check the Captain tips table and set any exceptions in the Split column.`);
    shiftFlags.forEach((f) => notes.push(`Check shift: ${f} If this is a clock-in mistake, fix it in Homebase, export again, and re-run.`));
    const covDays = daily.filter((x) => x.cover > 0);
    if (covDays.length) notes.push(`${fallback} covered the docks before any dock staff clocked in on ${covDays.map((x) => `${fmtDate(x.d)} (${x.cover.toFixed(2)} hrs)`).join(", ")}. His dock share (${money(troyDock)}) is added to his payout and taken out of the docks amount for Christian.`);
    C.flags.forEach((f) => notes.push(`Check commission: ${f}`));
    return { comm: C, start, end, rows, daily, total, gross, troyDock, docksToChristian, captainTotal, capRows, officeTotal, docksTotal, fivePct, payout, officeNames, fallback, five, dockPeople, dockUnassigned: r2(dockUnassigned), notes };
  }

  /* ---------- Render ---------- */
  function render(R, lastSync, scroll) {
    const el = $("report");
    const kp = (k, v, cls = "") => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const syncTxt = lastSync ? new Date(lastSync).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "unknown";
    const officeHdr = R.officeNames.map((n) => `<th>${esc(n.split(" ")[0])} hrs</th><th>${esc(n.split(" ")[0])} $</th>`).join("");
    const dailyRows = R.daily.map((x) => `<tr><td class="l">${dow(x.d)} ${fmtDate(x.d)}</td><td>${x.count || ""}</td><td>${money(x.dayTips)}</td><td>${money(x.office)}</td>${x.hrs.map((h) => `<td class="${h.hours ? "" : "dim"}">${h.hours ? h.hours.toFixed(2) : "–"}</td><td class="${x.split[h.name] ? "hl" : "dim"}">${x.split[h.name] ? money(x.split[h.name]) : "–"}</td>`).join("")}<td class="${x.fb ? "hl" : "dim"}">${x.fb ? money(x.fb) : "–"}</td><td>${money(x.docks)}</td><td>${money(x.tenth)}</td></tr>`).join("");
    const sum = (f) => R.daily.reduce((s, x) => s + f(x), 0);
    const dailyTotal = `<tr class="total"><td class="l">Total</td><td>${R.rows.length}</td><td>${money(R.total)}</td><td>${money(R.officeTotal)}</td>${R.officeNames.map((n, i) => `<td>${sum((x) => x.hrs[i].hours).toFixed(2)}</td><td>${money(r2(sum((x) => x.split[n])))}</td>`).join("")}<td>${money(r2(sum((x) => x.fb)))}</td><td>${money(r2(sum((x) => x.docks)))}</td><td>${money(r2(sum((x) => x.tenth)))}</td></tr>`;
    const payRows = R.payout.map((p) => `<tr><td class="l">${esc(p.name)}</td><td class="l muted">${esc(p.parts.join(" + ") || (p.comm ? "commission only" : ""))}</td><td>${money(p.tips)}</td><td><input class="cin" type="number" step="0.01" min="0" inputmode="decimal" placeholder="$0.00" aria-label="Commission for ${esc(p.name)}" data-name="${esc(p.name)}" value="${p.comm ? p.comm.toFixed(2) : ""}">${p.manual ? `<div class="tiny">typed (auto ${money(p.autoComm || 0)})</div>` : ""}</td><td>${money(p.total)}</td></tr>`).join("");
    const dockRows = Object.entries(R.dockPeople).sort((a, b) => b[1].amt - a[1].amt).map(([n, v]) => `<tr><td class="l">${esc(n)}</td><td>${(v.paid || 0).toFixed(2)}</td><td>${v.hours.toFixed(2)}</td><td>${money(r2(v.amt))}</td></tr>`).join("");
    const t12 = (t) => (t ? hm(toMin(t)) : "–");
    const winRows = R.daily.filter((x) => x.win).map((x) => { const w = x.win; const an = (w.anomalies || []).map((a) => `${a.id}: ${a.why}`).join("; ");
      return `<tr><td class="l">${dow(x.d)} ${fmtDate(x.d)}</td><td>${t12(w.first_out)}</td><td class="l muted">${esc(w.out_source || "")}</td><td>${t12(w.last_back)}</td><td class="l muted">${esc(w.back_source || "")}</td><td>${money(x.docks)}</td><td class="l">${esc(x.dockDetail || "–")}</td><td class="l muted">${esc(an || "")}</td></tr>`; }).join("");
    const detail = R.rows.map((r) => `<tr><td class="l">${fmtDate(r.date)}</td><td class="l">${esc(to12(r.time))}</td><td class="l">${esc(r.id)}</td><td class="l">${esc(r.customer)}</td><td class="l">${esc(r.product || "")}</td><td>${money(r.tip)}</td><td class="${r.toCap ? "hl" : "dim"}">${r.toCap ? money(r.toCap) : "–"}</td><td>${money(r.pool)}</td></tr>`).join("");
    const capTable = R.capRows.length ? `<div class="card"><h2>Captain tips</h2><div class="tablewrap"><table><thead><tr><th class="l">Split</th><th>Day</th><th class="l">Booking</th><th class="l">Customer</th><th class="l">Captain</th><th>Tip</th><th>To captain</th><th>To pool</th></tr></thead><tbody>${R.capRows.map((r) => `<tr><td class="l"><select class="capsel" data-id="${esc(r.id)}" aria-label="Captain split for ${esc(r.id)}"><option value="rule" ${r.mode === "rule" ? "selected" : ""}>Standard rule</option><option value="all" ${r.mode === "all" ? "selected" : ""}>Captain keeps all</option><option value="none" ${r.mode === "none" ? "selected" : ""}>All to pool (not captained)</option></select></td><td class="l">${dow(r.date)} ${fmtDate(r.date)}</td><td class="l">${esc(r.id)}</td><td class="l">${esc(r.customer)}</td><td class="l">${esc(r.captains.join(", ") || "not in notes")}</td><td>${money(r.tip)}</td><td>${money(r.toCap)}</td><td>${money(r.pool)}</td></tr>`).join("")}</tbody></table></div>
        <p class="foot">Mon–Fri: captain gets the first $${CAPTAIN_WEEKDAY} of the tip, the rest goes to the pool. Sat–Sun: captain gets the whole tip. Captained bookings are found from "Captain &lt;name&gt;" in the Peek notes or the captained-tour product. Use the Split menu for exceptions: "Captain keeps all" gives the captain the whole tip on any day, "All to pool" means it wasn't captained. Choices are saved on this device.</p></div>` : "";
    const howLbl = { in: "5% office", out: "7% remote", none: "No commission" };
    const cByRows = Object.entries(R.comm.by).map(([n, t]) => `<tr><td class="l">${esc(n)}</td><td>${t.inN}</td><td>${money(r2(t.inBase))}</td><td>${money(t.inComm)}</td><td>${t.outN}</td><td>${money(r2(t.outBase))}</td><td>${money(t.outComm)}</td><td>${money(t.comm)}</td></tr>`).join("");
    const cRows = R.comm.rows.map((r) => `<tr class="${r.mode === "none" ? "dimrow" : ""}"><td class="l"><select class="commsel" data-id="${esc(r.id)}" data-auto="${r.auto}" aria-label="Commission rate for ${esc(r.id)}">${["in", "out", "none"].map((m) => `<option value="${m}" ${r.mode === m ? "selected" : ""}>${howLbl[m]}</option>`).join("")}</select></td><td class="l">${esc(r.payee)}</td><td class="l">${fmtDate(r.date)}</td><td class="l">${esc(r.id)}</td><td class="l">${esc(r.customer || "")}</td><td class="l muted">${r.booked_at ? fmtDate(r.booked_at.slice(0, 10)) + " " + to12(r.booked_at.slice(11, 16)) : ""}</td><td class="l muted">${esc(r.how)}${r.clocked === false ? " · not clocked in" : ""}${commMode.has(r.id) ? " · changed" : ""}</td><td>${r.boats}</td><td>${money(r.base)}${r.vq ? `<div class="tiny">${money(r.value - (r.tip || 0))} − ${money(r.vq)}</div>` : ""}</td><td>${r.comm ? money(r.comm) : "–"}</td></tr>`).join("");
    const commTotal = r2(Object.values(R.comm.by).reduce((a, t) => a + t.comm, 0));
    const commCard = R.comm.rows.length ? `<div class="card pb"><h2>Commissions</h2><div class="tablewrap"><table><thead><tr><th>Person</th><th>Office #</th><th>Office sales</th><th>5%</th><th>Remote #</th><th>Remote sales</th><th>7%</th><th>Commission</th></tr></thead><tbody>${cByRows}<tr class="total"><td class="l" colspan="7">Total</td><td>${money(commTotal)}</td></tr></tbody></table></div>
        <p class="foot">Staff-made Peek bookings with a trip date in this period (cancelled excluded; no-shows and $0 bookings get no commission). Sales = booking value minus tips minus the vQuip fee (${money(parseFloat(settings.vquipFee) || 0)} per boat; none on Water Rentals). The Peek sales-agent tag decides who gets credit and the rate: In-Office = 5%, Remote = 7% (Nicole C. is paid as Tabitha). Bookings without a tag: phone app or ${esc(settings.commRemote)} = 7%, office computer = 5%. Not counted: ${esc(settings.commNo)}, and customer website bookings.</p>
        <details><summary>Commission bookings (${R.comm.rows.length})</summary><div class="tablewrap"><table><thead><tr><th class="l">Rate</th><th class="l">Person</th><th class="l">Trip</th><th class="l">Booking</th><th class="l">Customer</th><th class="l">Booked</th><th class="l">How</th><th>Boats</th><th>Value − tips − vQuip</th><th>Commission</th></tr></thead><tbody>${cRows}</tbody></table></div>
        <p class="foot">Change a booking's rate with its menu. Changes are saved on this device.</p></details></div>` : "";
    const notes = R.notes.length ? R.notes.map((n) => `<li>${esc(n)}</li>`).join("") : `<li class="ok">No issues found.</li>`;
    el.innerHTML = `
      <div class="rhead"><div><h1>Tips ${fmtDate(R.start)} – ${fmtDate(R.end)}</h1><div class="muted">Peek tips (cancelled bookings excluded) · Peek data synced ${esc(syncTxt)} · Hours from ${esc(timesheet.fileName)}</div></div>
        <div class="btns"><button class="ghost" id="xl" type="button">Download Excel</button><button class="ghost" id="pdf" type="button">Print / Save PDF</button></div></div>
      <div class="kpis">${kp("Total online tips", money(R.gross), "main")}${kp("To captains", money(R.captainTotal))}${kp("Pool after captains", money(R.total))}${kp("Office 15%", money(R.officeTotal))}${kp("Docks 75%", money(R.docksTotal))}${kp(esc(R.five[0] || "5%") + " 5%", money(R.fivePct))}${kp(esc(R.five[1] || "5%") + " 5%", money(R.fivePct))}</div>
      <ul class="notes">${notes}</ul>
      <div class="card"><h2>Payout</h2><div class="tablewrap"><table class="payout"><thead><tr><th>Person</th><th class="l">From</th><th>Tips</th><th>Commission</th><th>Tip + commission</th></tr></thead><tbody>${payRows}</tbody></table></div>
        <p class="foot">Docks 75% is ${money(R.docksTotal)}${R.troyDock ? `; ${money(R.troyDock)} of it is ${esc(R.fallback)}'s dock coverage, so ${money(R.docksToChristian)} goes to Christian` : " and goes to Christian"} for the dock split. Office is rounded per day and the 5% shares per period, so totals can differ by a few cents.</p></div>
      ${capTable}
      ${commCard}
      <div class="card"><h2>Daily office split</h2><div class="tablewrap"><table><thead><tr><th>Day</th><th># tips</th><th>Pool tips</th><th>Office 15%</th>${officeHdr}<th>${esc((R.fallback || "Fallback").split(" ")[0])} office $</th><th>Docks 75%</th><th>10% (5%+5%)</th></tr></thead><tbody>${dailyRows}${dailyTotal}</tbody></table></div>
        <p class="foot">Office 15% each day is split by Homebase paid hours. If nobody listed as office staff clocked in, it goes to ${esc(R.fallback || "the fallback person")}.</p></div>
      <div class="card pb"><h2>Dock pool by hours <span class="badge">Estimate for Christian</span></h2><div class="tablewrap"><table><thead><tr><th>Dock staff</th><th>Paid hrs</th><th>Tip hrs</th><th>Estimated share</th></tr></thead><tbody>${dockRows || `<tr><td class="l" colspan="4">No dock hours in this timesheet.</td></tr>`}</tbody></table></div>
        <p class="foot">Tip hrs count only the time between the first boat out and the last boat back that day. Out = vQuip launch. Back = scheduled Peek end, or the vQuip return if the boat came back late. Rentals not in vQuip and bad scans use their Peek times.</p>
        <h3>Dock window by day</h3><div class="tablewrap"><table><thead><tr><th>Day</th><th>First out</th><th class="l">Source</th><th>Last back</th><th class="l">Source</th><th>Docks 75%</th><th class="l">Tip hrs</th><th class="l">Fixed vQuip times</th></tr></thead><tbody>${winRows}</tbody></table></div>
        <p class="foot">Each day's 75% split by that day's tip hours (roles: ${esc(settings.dockRoles)}). Reference only. Christian's split is final.${R.dockUnassigned ? " Unassigned: " + money(R.dockUnassigned) + "." : ""}</p></div>
      <div class="card pb"><h2>Tip detail from Peek</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th class="l">Time</th><th class="l">Booking</th><th class="l">Customer</th><th class="l">Product</th><th>Tip</th><th>To captain</th><th>To pool</th></tr></thead><tbody>${detail}<tr class="total"><td class="l" colspan="5">Total</td><td>${money(R.gross)}</td><td>${money(R.captainTotal)}</td><td>${money(R.total)}</td></tr></tbody></table></div></div>`;
    el.classList.remove("hidden");
    el.querySelectorAll(".cin").forEach((i) => i.addEventListener("change", () => {
      const n = i.dataset.name; let c = settings.comm.find((x) => matches(x.name, n));
      if (!c) settings.comm.push((c = { name: n, amt: "" }));
      c.amt = i.value; settings.comm.filter((x) => x !== c && matches(x.name, n)).forEach((x) => (x.amt = ""));
      $("commRows").innerHTML = ""; settings.comm.forEach(commRow);
      recompute(false);
    }));
    el.querySelectorAll(".commsel").forEach((c) => c.addEventListener("change", () => { if (c.value === c.dataset.auto) commMode.delete(c.dataset.id); else commMode.set(c.dataset.id, c.value); saveCommModes(); recompute(false); }));
    el.querySelectorAll(".capsel").forEach((c) => c.addEventListener("change", () => { if (c.value === "rule") capMode.delete(c.dataset.id); else capMode.set(c.dataset.id, c.value); saveCap(); recompute(false); }));
    $("xl").onclick = () => exportXlsx(R);
    $("pdf").onclick = () => window.print();
    if (scroll) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function to12(t) { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }

  function exportXlsx(R) {
    const wb = XLSX.utils.book_new();
    const pay = [["Person", "From", "Tips", "Commission", "Tip + Commission"], ...R.payout.map((p) => [p.name, p.parts.join(" + "), p.tips, p.comm, p.total]), [], ["Total online tips", "", R.gross], ["To captains", "", R.captainTotal], ["Pool after captains", "", R.total], ["Office 15%", "", R.officeTotal], ["Docks 75%", "", R.docksTotal], [(R.fallback || "Fallback") + " dock coverage", "", R.troyDock], ["Docks to Christian", "", R.docksToChristian], ["5% each", "", R.fivePct]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pay), "Payout");
    const hdr = ["Day", "Date", "# Tips", "Tips", "Office 15%", ...R.officeNames.flatMap((n) => [n + " hrs", n + " $"]), (R.fallback || "Fallback") + " office $", "Docks 75%", "10% (5%+5%)"];
    const dl = R.daily.map((x) => [dow(x.d), fmtDate(x.d), x.count, x.dayTips, x.office, ...x.hrs.flatMap((h) => [h.hours, x.split[h.name]]), x.fb, x.docks, x.tenth]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...dl]), "Daily Office Split");
    const dk = [["Dock staff", "Paid hours", "Tip hours (rental window)", "Estimated share (reference)"], ...Object.entries(R.dockPeople).map(([n, v]) => [n, r2(v.paid || 0), r2(v.hours), r2(v.amt)])];
    dk.push([], ["Day", "First out", "Source", "Last back", "Source", "Docks 75%", "Tip hours", "Fixed vQuip times"]);
    R.daily.filter((x) => x.win).forEach((x) => dk.push([fmtDate(x.d), x.win.first_out, x.win.out_source, x.win.last_back, x.win.back_source, x.docks, x.dockDetail, (x.win.anomalies || []).map((a) => a.id + ": " + a.why).join("; ")]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dk), "Dock Estimate");
    const tips = [["Date", "Time", "Booking", "Customer", "Product", "Tip", "Captain", "To captain", "To pool"], ...R.rows.map((r) => [fmtDate(r.date), to12(r.time), r.id, r.customer, r.product, r.tip, r.isCap ? (r.captains.join(", ") || "not in notes") : "", r.toCap, r.pool])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), "Peek Tips");
    const cm = [["Person", "Trip date", "Booking", "Customer", "Booked at", "Peek tag / how", "Boats", "Value", "Tips", "vQuip fee", "Sales", "Rate", "Commission"], ...R.comm.rows.map((r) => [r.payee, fmtDate(r.date), r.id, r.customer, r.booked_at || "", r.how, r.boats, r.value, r.tip || 0, r.vq, r.base, r.rate, r.comm])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cm), "Commissions");
    if (R.notes.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Notes"], ...R.notes.map((n) => [n])]), "Notes");
    XLSX.writeFile(wb, `NFT-Tips-${R.start}-to-${R.end}.xlsx`);
  }

  /* ---------- UI wiring ---------- */
  function commRow(c) {
    const d = document.createElement("div"); d.className = "comm";
    d.innerHTML = `<input class="cn" type="text" aria-label="Name" placeholder="Name" value="${esc(c.name)}"><input class="ca" type="number" step="0.01" min="0" aria-label="Commission amount" placeholder="$0.00" value="${esc(c.amt)}"><button type="button" aria-label="Remove">×</button>`;
    d.querySelector("button").onclick = () => { d.remove(); save(); };
    d.querySelectorAll("input").forEach((i) => i.addEventListener("change", save));
    $("commRows").appendChild(d);
  }
  function initSettings() {
    $("office").value = settings.office; $("fallback").value = settings.fallback; $("five").value = settings.five; $("dockRoles").value = settings.dockRoles;
    $("commNo").value = settings.commNo; $("commRemote").value = settings.commRemote; $("vquipFee").value = settings.vquipFee;
    $("commRows").innerHTML = ""; settings.comm.forEach(commRow);
    ["office", "fallback", "five", "dockRoles", "commNo", "commRemote", "vquipFee"].forEach((id) => $(id).addEventListener("change", save));
    $("addComm").onclick = () => commRow({ name: "", amt: "" });

  }
  // Wipe the previous report and everything it was built from.
  function clearReport() {
    reqId++; cache = null; lastReport = null;
    const r = $("report"); r.innerHTML = ""; r.classList.add("hidden");
  }
  function startOver() {
    clearReport(); timesheet = null;
    $("csv").value = "";
    $("drop").classList.remove("loaded");
    $("dropTitle").textContent = dropTitle0; $("dropSub").textContent = dropSub0;
    $("periodChips").innerHTML = `<span class="muted">Upload the CSV first.</span>`;
    $("start").value = ""; $("end").value = "";
    settings.comm.forEach((c) => (c.amt = "")); $("commRows").innerHTML = ""; settings.comm.forEach(commRow);
    status("Cleared. Upload a timesheet to start a new report.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  let reqId = 0;
  const dropTitle0 = $("dropTitle").textContent, dropSub0 = $("dropSub").textContent;
  function handleFile(file) {
    if (!file) return;
    clearReport(); status("Reading " + file.name + "…");
    const fr = new FileReader();
    fr.onload = () => {
      try {
        timesheet = readTimesheet(String(fr.result), file.name);
        $("drop").classList.add("loaded");
        $("dropTitle").textContent = file.name;
        $("dropSub").textContent = `${timesheet.shifts} shifts · ${fmtDate(timesheet.first)} – ${fmtDate(timesheet.last)} · click to replace`;
        buildChips();
      } catch (err) { timesheet = null; $("drop").classList.remove("loaded"); $("dropTitle").textContent = "Couldn't read that file"; $("dropSub").textContent = err.message; }
    };
    fr.readAsText(file);
    $("csv").value = ""; // so choosing the same file again still reloads it
  }
  function lock() { store.removeItem("nftTipsPw"); $("app").classList.add("hidden"); $("logout").classList.add("hidden"); $("reset").classList.add("hidden"); $("login").classList.remove("hidden"); $("report").classList.add("hidden"); }
  function unlocked() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); $("logout").classList.remove("hidden"); $("reset").classList.remove("hidden"); }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("loginErr").classList.add("hidden");
    store.setItem("nftTipsPw", $("pw").value, $("remember").checked);
    try { await api({ check: true }); $("pw").value = ""; unlocked(); }
    catch (err) { store.removeItem("nftTipsPw"); $("loginErr").textContent = /^Password no longer/.test(err.message) ? "Wrong password." : err.message; $("loginErr").classList.remove("hidden"); }
  });
  $("logout").onclick = () => { startOver(); lock(); };
  $("reset").onclick = startOver;
  $("csv").addEventListener("change", (e) => handleFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  function periodsFor(ts) {
    // halves of each month touched by the file's payroll period (or its shift dates)
    let a = ts.first, z = ts.last;
    const m = String(ts.period || "").match(/(\d{2})\/(\d{2})\/(\d{4})\s*To\s*(\d{2})\/(\d{2})\/(\d{4})/i);
    if (m) { a = `${m[3]}-${m[1]}-${m[2]}`; z = `${m[6]}-${m[4]}-${m[5]}`; }
    const out = []; let [y, mo] = a.split("-").map(Number);
    while (`${y}-${String(mo).padStart(2, "0")}-01` <= z) {
      const last = new Date(y, mo, 0).getDate(), p = `${y}-${String(mo).padStart(2, "0")}`;
      [[`${p}-01`, `${p}-15`], [`${p}-16`, `${p}-${last}`]].forEach(([s, e]) => { if (e >= a && s <= z) out.push([s < a ? a : s, e > z ? z : e]); });
      mo++; if (mo > 12) { mo = 1; y++; }
    }
    if (out.length > 1) out.push([a, z, "whole"]);
    return out;
  }
  const label = (s, e) => { const f = (d) => new Date(d + "T12:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }); return `${f(s)} – ${f(e)}`; };
  function buildChips() {
    const ps = periodsFor(timesheet), box = $("periodChips"); box.innerHTML = "";
    // Whole pay period first, then the half-months inside it.
    const whole = ps.find((p) => p[2]); const ordered = whole ? [whole, ...ps.filter((p) => !p[2])] : ps;
    ordered.forEach(([s, e, w]) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = w ? "Whole pay period (" + label(s, e) + ")" : label(s, e); b.onclick = () => pick(s, e, b); box.appendChild(b); });
    // whole pay period first
    // default: always the full period the CSV covers
    pick(ordered[0][0], ordered[0][1], box.children[0]);
  }
  function pick(s, e, btn) {
    document.querySelectorAll("#periodChips .chip").forEach((c) => c.classList.toggle("on", c === btn));
    $("start").value = s; $("end").value = e; run();
  }
  function recompute(scroll) { if (!cache || !timesheet) return; lastReport = compute(cache.start, cache.end, cache.rows, timesheet, cache.windows, cache.staffBookings); render(lastReport, cache.last_sync, scroll); }
  $("run").onclick = () => { document.querySelectorAll("#periodChips .chip").forEach((c) => c.classList.remove("on")); run(); };
  // Peek data is pulled in pieces of up to 31 days, so any period length works.
  async function fetchRange(start, end) {
    const add = (d, n) => { const x = new Date(d + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
    const out = { rows: [], windows: {}, staffBookings: [], last_sync: null };
    for (let s = start; s <= end; s = add(s, 31)) {
      const e = add(s, 30) < end ? add(s, 30) : end;
      const part = await api({ start: s, end: e });
      out.rows.push(...(part.rows || [])); out.staffBookings.push(...(part.staffBookings || [])); Object.assign(out.windows, part.windows || {});
      if (part.last_sync && (!out.last_sync || part.last_sync > out.last_sync)) out.last_sync = part.last_sync;
    }
    return out;
  }
  async function run() {
    const start = $("start").value, end = $("end").value;
    if (!start || !end || start > end) return status("Pick a valid start and end date.", true);
    if (!timesheet) return status("Upload the Homebase timesheet CSV first.", true);
    save(); clearReport(); const my = reqId;
    status(`Pulling tips from Peek for ${label(start, end)}…`);
    try {
      const data = await fetchRange(start, end);
      if (my !== reqId) return; // a newer request replaced this one
      cache = { start, end, rows: data.rows, windows: data.windows || {}, staffBookings: data.staffBookings || [], last_sync: data.last_sync };
      recompute(true);
      status(`${label(start, end)} · ${data.rows.length} tipped bookings from Peek.`);
    } catch (err) { if (my === reqId) status(err.message, true); }
  }
  function status(t, bad) { $("status").textContent = t; $("status").style.color = bad ? "var(--err)" : ""; }

  initSettings();
  if (store.getItem("nftTipsPw")) unlocked();
})();
