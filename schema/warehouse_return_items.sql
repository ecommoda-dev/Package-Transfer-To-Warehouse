-- ══════════════════════════════════════════════════════════════
-- warehouse_return_items — دفتر القطع الراجعة للمخزن (قطعة لكل سطر)
-- القاعدة: ecommoda-dev-logs (نفس قاعدة `logs`)
--
-- 🔴 بيتنفّذ مرة واحدة من D1 Console قبل نشر الـ Workers.
--    `IF NOT EXISTS` بيخلّي إعادة التشغيل آمنة.
--    ⛔ **ماتلزقش الملف ده في D1 Console** — الكونسول بيحوّل اللصق لسطر واحد،
--    فأول تعليق `--` بيبلع باقي الأمر كله (`incomplete input: SQLITE_ERROR`).
--    الصق **`warehouse_return_items.console.sql`** (سطر واحد بلا تعليقات · نفس المخطط بالحرف).
--
-- الكُتّاب (عقد — أي تغيير في عمود هنا يتعمل في الريبوهين في نفس التمريرة):
--   ① partial-delivery-worker              ← سطر `pending` لكل قطعة اتشالت (source = partial_delivery)
--   ② package-transfer-to-warehouse-worker ← بيقفل السطور (received) + بيكتب
--                                            قطع الأوردرات الكاملة وقت الاستلام
--                                            (source = order_return · received | missing)
-- ══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS warehouse_return_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  source       TEXT    NOT NULL,              -- 'partial_delivery' | 'order_return'
  cycle_key    TEXT    NOT NULL,              -- 'partial' | 'S1' | Return GID (دورة S2)
  order_id     TEXT    NOT NULL,              -- الرقم المجرد (legacyResourceId)
  order_name   TEXT,                          -- '#61251'
  machine      TEXT,                          -- 'S1' | 'S2'
  line_item_id TEXT    NOT NULL,              -- gid://shopify/LineItem/…
  variant_id   TEXT,
  sku          TEXT,
  barcode      TEXT,                          -- باركود المنتج (variant.barcode) — اللي بيتسكن
  title        TEXT,
  unit_index   INTEGER NOT NULL,              -- قطعة لكل سطر: الكمية ٢ = سطرين (1 و2)
  status       TEXT    NOT NULL,              -- 'pending' | 'received' | 'missing'
  created_at   TEXT    NOT NULL,
  created_by   TEXT,
  received_at  TEXT,
  received_by  TEXT,
  receive_mode TEXT,                          -- 'scan' | 'manual'
  UNIQUE (source, order_id, cycle_key, line_item_id, unit_index)
);

CREATE INDEX IF NOT EXISTS idx_wri_status  ON warehouse_return_items (status, source, created_at);
CREATE INDEX IF NOT EXISTS idx_wri_barcode ON warehouse_return_items (barcode, status, created_at);
CREATE INDEX IF NOT EXISTS idx_wri_order   ON warehouse_return_items (order_id);
