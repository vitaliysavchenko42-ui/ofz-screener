"use strict";

const ISS_URL = "https://iss.moex.com/iss/engines/stock/markets/bonds/boards/TQOB/securities.json" +
  "?iss.meta=off&iss.only=securities,securities.columns";

const B = window.BondCalc;

const state = {
  bonds: [],
  sortKey: "simpleYieldPct",
  sortDir: -1,
  search: "",
  minYears: null,
  maxYears: null,
  minYield: null
};

const COLUMNS = [
  { key: "name", label: "Название" },
  { key: "pricePct", label: "Цена, %" },
  { key: "priceRub", label: "Цена, ₽" },
  { key: "matDate", label: "Погашение" },
  { key: "years", label: "Лет" },
  { key: "couponYieldPct", label: "Купон, %" },
  { key: "simpleYieldPct", label: "Простая, %" },
  { key: "ytm", label: "YTM, %" }
];

const fmt = (n, d) => {
  const digits = d === undefined ? 2 : d;
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};
const fmtRub = (n, d) => fmt(n, d === undefined ? 0 : d) + " ₽";

async function loadData() {
  const status = document.getElementById("table-status");
  status.textContent = "Загружаю данные Мосбиржи…";
  try {
    const resp = await fetch(ISS_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    const cols = data.securities.columns;
    const idx = Object.fromEntries(cols.map((c, i) => [c, i]));
    const now = new Date();

    state.bonds = data.securities.data
      .map(r => ({
        secid: r[idx.SECID],
        name: r[idx.SHORTNAME],
        pricePct: r[idx.PREVPRICE],
        faceValue: r[idx.FACEVALUE],
        accruedInt: r[idx.ACCRUEDINT],
        couponValue: r[idx.COUPONVALUE],
        couponPeriod: r[idx.COUPONPERIOD],
        nextCoupon: r[idx.NEXTCOUPON],
        matDate: r[idx.MATDATE],
        ytm: r[idx.YIELDATPREVWAPRICE],
        faceUnit: r[idx.FACEUNIT]
      }))
      .filter(b =>
        b.faceUnit === "RUB" &&
        b.pricePct > 0 &&
        b.matDate &&
        B.parseISO(b.matDate) > now
      )
      .map(b => {
        const years = Math.max(B.yearsToMaturity(b.matDate, now), 0);
        const cyp = B.couponYieldPct(b.couponValue, b.couponPeriod, b.pricePct, b.faceValue);
        b.priceRub = b.pricePct / 100 * b.faceValue;
        b.years = years;
        b.couponYieldPct = cyp;
        b.simpleYieldPct = B.simpleYieldPct(cyp, b.pricePct, years);
        return b;
      });

    document.getElementById("updated-at").textContent =
      "Данные Мосбиржи: " + new Date().toLocaleTimeString("ru-RU");
    status.textContent = "Бумаг в таблице: " + state.bonds.length;

    fillCalcSelect();
    renderTable();
    renderCalc();
  } catch (e) {
    status.textContent = "Не удалось загрузить данные: " + e.message;
  }
}

function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.bonds.filter(b => {
    if (q && !(b.name.toLowerCase().includes(q) || b.secid.toLowerCase().includes(q))) return false;
    if (state.minYears !== null && b.years < state.minYears) return false;
    if (state.maxYears !== null && b.years > state.maxYears) return false;
    if (state.minYield !== null && b.simpleYieldPct < state.minYield) return false;
    return true;
  });
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

function renderTable() {
  const wrap = document.getElementById("table-wrap");
  const rows = sortRows(filtered());

  const thead = "<tr>" + COLUMNS.map(c => {
    const sorted = c.key === state.sortKey ? " sorted" : "";
    const arrow = c.key === state.sortKey ? (state.sortDir === -1 ? " ▼" : " ▲") : "";
    return '<th data-key="' + c.key + '" class="' + sorted.trim() + '">' + c.label + arrow + "</th>";
  }).join("") + "</tr>";

  const tbody = rows.map(b =>
    "<tr>" +
      '<td class="bond-name">' + b.name + "</td>" +
      "<td>" + fmt(b.pricePct, 2) + "</td>" +
      "<td>" + fmt(b.priceRub, 2) + "</td>" +
      "<td>" + b.matDate + "</td>" +
      "<td>" + fmt(b.years, 1) + "</td>" +
      "<td>" + fmt(b.couponYieldPct, 2) + "</td>" +
      '<td class="simple-yield">' + fmt(b.simpleYieldPct, 2) + "</td>" +
      "<td>" + fmt(b.ytm, 2) + "</td>" +
    "</tr>"
  ).join("");

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
      renderTable();
    })
  );
}

function fillCalcSelect() {
  const sel = document.getElementById("calc-bond");
  const current = sel.value;
  const options = state.bonds
    .slice()
    .sort((a, b) => B.parseISO(a.matDate) - B.parseISO(b.matDate))
    .map(b => {
      const label = b.name + " · " + b.matDate + " · " + fmt(b.simpleYieldPct, 2) + "%";
      return '<option value="' + b.secid + '">' + label + "</option>";
    });
  sel.innerHTML = options.join("");
  if (current && state.bonds.some(b => b.secid === current)) sel.value = current;
}

function renderCalc() {
  const box = document.getElementById("calc-results");
  const secid = document.getElementById("calc-bond").value;
  const b = state.bonds.find(x => x.secid === secid);
  if (!b) { box.innerHTML = ""; return; }

  const amount = parseFloat(document.getElementById("calc-amount").value) || 0;
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
    item("Цена бумаги", fmt(b.pricePct, 2) + "% = " + fmtRub(b.priceRub)) +
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

function bindUI() {
  document.getElementById("refresh").addEventListener("click", loadData);

  document.getElementById("f-search").addEventListener("input", e => {
    state.search = e.target.value; renderTable();
  });
  document.getElementById("f-min-years").addEventListener("input", e => {
    state.minYears = e.target.value === "" ? null : parseFloat(e.target.value); renderTable();
  });
  document.getElementById("f-max-years").addEventListener("input", e => {
    state.maxYears = e.target.value === "" ? null : parseFloat(e.target.value); renderTable();
  });
  document.getElementById("f-min-yield").addEventListener("input", e => {
    state.minYield = e.target.value === "" ? null : parseFloat(e.target.value); renderTable();
  });
  document.getElementById("f-reset").addEventListener("click", () => {
    state.search = ""; state.minYears = null; state.maxYears = null; state.minYield = null;
    document.getElementById("f-search").value = "";
    document.getElementById("f-min-years").value = "";
    document.getElementById("f-max-years").value = "";
    document.getElementById("f-min-yield").value = "";
    renderTable();
  });

  ["calc-bond", "calc-amount", "calc-tax"].forEach(id =>
    document.getElementById(id).addEventListener("input", renderCalc)
  );
  document.getElementById("calc-bond").addEventListener("change", renderCalc);
}

bindUI();
loadData();
