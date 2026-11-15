"use strict";

/** Чистые функции расчётов: используются и страницей, и проверяются тестами в CI. */
window.BondCalc = {
  DAY_MS: 86400000,
  YEAR_DAYS: 365.25,

  parseISO: function (s) { return new Date(s + "T00:00:00Z"); },

  yearsToMaturity: function (matDate, now) {
    const n = now || new Date();
    return (this.parseISO(matDate) - n) / (this.YEAR_DAYS * this.DAY_MS);
  },

  couponPerYear: function (couponValue, periodDays) {
    if (!periodDays) return null;
    return couponValue * 365 / periodDays;
  },

  couponYieldPct: function (couponValue, periodDays, pricePct, faceValue) {
    const priceRub = pricePct / 100 * faceValue;
    if (!priceRub) return null;
    return this.couponPerYear(couponValue, periodDays) / priceRub * 100;
  },

  /** Доходность без реинвестирования: купонная + дисконт, размазанный по сроку. */
  simpleYieldPct: function (couponYieldPct, pricePct, years) {
    if (couponYieldPct === null) return null;
    if (!years || years <= 0) return couponYieldPct;
    return couponYieldPct + (100 - pricePct) / pricePct / years * 100;
  },

  couponCount: function (nextCouponISO, matDateISO, periodDays) {
    if (!nextCouponISO || !periodDays) return 0;
    let d = this.parseISO(nextCouponISO).getTime();
    const mat = this.parseISO(matDateISO).getTime();
    let n = 0;
    while (d <= mat) { n += 1; d += periodDays * this.DAY_MS; }
    return n;
  },

  calcPurchase: function (amount, pricePct, faceValue, accruedInt) {
    const perBond = pricePct / 100 * faceValue + accruedInt;
    if (perBond <= 0 || amount < perBond) {
      return { perBond: perBond, qty: 0, cost: 0, change: amount };
    }
    const qty = Math.floor(amount / perBond);
    return { perBond: perBond, qty: qty, cost: qty * perBond, change: amount - qty * perBond };
  },

  calcCoupons: function (qty, nCoupons, couponValue, taxPct) {
    const gross = nCoupons * couponValue * qty;
    const tax = gross * taxPct / 100;
    return { gross: gross, tax: tax, net: gross - tax };
  },

  netAnnualPct: function (proceeds, cost, days) {
    if (cost <= 0 || days <= 0 || proceeds <= 0) return null;
    return (Math.pow(proceeds / cost, this.YEAR_DAYS / days) - 1) * 100;
  },

  /** Чистая доходность (XIRR): покупка сегодня, купоны после налога по графику,
   *  номинал при погашении. Возвращает % годовых или null. */
  netYieldXirr: function (cost, netCoupon, nCoupons, firstCouponDays, periodDays, faceValue, daysTotal) {
    if (!(cost > 0) || !nCoupons || nCoupons < 1 || !periodDays || !(daysTotal > 0)) return null;
    const flows = [];
    for (let k = 0; k < nCoupons; k++) {
      flows.push([Math.min(firstCouponDays + k * periodDays, daysTotal), netCoupon]);
    }
    flows.push([daysTotal, faceValue]);
    const pv = (r) => {
      let s = -cost;
      for (const f of flows) s += f[1] / Math.pow(1 + r, f[0] / 365.25);
      return s;
    };
    const HI = 5;
    if (pv(HI) >= 0) return null;
    let lo = 0;
    if (pv(lo) <= 0) {
      lo = null;
      for (const r0 of [-0.1, -0.25, -0.5, -0.75, -0.9]) {
        if (pv(r0) > 0) { lo = r0; break; }
      }
      if (lo === null) return null;
    }
    let hi = HI;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (pv(mid) > 0) lo = mid; else hi = mid;
    }
    return ((lo + hi) / 2) * 100;
  }
};
