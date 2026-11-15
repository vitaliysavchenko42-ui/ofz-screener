"use strict";

const ISS_URL = "https://iss.moex.com/iss/engines/stock/markets/bonds/boards/TQOB/securities.json" +
  "?iss.meta=off&iss.only=securities,securities.columns";
const STORE_KEY = "ofz-screen-filters";

const B = window.BondCalc;

const state = {
  bonds: [],
  sortKey: "simpleYieldPct",
  sortDir: -1,
  search: "",
  groups: { short: false, mid: false, long: false },
  calcGroups: { short: false, mid: false, long: false },
  minYears: 0,
  maxYears: 30,
  minYield: 0,
  minCoupon: 0,
  minCurrent: 0,
  minYtm: 0,
  calcSecid: null,
  suggestIndex: -1,
  suggestList: []
};

const COLUMNS = [
  { key: "name", label: "Название", tag: "Название" },
  { key: "priceRub", label: "Цена, ₽", tag: "Цена, ₽" },
  { key: "matDate", label: "Погашение", tag: "Погашение" },
  { key: "years", label: "Лет", tag: "Лет" },
  { key: "couponRatePct", label: "Купон (номинал), %", tag: "Купон (номинал), %" },
  { key: "couponYieldPct", label: "Текущая купонная, %", tag: "Текущая купонная, %" },
  { key: "simpleYieldPct", label: "Простая, %", tag: "Простая, %" },
  { key: "ytm", label: "YTM, %", tag: "YTM, %" }
];

const GROUP_LABEL = { short: "до 2 лет", mid: "2–5 лет", long: "5+ лет" };

const fmt = (n, d) => {
  const digits = d === undefined ? 2 : d;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtRub = (n, d) => fmt(n, d === undefined ? 0 : d) + " ₽";

function groupOf(years) {
  return years <= 2 ? "short" : years <= 5 ? "mid" : "long";
}

function anyGroup(g) {
  return g.short || g.mid || g.long;
}

function heat(n) {
  if (n === null || n === undefined || Number.isNaN(n)) return "num";
  if (n >= 15) return "num hot";
  if (n >= 13) return "num warm";
  return "num";
}

function persist() {
  try {
    const active = document.querySelector(".tab.active");
    localStorage.setItem(STORE_KEY, JSON.stringify({
      tab: active ? active.id : "tab-table",
      search: state.search,
      groups: state.groups,
      calcGroups: state.calcGroups,
      minYears: state.minYears,
      maxYears: state.maxYears,
      minYield: state.minYield,
      minCoupon: state.minCoupon,
      minCurrent: state.minCurrent,
      minYtm: state.minYtm
    }));
  } catch (e) { /* приватный режим браузера — просто не сохраняем */ }
}

function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!s) return "tab-table";
    state.search = s.search || "";
    state.groups = s.groups || state.groups;
    state.calcGroups = s.calcGroups || state.calcGroups;
    state.minYears = s.minYears || 0;
    state.maxYears = (s.maxYears === 0 ? 0 : (s.maxYears || 30));
    state.minYield = s.minYield || 0;
    state.minCoupon = s.minCoupon || 0;
    state.minCurrent = s.minCurrent || 0;
    state.minYtm = s.minYtm || 0;
    return s.tab || "tab-table";
  } catch (e) {
    return "tab-table";
  }
}

function applyControls() {
  document.getElementById("f-search").value = state.search;
  document.getElementById("g-short").checked = state.groups.short;
  document.getElementById("g-mid").checked = state.groups.mid;
  document.getElementById("g-long").checked = state.groups.long;
  document.getElementById("c-short").checked = state.calcGroups.short;
  document.getElementById("c-mid").checked = state.calcGroups.mid;
  document.getElementById("c-long").checked = state.calcGroups.long;
  document.getElementById("f-min-years").value = state.minYears;
  document.getElementById("f-max-years").value = state.maxYears;
  document.getElementById("f-min-yield").value = state.minYield;
  document.getElementById("f-min-coupon").value = state.minCoupon;
  document.getElementById("f-min-current").value = state.minCurrent;
  document.getElementById("f-min-ytm").value = state.minYtm;
  document.getElementById("o-min-years").textContent = state.minYears;
  document.getElementById("o-max-years").textContent = state.maxYears;
  document.getElementById("o-min-yield").textContent = state.minYield;
  document.getElementById("o-min-coupon").textContent = state.minCoupon;
  document.getElementById("o-min-current").textContent = state.minCurrent;
  document.getElementById("o-min-ytm").textContent = state.minYtm;
}

async function loadData() {
  const status = document.getElementById("table-status");
  status.textContent = "Загружаю данные Мосбиржи…";
  try {
    const resp = await fetch(ISS_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const cols = data.securities.columns;
    const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
    // Длинные имена колонок находим по признакам — так в коде не появляется
    // длинных строк, где легко ошибиться в одной букве.
    const colCouponValue = cols.find(c => c.includes("COUPON") && c.endsWith("VALUE"));
    const colCouponPeriod = cols.find(c => c.includes("COUPON") && c.endsWith("PERIOD"));
    const now = new Date();

    state.bonds = data.securities.data
      .map(r => ({
        secid: r[idx.SECID],
        name: r[idx.SHORTNAME],
        pricePct: r[idx.PREVPRICE],
        faceValue: r[idx.FACEVALUE],
        accruedInt: r[idx.ACCRUEDINT],
        couponValue: colCouponValue ? r[idx[colCouponValue]] : null,
        couponPeriod: colCouponPeriod ? r[idx[colCouponPeriod]] : null,
        nextCoupon: r[idx.NEXTCOUPON],
        matDate: r[idx.MATDATE],
        ytm: r[idx.YIELDATPREVWAPRICE],
        faceUnit: r[idx.FACEUNIT]
      }))
      .filter(b =>
        // Мосбиржа обозначает рубль в FACEUNIT как "SUR"; валюта исключается явно.
        (b.faceUnit === "SUR" || b.faceUnit === "RUB") &&
        b.pricePct > 0 &&
        b.matDate &&
        B.parseISO(b.matDate) > now
      )
      .map(b => {
        const years = Math.max(B.yearsToMaturity(b.matDate, now), 0);
        const cyp = B.couponYieldPct(b.couponValue, b.couponPeriod, b.pricePct, b.faceValue);
        b.priceRub = b.pricePct / 100 * b.faceValue;
        b.years = years;
        b.couponRatePct = B.couponPerYear(b.couponValue, b.couponPeriod) / b.faceValue * 100;
        b.couponYieldPct = cyp;
        b.simpleYieldPct = B.simpleYieldPct(cyp, b.pricePct, years);
        return b;
      });

    document.getElementById("updated-at").textContent =
      "Данные Мосбиржи: " + new Date().toLocaleTimeString("ru-RU");

    if (!state.calcSecid || !state.bonds.some(b => b.secid === state.calcSecid)) {
      const first = state.bonds.slice()
        .sort((a, b) => B.parseISO(a.matDate) - B.parseISO(b.matDate))[0];
      state.calcSecid = first ? first.secid : null;
    }

    renderChart();
    renderTable();
    renderSuggestions();
    renderCalc();
    updateStatus();
  } catch (e) {
    status.textContent = "Не удалось загрузить данные: " + e.message +
      " — проверьте соединение и нажмите «Обновить»";
  }
}

function passesFilters(b) {
  const q = state.search.trim().toLowerCase();
  if (q && !(b.name.toLowerCase().includes(q) || b.secid.toLowerCase().includes(q))) return false;
  if (anyGroup(state.groups) && !state.groups[groupOf(b.years)]) return false;
  if (state.minYears > 0 && b.years < state.minYears) return false;
  if (state.maxYears < 30 && b.years > state.maxYears) return false;
  if (state.minYield > 0 && b.simpleYieldPct < state.minYield) return false;
  if (state.minCoupon > 0 && b.couponRatePct < state.minCoupon) return false;
  if (state.minCurrent > 0 && b.couponYieldPct < state.minCurrent) return false;
  if (state.minYtm > 0 && b.ytm < state.minYtm) return false;
  return true;
}

function filtered() {
  return state.bonds.filter(passesFilters);
}

function sortRows(rows) {
  const k = state.sortKey, dir = state.sortDir;
  return rows.slice().sort((a, b) => {
    let va = a[k], vb = b[k];
    if (k === "name") return String(va).localeCompare(String(vb), "ru") * dir;
    if (k === "matDate") { va = B.parseISO(va).getTime(); vb = B.parseISO(vb).getTime(); }
    return (va - vb) * dir;
  });
}

function updateStatus() {
  const total = state.bonds.length;
  const shown = filtered().length;
  document.getElementById("table-status").textContent =
    "Всего бумаг: " + total + " · показано: " + shown;
}

function renderChart() {
  const box = document.getElementById("chart");
  if (!box) return;
  const pts = state.bonds
    .filter(b => b.simpleYieldPct !== null && b.simpleYieldPct !== undefined && !Number.isNaN(b.simpleYieldPct))
    .slice()
    .sort((a, b) => b.simpleYieldPct - a.simpleYieldPct);
  if (!pts.length) {
    box.innerHTML = "";
    return;
  }
  const W = 760, H = 280, padL = 46, padR = 16, padT = 18, padB = 36;
  const maxX = Math.max.apply(null, pts.map(b => b.years));
  const lo = Math.min.apply(null, pts.map(b => b.simpleYieldPct));
  const hi = Math.max.apply(null, pts.map(b => b.simpleYieldPct));
  const spanY = Math.max(hi - lo, 2);
  const x = years => padL + (W - padL - padR) * years / Math.max(maxX, 1);
  const y = v => padT + (H - padT - padB) * (1 - (v - lo) / spanY);

  let svg = '<svg viewBox="0 0 ' + W + " " + H + '" class="scatter" preserveAspectRatio="xMidYMid meet">';
  for (let gx = 0; gx <= 30; gx += 5) {
    svg += '<line x1="' + x(gx).toFixed(1) + '" y1="' + padT + '" x2="' + x(gx).toFixed(1) +
      '" y2="' + (H - padB) + '" class="grid"/>';
    svg += '<text x="' + x(gx).toFixed(1) + '" y="' + (H - padB + 16) +
      '" class="axis" text-anchor="middle">' + gx + "</text>";
  }
  svg += '<text x="' + (W / 2) + '" y="' + (H - 4) + '" class="axis" text-anchor="middle">лет до погашения</text>';
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const v = lo + spanY * t / ticks;
    svg += '<line x1="' + padL + '" y1="' + y(v).toFixed(1) + '" x2="' + (W - padR) +
      '" y2="' + y(v).toFixed(1) + '" class="grid"/>';
    svg += '<text x="' + (padL - 6) + '" y="' + (y(v) + 4).toFixed(1) +
      '" class="axis" text-anchor="end">' + v.toFixed(1) + "</text>";
  }
  for (const b of pts) {
    svg += '<circle class="pt ' + groupOf(b.years) +
      '" cx="' + x(b.years).toFixed(1) +
      '" cy="' + y(b.simpleYieldPct).toFixed(1) +
      '" r="5" data-secid="' + b.secid + '"><title>' +
      b.name + " · " + b.years.toFixed(1) + " лет · простая " +
      b.simpleYieldPct.toFixed(2) + "%</title></circle>";
  }
  svg += "</svg>";
  box.innerHTML = svg;
  box.querySelectorAll(".pt").forEach(el =>
    el.addEventListener("click", () => {
      switchTab("calc");
      selectCalcBond(el.dataset.secid);
    })
  );
}

function renderTable() {
  const wrap = document.getElementById("table-wrap");
  const rows = sortRows(filtered());

  const thead = "<tr>" + COLUMNS.map(c => {
    const sorted = c.key === state.sortKey ? " sorted" : "";
    const arrow = c.key === state.sortKey ? (state.sortDir === -1 ? " ▼" : " ▲") : "";
    return '<th data-key="' + c.key + '" class="' + sorted.trim() + '">' + c.label + arrow + "</th>";
  }).join("") + "</tr>";

  const tbody = rows.map(b => {
    const g = groupOf(b.years);
    return "<tr>" +
      '<td class="bond-name" data-l="Название"><span class="pill ' + g + '">' +
      GROUP_LABEL[g] + "</span>" + b.name + "</td>" +
      '<td data-l="Цена, ₽">' + fmt(b.priceRub, 2) + "</td>" +
      '<td data-l="Погашение">' + b.matDate + "</td>" +
      '<td data-l="Лет">' + fmt(b.years, 1) + "</td>" +
      '<td data-l="Купон (номинал), %">' + fmt(b.couponRatePct, 2) + "</td>" +
      '<td class="' + heat(b.couponYieldPct) + '" data-l="Текущая купонная, %">' +
      fmt(b.couponYieldPct, 2) + "</td>" +
      '<td class="' + heat(b.simpleYieldPct) + '" data-l="Простая, %">' +
      fmt(b.simpleYieldPct, 2) + "</td>" +
      '<td data-l="YTM, %">' + fmt(b.ytm, 2) + "</td>" +
    "</tr>";
  }).join("");

  wrap.innerHTML = '<table><thead>' + thead + "</thead><tbody>" + tbody + "</tbody></table>";

  wrap.querySelectorAll("th").forEach(th =>
    th.addEventListener("click", () => {
      const key = th.dataset.key;
      if (state.sortKey === key) {
        state.sortDir = -state.sortDir;
      } else {
        state.sortKey = key;
        state.sortDir = key === "name" ? 1 : -1;
      }
      persist();
      renderTable();
    })
  );
}

function calcPool() {
  return state.bonds.filter(b =>
    anyGroup(state.calcGroups) ? state.calcGroups[groupOf(b.years)] : true
  );
}

function renderSuggestions() {
  const box = document.getElementById("calc-suggestions");
  const q = document.getElementById("calc-search").value.trim().toLowerCase();
  const pool = calcPool().slice()
    .sort((a, b) => B.parseISO(a.matDate) - B.parseISO(b.matDate));
  const list = q
    ? pool.filter(b => b.name.toLowerCase().includes(q) || b.secid.toLowerCase().includes(q))
    : pool;
  state.suggestList = list.slice(0, 12);
  if (!state.suggestList.length) {
    box.innerHTML = "";
    box.classList.add("hidden");
    return;
  }
  box.innerHTML = state.suggestList.map((b, i) =>
    '<div class="sug' + (i === state.suggestIndex ? " active" : "") +
    '" data-secid="' + b.secid + '"><span>' + b.name + "</span>" +
    '<span class="sug-meta">' + b.matDate + " · купон " + fmt(b.couponRatePct, 2) +
    "% · простая " + fmt(b.simpleYieldPct, 2) + "%</span></div>"
  ).join("");
  box.classList.remove("hidden");
  box.querySelectorAll(".sug").forEach(el =>
    el.addEventListener("mousedown", e => {
      e.preventDefault();
      selectCalcBond(el.dataset.secid);
    })
  );
}

function selectCalcBond(secid, keepText) {
  state.calcSecid = secid;
  const b = state.bonds.find(x => x.secid === secid);
  if (!keepText) {
    document.getElementById("calc-search").value = b ? b.name : "";
    document.getElementById("calc-suggestions").classList.add("hidden");
  }
  renderCalc();
}

function renderCalc() {
  const box = document.getElementById("calc-results");
  const sel = document.getElementById("calc-selected");
  const b = state.bonds.find(x => x.secid === state.calcSecid);
  if (!b) {
    sel.textContent = "Выберите бумагу в списке выше";
    box.innerHTML = "";
    return;
  }

  sel.textContent = "Выбрано: " + b.name + " · погашение " + b.matDate +
    " · купон " + fmt(b.couponRatePct, 2) + "% (" + fmt(B.couponPerYear(b.couponValue, b.couponPeriod), 2) + " ₽/год)" +
    " · простая доходность " + fmt(b.simpleYieldPct, 2) + "%";

  const amountRaw = document.getElementById("calc-amount").dataset.value ||
    document.getElementById("calc-amount").value.replace(/\D/g, "");
  const amount = parseFloat(amountRaw) || 0;
  const tax = parseFloat(document.getElementById("calc-tax").value);

  const p = B.calcPurchase(amount, b.pricePct, b.faceValue, b.accruedInt);
  const days = Math.max(Math.round(B.yearsToMaturity(b.matDate) * B.YEAR_DAYS), 0);
  const nCoupons = B.couponCount(b.nextCoupon, b.matDate, b.couponPeriod);
  const c = B.calcCoupons(p.qty, nCoupons, b.couponValue, tax);
  const proceeds = p.qty * b.faceValue + c.net;
  const gain = proceeds - p.cost;
  const net = B.netAnnualPct(proceeds, p.cost, days);

  const item = (label, value, accent) =>
    '<div class="result"><div class="label">' + label + '</div><div class="value' +
    (accent ? " accent" : "") + '">' + value + "</div></div>";

  box.innerHTML = '<div class="results">' +
    item("Цена бумаги", fmtRub(b.priceRub)) +
    item("НКД", fmtRub(b.accruedInt)) +
    item("Цена лота (бумага + НКД)", fmtRub(p.perBond)) +
    item("Количество бумаг", p.qty + " шт. · сдача " + fmtRub(p.change)) +
    item("Затраты", fmtRub(p.cost)) +
    item("Купонов до погашения", nCoupons + " шт. · " + fmtRub(c.gross)) +
    item("Налог на купоны (" + tax + "%)", "− " + fmtRub(c.tax)) +
    item("Итог к погашению", fmtRub(proceeds), true) +
    item("Прибыль после налогов", (gain >= 0 ? "+ " : "− ") + fmtRub(Math.abs(gain)), true) +
    item("Чистая доходность", fmt(net, 2) + " % годовых", true) +
    "</div>";
}

function switchTab(name) {
  document.getElementById("tab-table").classList.toggle("active", name === "table");
  document.getElementById("tab-calc").classList.toggle("active", name === "calc");
  document.getElementById("view-table").classList.toggle("hidden", name !== "table");
  document.getElementById("view-calc").classList.toggle("hidden", name !== "calc");
  persist();
}

function bindUI() {
  document.getElementById("tab-table").addEventListener("click", () => switchTab("table"));
  document.getElementById("tab-calc").addEventListener("click", () => switchTab("calc"));
  document.getElementById("refresh").addEventListener("click", loadData);

  ["g-short", "g-mid", "g-long"].forEach(id =>
    document.getElementById(id).addEventListener("change", e => {
      state.groups[id.slice(2)] = e.target.checked;
      persist();
      renderTable();
      renderChart();
      updateStatus();
    })
  );
  ["c-short", "c-mid", "c-long"].forEach(id =>
    document.getElementById(id).addEventListener("change", e => {
      state.calcGroups[id.slice(2)] = e.target.checked;
      persist();
      renderSuggestions();
    })
  );

  document.getElementById("f-search").addEventListener("input", e => {
    state.search = e.target.value;
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });

  const minYears = document.getElementById("f-min-years");
  const maxYears = document.getElementById("f-max-years");
  minYears.addEventListener("input", () => {
    if (parseFloat(minYears.value) > parseFloat(maxYears.value)) maxYears.value = minYears.value;
    document.getElementById("o-min-years").textContent = minYears.value;
    state.minYears = parseFloat(minYears.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });
  maxYears.addEventListener("input", () => {
    if (parseFloat(maxYears.value) < parseFloat(minYears.value)) minYears.value = maxYears.value;
    document.getElementById("o-max-years").textContent = maxYears.value;
    state.maxYears = parseFloat(maxYears.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });
  document.getElementById("f-min-yield").addEventListener("input", e => {
    document.getElementById("o-min-yield").textContent = e.target.value;
    state.minYield = parseFloat(e.target.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });
  document.getElementById("f-min-coupon").addEventListener("input", e => {
    document.getElementById("o-min-coupon").textContent = e.target.value;
    state.minCoupon = parseFloat(e.target.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });
  document.getElementById("f-min-current").addEventListener("input", e => {
    document.getElementById("o-min-current").textContent = e.target.value;
    state.minCurrent = parseFloat(e.target.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });
  document.getElementById("f-min-ytm").addEventListener("input", e => {
    document.getElementById("o-min-ytm").textContent = e.target.value;
    state.minYtm = parseFloat(e.target.value);
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });

  document.getElementById("f-reset").addEventListener("click", () => {
    state.search = ""; state.minYears = 0; state.maxYears = 30; state.minYield = 0;
    state.minCoupon = 0; state.minCurrent = 0; state.minYtm = 0;
    state.groups = { short: false, mid: false, long: false };
    ["g-short", "g-mid", "g-long"].forEach(id => { document.getElementById(id).checked = false; });
    document.getElementById("f-search").value = "";
    document.getElementById("f-min-years").value = 0;
    document.getElementById("f-max-years").value = 30;
    document.getElementById("f-min-yield").value = 0;
    document.getElementById("o-min-years").textContent = "0";
    document.getElementById("o-max-years").textContent = "30";
    document.getElementById("o-min-yield").textContent = "0";
    document.getElementById("f-min-coupon").value = 0;
    document.getElementById("f-min-current").value = 0;
    document.getElementById("f-min-ytm").value = 0;
    document.getElementById("o-min-coupon").textContent = "0";
    document.getElementById("o-min-current").textContent = "0";
    document.getElementById("o-min-ytm").textContent = "0";
    persist();
    renderTable();
    renderChart();
    updateStatus();
  });

  const search = document.getElementById("calc-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    state.suggestIndex = -1;
    renderSuggestions();
    // Автоподстановка: единственный вариант или точное совпадение с тикером/названием
    if (state.suggestList.length === 1) {
      selectCalcBond(state.suggestList[0].secid, true);
    } else {
      const exact = state.suggestList.find(b =>
        b.secid.toLowerCase() === q || b.name.toLowerCase() === q);
      if (exact) selectCalcBond(exact.secid, true);
    }
  });
  search.addEventListener("keydown", e => {
    const box = document.getElementById("calc-suggestions");
    const hidden = box.classList.contains("hidden");
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (hidden || !state.suggestList.length) return;
      e.preventDefault();
      const step = e.key === "ArrowDown" ? 1 : -1;
      state.suggestIndex = (state.suggestIndex + step + state.suggestList.length) % state.suggestList.length;
      renderSuggestions();
      const act = box.querySelector(".sug.active");
      if (act) act.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      if (!hidden && state.suggestIndex >= 0 && state.suggestList[state.suggestIndex]) {
        e.preventDefault();
        selectCalcBond(state.suggestList[state.suggestIndex].secid);
      } else if (state.suggestList.length === 1) {
        e.preventDefault();
        selectCalcBond(state.suggestList[0].secid);
      }
    } else if (e.key === "Escape") {
      box.classList.add("hidden");
    }
  });
  search.addEventListener("focus", renderSuggestions);
  search.addEventListener("blur", () => {
    setTimeout(() => document.getElementById("calc-suggestions").classList.add("hidden"), 150);
  });

  const amount = document.getElementById("calc-amount");
  const amountRange = document.getElementById("calc-amount-range");
  const formatSum = (v) => (Number.isFinite(v) && v > 0 ? Math.round(v).toLocaleString("ru-RU") : "");
  amount.addEventListener("input", () => {
    const digits = amount.value.replace(/\D/g, "");
    if (!digits) {
      amount.dataset.value = "0";
      amount.value = "";
    } else {
      const v = parseInt(digits, 10);
      amount.dataset.value = String(v);
      amount.value = formatSum(v);
      if (v >= 10000 && v <= 5000000) amountRange.value = v;
    }
    renderCalc();
  });
  amountRange.addEventListener("input", () => {
    amount.dataset.value = amountRange.value;
    amount.value = formatSum(parseFloat(amountRange.value));
    renderCalc();
  });
  document.getElementById("calc-tax").addEventListener("change", renderCalc);
}

const restoredTab = restore();
applyControls();
bindUI();
loadData().then(() => {
  if (restoredTab === "tab-calc") switchTab("calc");
});
