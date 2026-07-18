# DummyJSON API — Measured Findings

These findings were measured against the live DummyJSON API on 2026-07-18. They are the
source of truth for this project: do not re-derive them, and do not code against remembered
API behaviour that contradicts them.

## Measured API facts (drive the whole design)

- **194 products** total (not 200). `limit=0` returns all; ~88KB with `select`; ~340ms median cold fetch.
- **`/products/search?q=` is a whole-phrase substring matcher** over title/description/brand/tags — not tokenized, not semantic, no field awareness. `cheap phone` → 0. `iPhone Apple` (reversed) → 0. `beauty` (a real category slug) → 0. `Apple` → 10, including a $1.99 grocery apple.
- **No price, rating, stock, or category filter parameter exists anywhere in the API.**
- Undocumented but working: `sortBy`/`order` on `/products/search` and `/products/category/{slug}`.
- Catalog in the prompt costs 16.8K–80.8K tokens/turn; 6 selected cards cost 428. Filtering in code is ~40× cheaper and exact.
- **Logistics fields are secretly enums** → normalize at ingest: `shippingInformation` (6 distinct) → `shippingDays`; `returnPolicy` (5) → `returnDays`; `warrantyInformation` (10) → `warrantyMonths` (Lifetime → Infinity).
- All 194 have `discountPercentage` (median 11%), but at a $400 threshold list vs discounted both yield 156 products — zero difference. **Filter on list price, display both.**
- **`minimumOrderQuantity` is the sharpest edge case:** a $9.99 mascara has minOrder 48 → $479.52 actual spend.
- **`brand` missing on 92/194** — soft ranking signal only; brand exclusion needs title-substring fallback.
- Ratings median 3.86, only 44 products ≥4.5 — calibrate "highly rated".

## Supporting details

Referenced directly by the rest of the project.

**The 24 category slugs:** `beauty, fragrances, furniture, groceries, home-decoration, kitchen-accessories, laptops, mens-shirts, mens-shoes, mens-watches, mobile-accessories, motorcycle, skin-care, smartphones, sports-accessories, sunglasses, tablets, tops, vehicle, womens-bags, womens-dresses, womens-jewellery, womens-shoes, womens-watches`

**Distribution:** price $0.79–$36,999.99 (median $34.99) · availability 176 In Stock / 14 Low Stock / 4 Out of Stock · categories with zero brand data: kitchen-accessories (30), groceries (27), sports-accessories (17)

**Exact enum→numeric mappings (exhaustive across all 194):**

- shipping → days (6 values): overnight→1, 1-2 business days→2, 3-5 business days→5, 1 week→7, 2 weeks→14, 1 month→30
- return → days (5 values): No return policy→0, 7 days→7, 30 days→30, 60 days→60, 90 days→90
- warranty → months (10 values): No warranty→0, 1 week→0.25, 1 month→1, 3 months→3, 6 months→6, 1 year→12, 2 year→24, 3 year→36, 5 year→60, Lifetime→Infinity

All enum values above carry the literal `warranty` / `return policy` suffix as returned by the
API (e.g. `'No warranty'`, `'Lifetime warranty'`, `'7 days return policy'`).

**Rounding rule:** `effectivePrice` and `minimumSpend` are rounded to 2 decimal places via
`Math.round(value * 100) / 100`.

Verified drift examples — do not substitute the mascara here. `9.99 * 48` lands exactly on
`479.52` in V8 and needs no rounding, so it does **not** demonstrate the rule (an earlier
revision of this doc claimed otherwise and was wrong; a test written against it fails).
Genuine drift: `5.49 * 20` → `109.80000000000001`, and roughly half the catalog drifts on
`effectivePrice`, e.g. `9.99 @ 10.48%` → `8.943048000000001` and
`549.99 @ 11.05%` → `489.21610499999997`.
