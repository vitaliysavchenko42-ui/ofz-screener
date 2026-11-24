"""Проверка формул доходности и калькулятора ОФЗ.

Эталонная реализация повторяет site/js/calculator.js (window.BondCalc).
"""
import unittest
from datetime import date, datetime, timezone


def years_to_maturity(mat_date: date, now: datetime) -> float:
    mat = datetime(mat_date.year, mat_date.month, mat_date.day, tzinfo=timezone.utc)
    return (mat - now).total_seconds() / (365.25 * 86400)


def coupon_per_year(coupon_value: float, period_days: int) -> float:
    return coupon_value * 365 / period_days


def coupon_yield_pct(coupon_value: float, period_days: int, price_pct: float, face_value: float) -> float:
    price_rub = price_pct / 100 * face_value
    return coupon_per_year(coupon_value, period_days) / price_rub * 100


def simple_yield_pct(coupon_yield: float, price_pct: float, years: float) -> float:
    if years <= 0:
        return coupon_yield
    return coupon_yield + (100 - price_pct) / price_pct / years * 100


def coupon_count(next_coupon: date, mat_date: date, period_days: int) -> int:
    d, n = next_coupon, 0
    while d <= mat_date:
        n += 1
        d = date.fromordinal(d.toordinal() + period_days)
    return n


def calc_purchase(amount: float, price_pct: float, face_value: float, accrued_int: float):
    per_bond = price_pct / 100 * face_value + accrued_int
    if per_bond <= 0 or amount < per_bond:
        return {"per_bond": per_bond, "qty": 0, "cost": 0, "change": amount}
    qty = int(amount // per_bond)
    return {"per_bond": per_bond, "qty": qty, "cost": qty * per_bond, "change": amount - qty * per_bond}


def calc_coupons(qty: int, n_coupons: int, coupon_value: float, tax_pct: float):
    gross = n_coupons * coupon_value * qty
    tax = gross * tax_pct / 100
    return {"gross": gross, "tax": tax, "net": gross - tax}


def calc_iis_tax(gross_coupons: float, positive_reval: float, limit_rub: float, rate_pct: float):
    fin_res = gross_coupons + max(0.0, positive_reval)
    taxable = max(0.0, fin_res - limit_rub)
    return {"fin_res": fin_res, "taxable": taxable, "tax": taxable * rate_pct / 100}


def net_annual_pct(proceeds: float, cost: float, days: int) -> float:
    if cost <= 0 or days <= 0 or proceeds <= 0:
        raise ValueError
    return (pow(proceeds / cost, 365.25 / days) - 1) * 100


def net_yield_xirr(cost, net_coupon, n_coupons, first_coupon_days, period_days, face_value, days_total, final_adj=0.0):
    if cost <= 0 or n_coupons < 1 or period_days <= 0 or days_total <= 0:
        return None
    flows = [(min(first_coupon_days + k * period_days, days_total), net_coupon) for k in range(n_coupons)]
    flows.append((days_total, face_value + final_adj))

    def pv(r):
        return -cost + sum(a / (1 + r) ** (d / 365.25) for d, a in flows)

    HI = 5.0
    if pv(HI) >= 0:
        return None
    lo = 0.0
    if pv(lo) <= 0:
        lo = None
        for r0 in (-0.1, -0.25, -0.5, -0.75, -0.9):
            if pv(r0) > 0:
                lo = r0
                break
        if lo is None:
            return None
    hi = HI
    for _ in range(200):
        mid = (lo + hi) / 2
        if pv(mid) > 0:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2 * 100


class TestFormulas(unittest.TestCase):
    def test_coupon_per_year(self):
        self.assertAlmostEqual(coupon_per_year(62.5, 365), 62.5, places=6)
        self.assertAlmostEqual(coupon_per_year(91.25, 182), 183.00137, places=4)

    def test_coupon_yield(self):
        # цена 95% от номинала 1000 => 950 ₽; годовой купон 62.5 ₽ => 6.5789%
        self.assertAlmostEqual(coupon_yield_pct(62.5, 365, 95.0, 1000), 6.578947, places=4)

    def test_simple_yield(self):
        # купонная 6.5789% + дисконт (5/95)/2 года => 9.2105%
        self.assertAlmostEqual(simple_yield_pct(6.578947, 95.0, 2.0), 9.210526, places=4)
        self.assertAlmostEqual(simple_yield_pct(6.578947, 95.0, 0.0), 6.578947, places=4)

    def test_coupon_count(self):
        self.assertEqual(coupon_count(date(2026, 1, 1), date(2026, 7, 1), 182), 1)
        self.assertEqual(coupon_count(date(2026, 1, 1), date(2027, 1, 1), 182), 3)
        self.assertEqual(coupon_count(date(2026, 1, 1), date(2025, 12, 1), 182), 0)

    def test_calc_purchase(self):
        p = calc_purchase(100000, 95.0, 1000, 10)
        self.assertEqual(p["per_bond"], 960.0)
        self.assertEqual(p["qty"], 104)
        self.assertAlmostEqual(p["cost"], 99840.0, places=6)
        self.assertAlmostEqual(p["change"], 160.0, places=6)
        p2 = calc_purchase(500, 95.0, 1000, 10)
        self.assertEqual(p2["qty"], 0)
        self.assertEqual(p2["cost"], 0)

    def test_calc_coupons(self):
        c = calc_coupons(10, 4, 62.5, 13)
        self.assertAlmostEqual(c["gross"], 2500.0, places=6)
        self.assertAlmostEqual(c["tax"], 325.0, places=6)
        self.assertAlmostEqual(c["net"], 2175.0, places=6)

    def test_calc_iis_tax_within_limit(self):
        # прибыль ниже лимита 30 млн => налога нет
        r = calc_iis_tax(20_000_000, 1_000_000, 30_000_000, 15)
        self.assertAlmostEqual(r["fin_res"], 21_000_000.0, places=6)
        self.assertEqual(r["taxable"], 0.0)
        self.assertEqual(r["tax"], 0.0)

    def test_calc_iis_tax_over_limit(self):
        # валовые купоны 28 млн + положительная переоценка 4 млн:
        # сверх лимита 2 млн облагаются по 15% => 300 000 ₽
        r = calc_iis_tax(28_000_000, 4_000_000, 30_000_000, 15)
        self.assertAlmostEqual(r["taxable"], 2_000_000.0, places=6)
        self.assertAlmostEqual(r["tax"], 300_000.0, places=6)

    def test_calc_iis_tax_negative_reval_not_deducted(self):
        # отрицательная переоценка (премия к номиналу) не увеличивает льготу
        r = calc_iis_tax(28_000_000, -4_000_000, 30_000_000, 15)
        self.assertAlmostEqual(r["taxable"], 0.0, places=6)
        self.assertEqual(r["tax"], 0.0)

    def test_net_annual(self):
        # +10% за ~год => около 10% годовых
        self.assertAlmostEqual(net_annual_pct(1100, 1000, 365), 10.0, delta=0.05)
        with self.assertRaises(ValueError):
            net_annual_pct(1100, 0, 365)

    def test_xirr_matches_moex_ytm(self):
        # ОФЗ 26254-подобный поток: лот 839.43, купон 64.82 каждые 182 дня,
        # 28 купонов, номинал 1000. IRR ~16.75% — согласуется с YTM Мосбиржи.
        x = net_yield_xirr(839.43, 64.82, 28, 155, 182, 1000, 5070)
        self.assertAlmostEqual(x, 16.75, delta=0.15)

    def test_xirr_after_tax(self):
        # после НДФЛ 18% на купоны доходность к погашению заметно ниже доналоговой
        x = net_yield_xirr(839.43, 64.82 * 0.82, 28, 155, 182, 1000, 5070)
        self.assertAlmostEqual(x, 13.8, delta=0.2)

    def test_xirr_final_adj_default_zero(self):
        # без корректировки и с нулевой корректировкой результат идентичен
        x0 = net_yield_xirr(839.43, 64.82, 28, 155, 182, 1000, 5070)
        x1 = net_yield_xirr(839.43, 64.82, 28, 155, 182, 1000, 5070, 0)
        self.assertAlmostEqual(x0, x1, places=10)

    def test_xirr_iis_tax_at_end(self):
        # налог ИИС платится при закрытии счёта: отрицательная корректировка
        # номинала в дату погашения снижает доходность по сравнению с безналоговой
        x = net_yield_xirr(839.43, 64.82, 28, 155, 182, 1000, 5070, -50.0)
        y = net_yield_xirr(839.43, 64.82, 28, 155, 182, 1000, 5070)
        self.assertTrue(x < y)

    def test_xirr_edges(self):
        self.assertIsNone(net_yield_xirr(0, 64.82, 28, 155, 182, 1000, 5070))
        self.assertIsNone(net_yield_xirr(839.43, 64.82, 0, 155, 182, 1000, 5070))


if __name__ == "__main__":
    unittest.main()
