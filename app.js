(() => {
  "use strict";
  const API = "https://lavdvbscgvtojenavuec.supabase.co/functions/v1/nft-tips-data";
  const $ = (id) => document.getElementById(id);
  const mem = {}; const store = { getItem: (k) => mem[k] ?? null, setItem: (k, v) => (mem[k] = v), removeItem: (k) => delete mem[k] };
  const DEFAULTS = {
    office: "Rosa Hernandez, Rachel McFarland",
    fallback: "Troy McKay",
    five: "Troy McKay, Tabitha",
    dockRoles: "Dock, ON CALL",
    comm: [{ name: "Rosa Hernandez", amt: "" }, { name: "Annie", amt: "" }],
  };
  let settings = load();
  let timesheet = null; // {byDate: {date: [{name, role, hours}]}, dates:Set, fileName}
  let lastReport = null;

  function load() {
    return JSON.parse(JSON.stringify(DEFAULTS));
  }
  function save() {
    settings.office = $("office").value; settings.fallback = $("fallback").value;
    settings.five = $("five").value; settings.dockRoles = $("dockRoles").value;
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
      (byDate[d] ||= []).push({ name, role: (r[cols["role"]] || "").trim(), hours });
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
  function compute(start, end, rows, ts) {
    const officeNames = list(settings.office), fallback = settings.fallback.trim(), five = list(settings.five);
    const dockRoles = list(settings.dockRoles).map(norm);
    const isOffice = (n) => officeNames.some((o) => matches(o, n));
    const dayList = days(start, end);
    const tipsByDay = {}; rows.forEach((r) => { (tipsByDay[r.date] ||= []).push(r); });
    const total = r2(rows.reduce((s, r) => s + r.tip, 0));
    const notes = [];
    const officePay = Object.fromEntries(officeNames.map((n) => [n, 0]));
    let fallbackOffice = 0;
    const dockPeople = {}; let dockUnassigned = 0;
    const daily = dayList.map((d) => {
      const dayTips = r2((tipsByDay[d] || []).reduce((s, r) => s + r.tip, 0));
      const office = r2(dayTips * 0.15), docks = r2(dayTips * 0.75), tenth = r2(dayTips * 0.10);
      const shifts = ts.byDate[d] || [];
      const hrs = officeNames.map((n) => ({ name: n, hours: r2(shifts.filter((s) => matches(n, s.name)).reduce((a, s) => a + s.hours, 0)) }));
      const working = hrs.filter((h) => h.hours > 0);
      const split = Object.fromEntries(officeNames.map((n) => [n, 0])); let fb = 0;
      if (working.length) { const amts = splitByHours(office, working); working.forEach((w, i) => { split[w.name] = amts[i]; officePay[w.name] += amts[i]; }); }
      else { fb = office; fallbackOffice += office; }
      // dock estimate (reference only)
      const dockShifts = {};
      shifts.forEach((s) => { if (!isOffice(s.name) && !(fallback && matches(fallback, s.name)) && dockRoles.includes(norm(s.role)) && s.hours > 0) dockShifts[s.name] = (dockShifts[s.name] || 0) + s.hours; });
      const dp = Object.entries(dockShifts).map(([name, hours]) => ({ name, hours }));
      const dockSplit = {};
      if (dp.length && docks > 0) { const a = splitByHours(docks, dp); dp.forEach((p, i) => { dockSplit[p.name] = a[i]; (dockPeople[p.name] ||= { hours: 0, amt: 0 }); dockPeople[p.name].hours += p.hours; dockPeople[p.name].amt += a[i]; }); }
      else if (docks > 0) dockUnassigned += docks;
      dp.forEach((p) => { if (!(p.name in dockSplit)) { (dockPeople[p.name] ||= { hours: 0, amt: 0 }); dockPeople[p.name].hours += p.hours; } });
      return { d, count: (tipsByDay[d] || []).length, dayTips, office, docks, tenth, hrs, split, fb, dockSplit, dockHours: dp.reduce((a, p) => a + p.hours, 0) };
    });
    const officeTotal = r2(daily.reduce((s, x) => s + x.office, 0));
    const docksTotal = r2(total * 0.75), fivePct = r2(total * 0.05);

    // Payout
    const payout = [];
    const add = (name, tips, label) => { let p = payout.find((x) => matches(x.name, name)); if (!p) payout.push((p = { name, tips: 0, parts: [], comm: 0 })); p.tips = r2(p.tips + tips); if (label) p.parts.push(label); };
    officeNames.forEach((n) => add(n, r2(officePay[n]), "office by hours"));
    if (fallback) add(fallback, r2(fallbackOffice), "office days with no office staff");
    five.forEach((n) => add(n, fivePct, "5%"));
    settings.comm.forEach((c) => { const a = parseFloat(c.amt); if (c.name.trim()) { add(c.name.trim(), 0); const p = payout.find((x) => matches(x.name, c.name.trim())); p.comm = r2(p.comm + (isNaN(a) ? 0 : a)); } });
    payout.forEach((p) => (p.total = r2(p.tips + p.comm)));

    // Checks
    if (ts.first > start || ts.last < end) notes.push(`The timesheet covers ${fmtDate(ts.first)}–${fmtDate(ts.last)}, which doesn't cover the whole period. Days outside it count as "no office staff".`);
    const fbDays = daily.filter((x) => x.fb > 0);
    if (fbDays.length && fallback) notes.push(`No office staff clocked in on ${fbDays.map((x) => fmtDate(x.d)).join(", ")}, so those office shares (${money(r2(fbDays.reduce((s, x) => s + x.fb, 0)))}) go to ${fallback}.`);
    daily.forEach((x) => { if (x.docks > 0 && !x.dockHours) notes.push(`${dow(x.d)} ${fmtDate(x.d)}: no dock hours found, so ${money(x.docks)} of the dock estimate is unassigned.`); });
    const diff = r2(total - officeTotal - docksTotal - fivePct * 2);
    if (Math.abs(diff) > 0.05) notes.push(`Check: office + docks + 5% shares differ from total tips by ${money(diff)}.`);
    return { start, end, rows, daily, total, officeTotal, docksTotal, fivePct, payout, officeNames, fallback, five, dockPeople, dockUnassigned: r2(dockUnassigned), notes };
  }

  /* ---------- Render ---------- */
  function render(R, lastSync) {
    const el = $("report");
    const kp = (k, v, cls = "") => `<div class="kpi ${cls}"><div class="k">${k}</div><div class="v">${v}</div></div>`;
    const syncTxt = lastSync ? new Date(lastSync).toLocaleString("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) + " PT" : "unknown";
    const officeHdr = R.officeNames.map((n) => `<th>${esc(n.split(" ")[0])} hrs</th><th>${esc(n.split(" ")[0])} $</th>`).join("");
    const dailyRows = R.daily.map((x) => `<tr><td class="l">${dow(x.d)} ${fmtDate(x.d)}</td><td>${x.count || ""}</td><td>${money(x.dayTips)}</td><td>${money(x.office)}</td>${x.hrs.map((h) => `<td class="${h.hours ? "" : "dim"}">${h.hours ? h.hours.toFixed(2) : "–"}</td><td class="${x.split[h.name] ? "hl" : "dim"}">${x.split[h.name] ? money(x.split[h.name]) : "–"}</td>`).join("")}<td class="${x.fb ? "hl" : "dim"}">${x.fb ? money(x.fb) : "–"}</td><td>${money(x.docks)}</td><td>${money(x.tenth)}</td></tr>`).join("");
    const sum = (f) => R.daily.reduce((s, x) => s + f(x), 0);
    const dailyTotal = `<tr class="total"><td class="l">Total</td><td>${R.rows.length}</td><td>${money(R.total)}</td><td>${money(R.officeTotal)}</td>${R.officeNames.map((n, i) => `<td>${sum((x) => x.hrs[i].hours).toFixed(2)}</td><td>${money(r2(sum((x) => x.split[n])))}</td>`).join("")}<td>${money(r2(sum((x) => x.fb)))}</td><td>${money(r2(sum((x) => x.docks)))}</td><td>${money(r2(sum((x) => x.tenth)))}</td></tr>`;
    const payRows = R.payout.map((p) => `<tr><td class="l">${esc(p.name)}</td><td class="l muted">${esc(p.parts.join(" + ") || (p.comm ? "commission only" : ""))}</td><td>${money(p.tips)}</td><td>${p.comm ? money(p.comm) : "–"}</td><td>${money(p.total)}</td></tr>`).join("");
    const dockRows = Object.entries(R.dockPeople).sort((a, b) => b[1].amt - a[1].amt).map(([n, v]) => `<tr><td class="l">${esc(n)}</td><td>${v.hours.toFixed(2)}</td><td>${money(r2(v.amt))}</td></tr>`).join("");
    const detail = R.rows.map((r) => `<tr><td class="l">${fmtDate(r.date)}</td><td class="l">${esc(to12(r.time))}</td><td class="l">${esc(r.id)}</td><td class="l">${esc(r.customer)}</td><td class="l">${esc(r.product || "")}</td><td>${money(r.tip)}</td></tr>`).join("");
    const notes = R.notes.length ? R.notes.map((n) => `<li>${esc(n)}</li>`).join("") : `<li class="ok">No issues found.</li>`;
    el.innerHTML = `
      <div class="rhead"><div><h1>Tips ${fmtDate(R.start)} – ${fmtDate(R.end)}</h1><div class="muted">Peek tips (cancelled bookings excluded) · Peek data synced ${esc(syncTxt)} · Hours from ${esc(timesheet.fileName)}</div></div>
        <div class="btns"><button class="ghost" id="xl" type="button">Download Excel</button><button class="ghost" id="pdf" type="button">Print / Save PDF</button></div></div>
      <div class="kpis">${kp("Total online tips", money(R.total), "main")}${kp("Office 15%", money(R.officeTotal))}${kp("Docks 75%", money(R.docksTotal))}${kp(esc(R.five[0] || "5%") + " 5%", money(R.fivePct))}${kp(esc(R.five[1] || "5%") + " 5%", money(R.fivePct))}</div>
      <ul class="notes">${notes}</ul>
      <div class="card"><h2>Payout</h2><div class="tablewrap"><table class="payout"><thead><tr><th>Person</th><th class="l">From</th><th>Tips</th><th>Commission</th><th>Tip + commission</th></tr></thead><tbody>${payRows}</tbody></table></div>
        <p class="foot">Docks 75% (${money(R.docksTotal)}) goes to Christian for the dock split. Office is rounded per day and the 5% shares per period, so totals can differ by a few cents.</p></div>
      <div class="card"><h2>Daily office split</h2><div class="tablewrap"><table><thead><tr><th>Day</th><th># tips</th><th>Tips</th><th>Office 15%</th>${officeHdr}<th>${esc((R.fallback || "Fallback").split(" ")[0])} office $</th><th>Docks 75%</th><th>10% (5%+5%)</th></tr></thead><tbody>${dailyRows}${dailyTotal}</tbody></table></div>
        <p class="foot">Office 15% each day is split by Homebase paid hours. If nobody listed as office staff clocked in, it goes to ${esc(R.fallback || "the fallback person")}.</p></div>
      <div class="card pb"><h2>Dock pool by hours <span class="badge">Estimate for Christian</span></h2><div class="tablewrap"><table><thead><tr><th>Dock staff</th><th>Hours</th><th>Estimated share</th></tr></thead><tbody>${dockRows || `<tr><td class="l" colspan="3">No dock hours in this timesheet.</td></tr>`}</tbody></table></div>
        <p class="foot">Each day's 75% split by that day's hours (roles: ${esc(settings.dockRoles)}). Reference only. Christian's split is final.${R.dockUnassigned ? " Unassigned: " + money(R.dockUnassigned) + "." : ""}</p></div>
      <div class="card pb"><h2>Tip detail from Peek</h2><div class="tablewrap"><table><thead><tr><th>Date</th><th class="l">Time</th><th class="l">Booking</th><th class="l">Customer</th><th class="l">Product</th><th>Tip</th></tr></thead><tbody>${detail}<tr class="total"><td class="l" colspan="5">Total</td><td>${money(R.total)}</td></tr></tbody></table></div></div>`;
    el.classList.remove("hidden");
    $("xl").onclick = () => exportXlsx(R);
    $("pdf").onclick = () => window.print();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  function to12(t) { const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }

  function exportXlsx(R) {
    const wb = XLSX.utils.book_new();
    const pay = [["Person", "From", "Tips", "Commission", "Tip + Commission"], ...R.payout.map((p) => [p.name, p.parts.join(" + "), p.tips, p.comm, p.total]), [], ["Total online tips", "", R.total], ["Office 15%", "", R.officeTotal], ["Docks 75% (to Christian)", "", R.docksTotal], ["5% each", "", R.fivePct]];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(pay), "Payout");
    const hdr = ["Day", "Date", "# Tips", "Tips", "Office 15%", ...R.officeNames.flatMap((n) => [n + " hrs", n + " $"]), (R.fallback || "Fallback") + " office $", "Docks 75%", "10% (5%+5%)"];
    const dl = R.daily.map((x) => [dow(x.d), fmtDate(x.d), x.count, x.dayTips, x.office, ...x.hrs.flatMap((h) => [h.hours, x.split[h.name]]), x.fb, x.docks, x.tenth]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([hdr, ...dl]), "Daily Office Split");
    const dk = [["Dock staff", "Hours", "Estimated share (reference)"], ...Object.entries(R.dockPeople).map(([n, v]) => [n, r2(v.hours), r2(v.amt)])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dk), "Dock Estimate");
    const tips = [["Date", "Time", "Booking", "Customer", "Product", "Tip"], ...R.rows.map((r) => [fmtDate(r.date), to12(r.time), r.id, r.customer, r.product, r.tip])];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tips), "Peek Tips");
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
    $("commRows").innerHTML = ""; settings.comm.forEach(commRow);
    ["office", "fallback", "five", "dockRoles"].forEach((id) => $(id).addEventListener("change", save));
    $("addComm").onclick = () => commRow({ name: "", amt: "" });
    const [s, e] = halfMonth("prev"); $("start").value = s; $("end").value = e;
    document.querySelectorAll(".chip").forEach((b) => (b.onclick = () => { const [a, z] = halfMonth(b.dataset.q); $("start").value = a; $("end").value = z; }));
  }
  function handleFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        timesheet = readTimesheet(String(fr.result), file.name);
        $("drop").classList.add("loaded");
        $("dropTitle").textContent = file.name;
        $("dropSub").textContent = `${timesheet.shifts} shifts · ${fmtDate(timesheet.first)} – ${fmtDate(timesheet.last)} · tap to replace`;
      } catch (err) { timesheet = null; $("drop").classList.remove("loaded"); $("dropTitle").textContent = "Couldn't read that file"; $("dropSub").textContent = err.message; }
    };
    fr.readAsText(file);
  }
  function lock() { store.removeItem("nftTipsPw"); $("app").classList.add("hidden"); $("logout").classList.add("hidden"); $("login").classList.remove("hidden"); $("report").classList.add("hidden"); }
  function unlocked() { $("login").classList.add("hidden"); $("app").classList.remove("hidden"); $("logout").classList.remove("hidden"); }

  $("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault(); $("loginErr").classList.add("hidden");
    store.setItem("nftTipsPw", $("pw").value);
    try { await api({ check: true }); $("pw").value = ""; unlocked(); }
    catch (err) { store.removeItem("nftTipsPw"); $("loginErr").textContent = /^Password no longer/.test(err.message) ? "Wrong password." : err.message; $("loginErr").classList.remove("hidden"); }
  });
  $("logout").onclick = lock;
  $("csv").addEventListener("change", (e) => handleFile(e.target.files[0]));
  const drop = $("drop");
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => handleFile(e.dataTransfer.files[0]));

  $("run").onclick = async () => {
    const start = $("start").value, end = $("end").value;
    if (!start || !end || start > end) return status("Pick a valid start and end date.", true);
    if (!timesheet) return status("Upload the Homebase timesheet CSV first.", true);
    save(); $("run").disabled = true; status("Pulling tips from Peek…");
    try {
      const data = await api({ start, end });
      lastReport = compute(start, end, data.rows, timesheet);
      render(lastReport, data.last_sync);
      status(`Done · ${data.rows.length} tipped bookings.`);
    } catch (err) { status(err.message, true); }
    finally { $("run").disabled = false; }
  };
  function status(t, bad) { $("status").textContent = t; $("status").style.color = bad ? "var(--err)" : ""; }

  initSettings();
  if (store.getItem("nftTipsPw")) unlocked();
})();
