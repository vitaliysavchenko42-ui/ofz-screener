"use strict";

const ISS_URL = "https://iss.moex.com/iss/engines/stock/markets/bonds/boards/TQOB/securities.json" +
  "?iss.meta=off&iss.only=securities,securities.columns,marketdata,marketdata.columns";
const STORE_KEY = "ofz-screen-filters";

const B = window.BondCalc;

const state = {
  bonds: [],
  sortKey: "simpleYieldPct",
  sortDir: -1,
  search: "",
  groups: { short: false, mid: false, long: false },
  calcGroups: { short: false, mid: false, long: false },
  calcSecid: null
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

const GROUP_LABEL = { short: "0–3 года", mid: "3–6 лет", long: "6+ лет" };

const fmt = (n, d) => {
  const digits = d === undefined ? 2 : d;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtRub = (n, d) => fmt(n, d === undefined ? 0 : d) + " ₽";
const fmtDate = (iso) => {
  if (!iso || iso.length !== 10) return iso || "—";
  const p = iso.split("-");
  return p[2] + "." + p[1] + "." + p[0];
};

function groupOf(years) {
  return years <= 3 ? "short" : years <= 6 ? "mid" : "long";
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
      calcGroups: state.calcGroups
    }));
  } catch (e) { /* приватный режим браузера — просто не сохраняем */ }
}

function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (!s) return "tab-table";
    state.calcGroups = s.calcGroups || state.calcGroups;
    return s.tab || "tab-table";
  } catch (e) {
    return "tab-table";
  }
}

function applyControls() {
  document.getElementById("g-short").checked = state.groups.short;
  document.getElementById("g-mid").checked = state.groups.mid;
  document.getElementById("g-long").checked = state.groups.long;
  document.getElementById("f-search").value = state.search;
  document.getElementById("c-short").checked = state.calcGroups.short;
  document.getElementById("c-mid").checked = state.calcGroups.mid;
  document.getElementById("c-long").checked = state.calcGroups.long;
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
    const mdCols = data.marketdata ? data.marketdata.columns : [];
    const mdIdx = Object.fromEntries(mdCols.map((c, i) => [c, i]));
    const mdBySec = new Map((data.marketdata ? data.marketdata.data : [])
      .map(r => [r[mdIdx.SECID], r]));
    // Длинные имена колонок находим по признакам — так в коде не появляется
    // длинных строк, где легко ошибиться в одной букве.
    const colCouponValue = cols.find(c => c.includes("COUPON") && c.endsWith("VALUE"));
    const colCouponPeriod = cols.find(c => c.includes("COUPON") && c.endsWith("PERIOD"));
    const now = new Date();

    state.bonds = data.securities.data
      .map(r => {
        const md = mdBySec.get(r[idx.SECID]);
        // В течение торгов — цена последней сделки; вне торгов — закрытие прошлой сессии
        const livePrice = md && md[mdIdx.LAST] > 0 ? md[mdIdx.LAST] : null;
        const liveYtm = md && md[mdIdx.YIELD] > 0 ? md[mdIdx.YIELD] : null;
        return {
          secid: r[idx.SECID],
          name: r[idx.SHORTNAME],
          pricePct: livePrice !== null ? livePrice : r[idx.PREVPRICE],
          priceSource: livePrice !== null ? "live" : "prev",
          faceValue: r[idx.FACEVALUE],
          accruedInt: r[idx.ACCRUEDINT],
          couponValue: colCouponValue ? r[idx[colCouponValue]] : null,
          couponPeriod: colCouponPeriod ? r[idx[colCouponPeriod]] : null,
          nextCoupon: r[idx.NEXTCOUPON],
          matDate: r[idx.MATDATE],
          ytm: liveYtm !== null ? liveYtm : r[idx.YIELDATPREVWAPRICE],
          faceUnit: r[idx.FACEUNIT]
        };
      })
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

    const prevDate = data.securities.data.length ? data.securities.data[0][idx.PREVDATE] : "";
    const systime = (data.marketdata && data.marketdata.data.length)
      ? (data.marketdata.data[0][mdIdx.SYSTIME] || "") : "";
    const dataDate = systime ? systime.slice(0, 10) : new Date().toISOString().slice(0, 10);
    const anyLive = state.bonds.some(b => b.priceSource === "live");
    document.getElementById("updated-at").textContent = anyLive
      ? "Данные Мосбиржи: " + fmtDate(dataDate) + " · цены текущих торгов"
      : "Данные Мосбиржи: " + fmtDate(prevDate) + " · цены закрытия прошлой сессии";

    if (!state.calcSecid || !state.bonds.some(b => b.secid === state.calcSecid)) {
      const first = state.bonds.slice()
        .sort((a, b) => B.parseISO(a.matDate) - B.parseISO(b.matDate))[0];
      state.calcSecid = first ? first.secid : null;
    }

    renderTable();
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

function selectCalcBond(secid) {
  state.calcSecid = secid;
  const b = state.bonds.find(x => x.secid === secid);
  document.getElementById("calc-search").value = b ? b.name : "";
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
  const nowMs = Date.now();
  const firstCouponDays = b.nextCoupon
    ? Math.max(Math.round((B.parseISO(b.nextCoupon).getTime() - nowMs) / 86400000), 0)
    : 0;
  const net = p.qty
    ? B.netYieldXirr(p.perBond, b.couponValue * (1 - tax / 100), nCoupons,
        firstCouponDays, b.couponPeriod, b.faceValue, days)
    : null;

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
      updateStatus();
    })
  );

  const fSearch = document.getElementById("f-search");
  fSearch.addEventListener("input", () => {
    state.search = fSearch.value;
    // Автоподстановка при единственном совпадении: подставляем полное название
    const q = state.search.trim().toLowerCase();
    if (q) {
      const matches = state.bonds.filter(b =>
        b.name.toLowerCase().includes(q) || b.secid.toLowerCase().includes(q));
      if (matches.length === 1) {
        state.search = matches[0].name;
        fSearch.value = matches[0].name;
      }
    }
    persist();
    renderTable();
    updateStatus();
  });

  ["c-short", "c-mid", "c-long"].forEach(id =>
    document.getElementById(id).addEventListener("change", e => {
      state.calcGroups[id.slice(2)] = e.target.checked;
      persist();
    })
  );

  const search = document.getElementById("calc-search");
  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();
    // Как в таблице: единственное совпадение — подставляем и выбираем; точное — выбираем
    if (q) {
      const matches = calcPool().filter(b =>
        b.name.toLowerCase().includes(q) || b.secid.toLowerCase().includes(q));
      if (matches.length === 1) {
        selectCalcBond(matches[0].secid);
      } else {
        const exact = matches.find(b =>
          b.secid.toLowerCase() === q || b.name.toLowerCase() === q);
        if (exact) selectCalcBond(exact.secid);
      }
    }
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
