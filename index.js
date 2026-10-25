// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: package-transfer-to-warehouse-worker — EcomModa
// Tool:   قسم استلام المرتجعات (Package Transfer To Warehouse)
//
// skills: worker-builder v3.10.0 · constants v3.1.0 · order-lifecycle v1.8.0
//         · shopify-graphql-helper v1.1.0 · html-builder v6.6.0 — 22-10-2026
//
// 🔴 **v1.10.0 (25-10-2026 · طلب أحمد) — تابين جداد: «أوردرات معدّلة» و«تحويل بوسطة»**
//    (`§EDITED` تحت): endpoint جديد `get_ready_edited` (استعلام **مشترك** للتابين) و`mode`
//    في `scan` (`returned` | `edited` | `edited_bosta`). ⚠️ `get_ready_to_warehouse` و
//    `order_items`/`receive_order` (mode = returned بس) **ما اتغيّروش**.
//
// 🔴 **v1.5.0 (22-10-2026 · طلب أحمد) — الاستلام قطعة قطعة + دفتر القطع
//    الراجعة** (`§RECEIVE` تحت): أربع endpoints جداد (`order_items` ·
//    `receive_order` · `get_return_items` · `receive_item`) وجدول D1 جديد
//    `warehouse_return_items` (`schema/warehouse_return_items.sql`).
//    ⚠️ `scan` و`get_ready_to_warehouse` **ما اتغيّروش ولا حرف**. وصفر قيمة
//    `type` جديدة في `logs` (نفس `update`/`rejected`).
//
// 🔴 **الحارس الديناميكي لقيم اللوج (الطبقة ٥ · worker-builder Step 7-ج)**
//    اتضاف في `1.4.1` — `writeLog` بتكتب الصف عادي حتى لو `(tool, type)`
//    مش مسجّل في `LOG_REGISTRY` (§LOG-REG تحت)، وبتعلّمه `extra._unregistered`
//    + صف UPSERT في `log_value_alerts`. **مفيش رفض كتابة أبدًا.**
//
// 🔴 الأداة دي **مالهاش واجهة مستقلة** — الواجهة الوحيدة هي
//    `warehouse-return.html` جوّه `Warehouse-Operations-Center`. الريبو ده
//    Worker وبس (نفس قرار `Package-Transfer-To-Office` بالحرف).
//
// 🔴 **بتكتب `custom.package_whereabouts_s1`/`_s2` = 'Warehouse'** — عهدة
//    الطرد الفعلية، مش حالة الأوردر. القاعدة الكاملة في
//    `ecommoda-order-lifecycle` قاعدة ١٧ و`references/package-whereabouts.md`.
//
// 🔴 **دي «شبكة الأمان» — الاتجاه العكسي لأداة المكتب.** أداة المكتب بتكتب
//    `Office` على طرد **خارج** للتسليم؛ الأداة دي بتكتب `Warehouse` على طرد
//    **راجع** (مرتجع أو ملغي) وصل المخزن تاني. الاتنين على **نفس الحقل**،
//    والفرق كله في شرط الأهلية وفي القيمة المكتوبة.
//    ⚠️ ونتيجة مباشرة: البند اللي كان مفتوح في `Package-Transfer-To-Office`
//       («الطرد المنسي في المكتب لسه بند مفتوح في الواقع» · `known-gaps.md`
//       G-17) **الأداة دي هي اللي بتقفله** — قيمة `Office` من غير طريق رجوع
//       كانت بتعلّق الطرد على المكتب للأبد.
// ══════════════════════════════════════════════════════════════
// 🔴 **السجل مشترك** — الأداة بتكتب تحت `metafields_change` زي سكانرَي بوسطة
//    وأداة المكتب بالظبط، والفصل بين الكُتّاب بمفتاح **`extra.sourceTool`**.
// ⚠️ **ونتيجة مباشرة:** أي استعلام خط أساس على `metafields_change` **لازم
//    يفلتر على `extra.sourceTool`** — من غيره بيعدّ صفوف **أربع** أدوات مع
//    بعض. ودي بالظبط اللي التلات endpoints بتاعة السجل بتعملها تحت
//    (`logParamsFrom`).
// ⚠️ و`type` بيفضل **من القيم المسجّلة أصلاً** للصف ده (`update` · `rejected`)
//    — صفر قيمة `type` جديدة، فـRule 7 مالهاش نطاق جديد هنا.
const TOOL_NAME      = 'metafields_change';
const SOURCE_TOOL    = 'package_transfer_to_warehouse';
const WORKER_VERSION = '1.10.0';

// ══════════════════════════════════════════════════════════════
// §CONSTANTS
// ══════════════════════════════════════════════════════════════

// ─── §CONSTANTS::status — تُنسخ حرفيًا (worker-builder Step 5B) ───
// فرق حرف واحد = فلتر بيرجّع صفر صف **من غير أي خطأ**.
const S1_STATUS = {
  NEW_ORDER: 'New Order', CONFIRMED: 'Confirmed',
  WA_CONFIRMED: 'WhatsApp-Confirmed', WA_CANCELLED: 'WhatsApp-CANCELLED',
  CONFIRMED_EDIT: 'Confirmed + Edit', PENDING_EDIT: 'Pending Edit',
  READY: 'Ready', SHIPPED: 'Shipped', IN_RETURN: 'In-Return',
  DELIVERED: 'Delivered', RETURNED: 'Returned', CANCELLED: 'Cancelled',
};
const S2_STATUS = {
  CONFIRMED_RETURN: 'Confirmed + RETURN', CONFIRMED_EXCHANGE: 'Confirmed + EXCHANGE',
  READY: 'Ready', SHIPPED: 'Shipped', IN_RETURN: 'In-Return', RETURNED: 'Returned',
};

// 🔴 **الحالات المؤهلة — ودي الفرق الجوهري عن أداة المكتب.**
//    هناك `Ready` (الطرد خارج)، وهنا `Returned` أو `Cancelled` (الطرد راجع).
//    ⛔ **والإلغاء هنا مش رافض — هو شرط أهلية.** في أداة المكتب الأوردر
//       الملغي بيترفض برسالة «قطع الشحنة ورجّع المنتجات على الرف»؛ هنا ده
//       **بالظبط** الطرد اللي الأداة اتعملت عشانه. أي نسخ لحارس الإلغاء من
//       هناك بيقفل الأداة دي بالكامل **من غير أي خطأ**.
const S1_ELIGIBLE = new Set([S1_STATUS.RETURNED, S1_STATUS.CANCELLED]);
const S2_ELIGIBLE = new Set([S2_STATUS.RETURNED]);

// ─── §EDITED::constants — تابين «أوردرات معدّلة» و«تحويل بوسطة» (v1.10.0 · طلب أحمد 25-10-2026) ───
// 🔴 **الطرد هنا خارج مش راجع**: أوردر اتطبع واتغلّف وراح المكتب، وبعدين اتعدّل (`Confirmed + Edit`)
//    أو رجع `Confirmed` / S2 `Confirmed + EXCHANGE` — فالطرد اللي في المكتب بمحتوى قديم ولازم يرجع
//    المخزن يتغلّف من جديد. ولسه الفعل واحد: يكتب `Warehouse`.
// ⚠️ **وشرط التغليف بميتافيلد الماكينة بتاعتها** (`s1_…` لـS1 و`s2_…` لـS2) — عكس تاب المرتجعات:
//    طرد S2 الخارج (الاستبدال) هو اللي اتغلّف في دورة S2. ⛔ ممنوع نسخ `packedAtS1` على الماكينتين.
// ⚠️ **تحويل بوسطة** = نفس الشروط ماعدا: المندوب `Bosta` والزون `Other_Regions` (الأوردر اتغلّف لمندوب
//    وراح المكتب وبعدين اتحوّل لبوسطة). بوسطة بره نطاق تاب المرتجعات والأوردرات المعدّلة.
const S1_EDITED = new Set([S1_STATUS.CONFIRMED, S1_STATUS.CONFIRMED_EDIT]);
const S2_EDITED = new Set([S2_STATUS.CONFIRMED_EXCHANGE]);
const MODE = { RETURNED: 'returned', EDITED: 'edited', EDITED_BOSTA: 'edited_bosta' };
const BOSTA_ZONE = 'Other_Regions';
// mode مجهول = `returned` (سلوك الصفحات القديمة بالحرف) — مش رفض.
function parseMode(body) {
  const m = String(body?.mode || '').trim();
  return (m === MODE.EDITED || m === MODE.EDITED_BOSTA) ? m : MODE.RETURNED;
}

// ─── §CONSTANTS::whereabouts ───
// 🔴 الشكل `single_line_text_field` (Choice list) — و`metafieldsSet` بترفض
//    الكتابة كلها لو النوع مش مطابق بالحرف. `?action=diag` بيقرا التعريف
//    الحيّ ويقارنه، فتغيير التعريف من الأدمن بيبان في ٥ ثواني بدل ما يطلع
//    كفشل كتابة غامض على أول سكانة.
const WA_KEY      = { s1: 'package_whereabouts_s1', s2: 'package_whereabouts_s2' };
const WA_VALUES   = { WAREHOUSE: 'Warehouse', OFFICE: 'Office', COURIER: 'Courier' };
const WA_TYPE     = 'single_line_text_field';

// 🔴 **القيمة المكتوبة** — `Warehouse` مش `Office`. ثابت مسمّى عشان مايتكتبش
//    حرفيًا في مكانين (الكتابة والتحقق بعدها).
const WA_TARGET   = WA_VALUES.WAREHOUSE;

// ─── §CONSTANTS::zone ───
// 🔴 الزون **قناة شحن مش جغرافيا** (`ecommoda-order-lifecycle` قاعدة ١٦).
//    و`package_whereabouts` **خارج نطاق `Other_Regions` بالكامل** (قاعدة ١٧ ·
//    §2 في `package-whereabouts.md`) — نفس نطاق أداة المكتب بالحرف.
// ⚠️ **والقرار ده لازم يتقال صريح، لأنه أضعف بند في الأداة دي:** مرتجع
//    بوسطة **بيرجع المخزن فعلاً** فيزيائيًا، بخلاف طرد بوسطة الخارج اللي
//    عمره ما بيعدّي على المكتب. اللي بيبرّر استبعاده هنا حاجتان:
//    ① `package_whereabouts` **مش بيتتبع لطرود بوسطة أصلاً** في المهارة —
//       تتبّعها بييجي من بوسطة، فكتابة عهدة عليها بتخلق محور تتبّع تاني
//       **مالوش كاتب في أول الرحلة** (مفيش حد بيكتب `Courier` عليها).
//    ② ومرتجع بوسطة ليه **أداة قايمة**: `bosta-returned.html` (سكانر مرتجعات
//       بوسطة) — وهي بتلغي الأوردر وبترجّع المخزون فعلاً.
//    ⛔ لو اتقرر يومًا إن بوسطة تدخل النطاق، التعديل **سطر واحد هنا**
//       و**سطر واحد في `WOC_WAREHOUSE_ZONES` في الـ shell** — في نفس
//       التمريرة (درس R1)، ومعاه بند في `docs/warehouse-check.mjs`.
const ZONE_IN_SCOPE = new Set(['Cairo+Giza', 'Show_Room']);
const COURIER_BOSTA = 'Bosta';

// ─── §CONSTANTS::caps — سلسلة السقوف التلاتة (worker-builder ⑪) ───
// ① الواجهة    CHUNK                = —    ← مفيش دفعة: السكان **فوري**، أوردر لكل نداء
// ② الـ Worker  MAX_BATCH            = —    ← مفيش endpoint بياخد مصفوفة
// ③ شوبيفاي     STEP1_PAGE_SIZE=250 · STEP2_CHUNK=50   ← تمريرتين مش واحدة من v1.3.0 — تحت §QUEUE
//
// 🔴 **v1.2.0 كانت صفحة واحدة بـ٥٠ صف × ١١ ميتافيلد — وده اللي أنتج `THROTTLED`
//    فعليًا على المتجر الحقيقي** (سكرين شوت حي على الشاشة الرئيسية — راجع
//    `docs/query-cost-experiment.md` بريبو `Warehouse-Operations-Center`).
//    ٢٠ صفحة = ١٬٠٠٠ أوردر لكل استعلام (قرار أحمد 19-09-2026 — كان ٦ منسوخ غلط
//    من أداة المكتب: هناك المصدر `Ready` عابر فعدده عشرات؛ هنا `Returned`/
//    `Cancelled` بيتراكموا). المشكلة الحقيقية مكنتش رقم الصفحة — كانت إن
//    الـ ٢٠ صفحة دي بتجيب **كل** الحقول التقيلة (زون · مندوب · وقتَي تغليف ·
//    عهدتَي طرد) لكل أوردر **مطابق للحالة بس**، بينما شرط العهدة (`Office`)
//    بيستبعد الأغلبية **بعد** الجلب — التكلفة كانت بتتدفع كاملة على أوردرات
//    هتترمى في الآخر.
//
// 🔴 **من v1.3.0: تمريرتين بدل واحدة — تجربة، التفاصيل والقرارات المفتوحة في
//    `docs/query-cost-experiment.md`.**
//    ① تمريرة رخيصة (`STEP1_FIELDS` تحت — ٦ حقول بس) على نفس التلات استعلامات
//       القديمة، بسقف صفحة أعلى (`٢٥٠`) لأنها أرخص بمراحل من نفس عيلة استعلام
//       `print.html`/`pack.html`.
//    ② فلترة العهدة (`Office`) بتحصل **هنا في الـ Worker** على نتيجة التمريرة
//       الأولى، بنفس أولوية الماكينة اللي `wocWarehouseGate` بتطبّقها بالحرف
//       (`mergeStep1` تحت) — مش فلتر `query` (لسه مستحيل، القيد ما اتلغاش).
//    ③ تمريرة تانية `nodes(ids:)` بكامل `ORDER_FIELDS` **للمرشّحين بس** (اللي
//       عدّوا فلتر العهدة)، على دفعات `STEP2_CHUNK`.
// ⚠️ **الكسب مش لأن `nodes(ids:)` أرخص من `orders(query:)` لكل عنصر — التكلفة
//    لكل حقل تقريبًا نفسها.** الكسب إن الحقول التقيلة بتتجاب لعدد أوردرات
//    **أقل** (المرشّحين بس)، مش لكل أوردر مطابق لحالة S1/S2.
// ⛔ **وده مش حل لمشكلة إن `package_whereabouts` مش Admin filterable — القيد
//    نفسه لسه موجود** وبيتجاهل في صمت لو اتحط في `query` مباشرة. التمريرتين
//    دول تخفيف لتكلفة القيد، مش إلغاء له.
// ⛔ **تفعيل Admin Filtering على الميتافيلد نفسه — مقفول نهائيًا (قرار أحمد
//    19-09-2026).** الخمس سلوتات المتاحة على مستوى المتجر مشغولة بالفعل.
//    البند ده **متقفل ومش موضوع للنقاش تاني** — التمريرتين هما المسار
//    الوحيد المتاح.
const STEP1_PAGE_SIZE = 250;   // تمريرة ١ — ٦ حقول بس، نفس رتبة تكلفة print.html/pack.html
// 🔴 **`STEP1_MAX_PAGES` — تاريخ الترفيعات:**
//    `٤` → `٢٠` (v1.3.1، 19-09-2026): أول نشر لـ`1.3.0` رجّع `truncated: true`
//    فعليًا — `step1Calls: 11` بتكلفة `354` نقطة بس (~٣٢/نداء)، فالسقف اترفع
//    لنفس رقم `QUEUE_MAX_PAGES` القديم (كان مُختبَر آمن على استعلام أتقل).
//    `٢٠` → `٤٠` (v1.3.2، 19-09-2026): القياس التاني بعد الرفع الأول قال
//    `s1Cancelled` **لسه بتتقصّ حتى عند ٢٠ صفحة** (٥٬٠٠٠ صف) — يعني عدد
//    `Cancelled` من الأرضية الثابتة اللي كانت وقتها أكتر من ٥٬٠٠٠.
//    `٤٠` → `١٠٠` (v1.4.0، 19-09-2026 · قرار أحمد §٩): جزء من رزمة §٩ **مع**
//    رجوع النافذة الزمنية المتحرّكة (`ROLLING_WINDOW_DAYS` تحت) بدل الأرضية
//    الثابتة — القرار المُعلن صراحة: خيار أ (رفع الصفحات) وخيار ب (نافذة
//    متحركة) **مع بعض**، مش فهرس D1 (خيار ج، التوصية الأساسية في
//    `docs/query-cost-experiment.md` §٩) — ج مؤجّل لمرحلة تانية لو المشكلة
//    رجعت. الرفع لـ١٠٠ صفحة مساحة أمان إضافية فوق النافذة المتحركة نفسها،
//    مش بديل عنها — النافذة هي اللي بتمنع النمو التراكمي، والرفع هنا حارس
//    زيادة.
// ⚠️ **`queryCost.step1Detail`** بيقول لكل استعلام من التلاتة كام صفحة
//    استخدم واتقصّ ولا لأ — لو `truncated: true` ظهرت رغم ده، الرقم ده هو
//    اللي هيقول أنهي استعلام بالظبط لسه محتاج سقف أعلى.
const STEP1_MAX_PAGES = 100;   // حارس حلقة — ٢٥٠×١٠٠ = ٢٥٬٠٠٠ لكل استعلام
const STEP2_CHUNK     = 50;    // تمريرة ٢ — نفس `ORDER_FIELDS` الكامل، نفس الرقم المقاس آمن في v1.2.0
const STEP2_MAX_IDS   = 3000;  // حارس دفاعي — لو المرشّحين (بعد فلتر العهدة) زادوا عن كده، نقتطع
                                // ونعلن truncated بدل ما الـ Worker يعلّق في عشرات نداءات nodes(ids:)

// 🔴 **أرضية تاريخ الأوردر — رجعت نافذة متحرّكة (v1.4.0 · قرار أحمد
//    19-09-2026 · §٩ في `docs/query-cost-experiment.md`)، وده تراجع صريح عن
//    قرار v1.29.0 (الأرضية الثابتة `2026-04-01`).**
//
//    🔴 **القرار اتاخد وهو عارف الثمن بالظبط:** v1.29.0 شالت النافذة
//    المتحرّكة (كانت ٣٠ يوم على `updated_at`) وحطّت أرضية ثابتة، والسبب
//    المكتوب وقتها كان: «النافذة المتحرّكة بتخفي الطرد الراجع من شهرين
//    بالظبط لما يبقى منسي فعلاً — وهو الطرد اللي أداة المرتجعات (شبكة
//    الأمان) اتعملت عشانه». الثمن ده **لسه صحيح** ومتكرر هنا — قرار أحمد
//    الصريح إنه مقبول مقابل استقرار التكلفة (§٩: رفع `STEP1_MAX_PAGES` لوحده
//    مش استراتيجية مستدامة لأن `Cancelled`/`Returned` بتتراكم مع عمر المتجر
//    من غير سقف طبيعي، والنافذة المتحرّكة بتخلي عدد الأوردرات المطابقة
//    **تقريبًا ثابت** بمرور الوقت).
//
//    ⚠️ **شبكة الأمان المطلوبة — بند مفتوح لازم يتنفّذ، مش رفاهية.**
//    `docs/query-cost-experiment.md` §٩ صريحة: خيار النافذة المتحرّكة «ممنوع
//    يتنفّذ من غير شبكة أمان مصاحبة» — تقرير دوري (يدوي كخطوة أولى) بيراجع
//    الأوردرات الأقدم من النافذة مرة كل شهر، لحد ما فهرس D1 (خيار ج، التوصية
//    الأساسية) يتنفّذ لو المشكلة رجعت. راجع «مسائل مفتوحة» تحت.
//
//    ⚠️ **والفرق عن ٣٠ يوم القديمة:** ٢٥٠ يوم (~٨ شهور) بدل ٣٠ — طرد منسي
//    لمدة ٨ شهور حالة أندر بكتير من طرد منسي لمدة شهر، فمساحة الأمان أكبر
//    بمراحل حتى مع رجوع مبدأ النافذة.
//
// 🔴 **`ROLLING_WINDOW_DAYS` بيتحسب لحظيًا في كل نداء** — مش ثابت وقت
//    الـ cold start. الـ isolate ممكن يعيش ساعات، والنافذة لازم تفضل
//    «آخر ٢٥٠ يوم من دلوقتي» مش «آخر ٢٥٠ يوم من أول تشغيل».
// ⚠️ **`created_at` مش `updated_at`** — تاريخ **الأوردر** هو اللي الموظف
//    بيقراه في الجدول؛ و`updated_at` بيتحرّك مع أي تعديل (حتى كتابة
//    الميتافيلد بتاعتنا)، فكان بيدّي نافذة **بتتزحلق تحت الطرد نفسه**. نفس
//    القاعدة اللي منعت الرجوع لـ`updated_at` في v1.29.0 **ما اتغيّرتش**.
// ⚠️ **والصيغة `YYYY-MM-DD` بتتقرا UTC عند شوبيفاي** — الحساب هنا بـUTC
//    (`Date.now()` مباشرة، بلا تحويل توقيت القاهرة)، لأن فرق يوم على نافذة
//    ٢٥٠ يوم أثره العملي صفر تقريبًا (٠.٤٪ من النافذة).
// 🔴 **وهي أرضية عرض — مش شرط أهلية.** الأوردر الأقدم منها **بيتسكن عادي**
//    والـ Worker بيكتب عليه؛ هو مش في القايمة وبس. ⛔ ممنوع تتحط في
//    `evaluate`.
const ROLLING_WINDOW_DAYS = 250;   // قرار أحمد 19-09-2026 (§٩) — ثابت مسمّى، يتوثّق في المهارة
function computeOrdersSince() {
  const ms = Date.now() - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return new Date(ms).toISOString().slice(0, 10);   // YYYY-MM-DD — UTC
}
const SHOPIFY_API_VERSION = '2026-01';
// ══════════════════════════════════════════════════════════════
// §CORS — Option B (الأداة بتكتب على شوبيفاي)
// ══════════════════════════════════════════════════════════════
const ALLOWED_ORIGINS = ['https://ecommoda-dev.github.io'];
function getCORS(request) {
  const origin  = request.headers.get('Origin') || '';
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  };
}

// ══════════════════════════════════════════════════════════════
// §HELPERS
// ══════════════════════════════════════════════════════════════
function json(data, status = 200, request = null) {
  const headers = { 'Content-Type': 'application/json' };
  Object.assign(headers, request ? getCORS(request) : { 'Access-Control-Allow-Origin': '*' });
  return new Response(JSON.stringify(data), { status, headers });
}

// ─── §HELPERS::time — توقيت القاهرة **يتحسب** مايتكتبش ثابت ───
// (`ecommoda-constants` §13 — نفس الدوال بالحرف في الـ Worker وفي الواجهة)
const CAIRO_TZ = 'Africa/Cairo';
const _cairoFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: CAIRO_TZ, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
});
function cairoParts(d) {
  const o = {};
  for (const p of _cairoFmt.formatToParts(d)) if (p.type !== 'literal') o[p.type] = p.value;
  if (o.hour === '24') o.hour = '00';
  return o;
}
function cairoDate() { const p = cairoParts(new Date()); return `${p.year}-${p.month}-${p.day}`; }

// ════════════════════════════════════════════════════════════
// §LOG-REG — الحارس الديناميكي لقيم اللوج (الطبقة ٥ · worker-builder Step 7-ج)
// ════════════════════════════════════════════════════════════
// قطعة الأداة دي بس من log-values.json اللي جنبها — بتتحدّث معاه في نفس
// الـ commit. ممنوع شحن سجل الـ٣٢ أداة هنا.
const LOG_REGISTRY = {
  metafields_change: new Set(['update', 'rejected']),
};

const isRegisteredLogValue = (tool, type) => !!LOG_REGISTRY[tool]?.has(type);

// UPSERT على (source_tool, tool, type) — صف واحد لكل قيمة، hits بيعدّ.
const LOG_ALERT_SQL = `
  INSERT INTO log_value_alerts
    (source_tool, tool, type, first_seen, last_seen, hits,
     worker_version, sample_order_name, sample_employee, sample_notes)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(source_tool, tool, type) DO UPDATE SET
    last_seen         = excluded.last_seen,
    hits              = log_value_alerts.hits + excluded.hits,
    worker_version    = excluded.worker_version,
    sample_order_name = excluded.sample_order_name,
    sample_employee   = excluded.sample_employee,
    sample_notes      = excluded.sample_notes,
    status            = CASE WHEN log_value_alerts.status = 'ignored'
                             THEN 'ignored' ELSE 'open' END
`;

// فشل التنبيه ممنوع يأثر على أي حاجة — try/catch صامت. بتجمّع التكرار جوّه
// نفس الدفعة في صف واحد (hits) قبل ما تكتب.
async function noteUnregisteredLogValues(db, entries) {
  const byPair = new Map();
  for (const e of entries) {
    const key = `${e.tool}\u0000${e.type}`;
    const acc = byPair.get(key);
    if (acc) { acc.hits++; continue; }
    byPair.set(key, { entry: e, hits: 1 });
  }
  const now = new Date().toISOString();
  for (const { entry, hits } of byPair.values()) {
    try {
      await db.prepare(LOG_ALERT_SQL).bind(
        SOURCE_TOOL, entry.tool ?? '(بدون tool)', entry.type ?? '(بدون type)',
        now, now, hits, WORKER_VERSION ?? null,
        entry.orderName ?? null, entry.employee ?? null,
        entry.notes ? String(entry.notes).slice(0, 200) : null,
      ).run();
    } catch (e) { /* متعمّد: التنبيه فهرس، وفشله أهون من تعطيل الأداة */ }
  }
}

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim from references/shared-functions.md — never modify
// ══════════════════════════════════════════════════════════════

async function writeLog(db, entry) {
  const unregistered = !isRegisteredLogValue(entry.tool, entry.type);
  const extra = unregistered
    ? { ...(entry.extra || {}), _unregistered: true }
    : entry.extra;

  await db.prepare(`
    INSERT INTO logs
      (timestamp, tool, type, employee, order_id, order_name,
       sku, product_title, delta, value_before, value_after, notes, extra)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    entry.timestamp    ?? new Date().toISOString(),
    entry.tool,
    entry.type,
    entry.employee     ?? null,
    entry.orderId      ?? null,
    entry.orderName    ?? null,
    entry.sku          ?? null,
    entry.productTitle ?? null,
    entry.delta        ?? null,
    entry.valueBefore  ?? null,
    entry.valueAfter   ?? null,
    entry.notes        ?? null,
    extra ? JSON.stringify(extra) : null
  ).run();

  // بعد الكتابة، مش قبلها — ومفيش رفض كتابة أبدًا على قيمة غير مسجّلة.
  if (unregistered) await noteUnregisteredLogValues(db, [entry]);
}

const LOG_EXPORT_MAX = 2000;

// ⚠️ **امتداد موثّق على §SHARED** — `results` و`machines` مش في نسخة المهارة،
//    وهما مضافين هنا بنفس الشكل اللي في سكانرَي بوسطة بالحرف. السبب إن
//    الواجهة بتعرض الفلترين دول، و**Worker بيتجاهل فلتر في صمت** معناه إن
//    الجدول بيقول إنه مفلتر وهو مش مفلتر — وده أسوأ من فلتر مش موجود.
//    ⛔ أي نسخ من المهارة فوق الكتلة دي بيشيل الفلترين من غير أي خطأ.
function buildLogFilterSQL(select, {
  tool      = null, sourceTool = null,
  employee  = null, employees = null,
  type      = null, types     = null,
  results   = null, machines  = null,
  search    = null,
  dateFrom  = null, dateTo    = null,
} = {}) {
  let sql = `${select} FROM logs WHERE type NOT IN ('login','logout')`;
  const b = [];

  const emps = Array.isArray(employees) && employees.length ? employees : (employee ? [employee] : []);
  const typs = Array.isArray(types)     && types.length     ? types     : (type     ? [type]     : []);

  if (tool) { sql += ' AND tool = ?'; b.push(tool); }
  // 🔴 **الفلتر ده مش اختياري** — `metafields_change` سجل مشترك بين تلات أدوات،
  //    ومن غيره تاب السجل بتاع الأداة دي بيعرض صفوف سكانرَي بوسطة كمان.
  //    ⚠️ والقيمة **مش من العميل** — `logParamsFrom` بتحطها ثابتة.
  if (sourceTool) {
    sql += ` AND json_extract(extra, '$.sourceTool') = ?`; b.push(sourceTool);
  }
  if (emps.length) {
    sql += ` AND employee IN (${emps.map(() => '?').join(',')})`; b.push(...emps);
  }
  if (typs.length) {
    sql += ` AND type IN (${typs.map(() => '?').join(',')})`; b.push(...typs);
  }
  const ress = Array.isArray(results)  && results.length  ? results  : [];
  const machs = Array.isArray(machines) && machines.length ? machines : [];
  if (ress.length) {
    sql += ` AND json_extract(extra, '$.result') IN (${ress.map(() => '?').join(',')})`; b.push(...ress);
  }
  if (machs.length) {
    sql += ` AND json_extract(extra, '$.machine') IN (${machs.map(() => '?').join(',')})`; b.push(...machs);
  }
  if (search) {
    sql += ' AND (order_name LIKE ? OR notes LIKE ?)';
    b.push(`%${search}%`, `%${search}%`);
  }
  if (dateFrom) { sql += ' AND substr(timestamp, 1, 10) >= ?'; b.push(dateFrom); }
  if (dateTo)   { sql += ' AND substr(timestamp, 1, 10) <= ?'; b.push(dateTo); }

  return { sql, b };
}

const LOG_SORT_COLUMNS = {
  date: 'timestamp', time: 'timestamp', employee: 'employee', orderName: 'order_name',
  machine: `json_extract(extra, '$.machine')`, result: `json_extract(extra, '$.result')`,
};

function orderByClause(sortBy, sortDir) {
  const col = LOG_SORT_COLUMNS[String(sortBy || '')] || 'timestamp';
  const dir = String(sortDir || '').toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  // 🔴 كاسر تعادل إلزامي: من غيره صفوف نفس القيمة بترتيب عشوائي بين الصفحات.
  return col === 'timestamp' ? ` ORDER BY timestamp ${dir}`
                             : ` ORDER BY ${col} ${dir}, timestamp DESC`;
}

async function getLogs(db, { limit = 100, offset = 0, sortBy, sortDir, ...filters } = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + orderByClause(sortBy, sortDir) + ' LIMIT ? OFFSET ?';
  return (await db.prepare(q)
    .bind(...b, Math.min(limit, 100), Math.max(offset, 0)).all()).results;
}

async function getLogsCount(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT COUNT(*) as total', filters);
  const row = await db.prepare(sql).bind(...b).first();
  return row?.total ?? 0;
}

async function getLogsExport(db, filters = {}) {
  const { sql, b } = buildLogFilterSQL('SELECT *', filters);
  const q = sql + ' ORDER BY timestamp DESC LIMIT ?';
  return (await db.prepare(q).bind(...b, LOG_EXPORT_MAX).all()).results;
}

function logParamsFrom(url, tool, sourceTool) {
  const csv = (k) => (url.searchParams.get(k) || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const employees = csv('employees'), types = csv('types');
  const results = csv('results'), machines = csv('machines');
  return {
    tool,
    // ⚠️ ثابتة من الكود — ممنوع تيجي من الـ query string، وإلا أي طلب معاه
    //    السر يقدر يقرا سجل أداة تانية على نفس الـ `tool`.
    sourceTool,
    employees: employees.length ? employees : null,
    employee:  url.searchParams.get('employee') || null,
    types:     types.length ? types : null,
    type:      url.searchParams.get('type')     || null,
    results:   results.length  ? results  : null,
    machines:  machines.length ? machines : null,
    search:    url.searchParams.get('search')   || null,
    dateFrom:  url.searchParams.get('dateFrom') || null,
    dateTo:    url.searchParams.get('dateTo')   || null,
  };
}

// ══════════════════════════════════════════════════════════════
// §SHOPIFY
// ══════════════════════════════════════════════════════════════
// 🔴 **retry/backoff — نفس انضباط `shopifyGQL` بالحرف (قرار أحمد 19-09-2026 ·
//    §٨② في `docs/query-cost-experiment.md` بريبو الهب).** كانت محاولة واحدة
//    بس (`if (!resp.ok) throw`)، بينما `shopifyGQL` عندها ٣ محاولات وbackoff.
//    السبب: الخمس Workers (الطابعة · التغليف · تسليمات بوسطة · تسليمات
//    المكتب · استلام المرتجعات) بتشارك **نفس الـ Custom App** — قرار ثابت
//    (تكلفة إدارة Custom App لكل Worker مش عملية). لما الشاشة الرئيسية بتحمّل
//    الخمس طوابير بالتوازي، الخمسة بيطلبوا توكن OAuth **متزامن** على نفس الـ
//    App، وفشل ٤٢٩ لحظي عابر (زحمة) كان بيتحوّل فورًا لفشل كامل بدل ما يتعافى.
//    ⚠️ **مش بديل عن §٨① (تفريق التوقيت في `index.html`)** — ده تصحيح عام
//    للستاك كله، والاتنين مع بعض هما اللي بيقللوا التزامن الفعلي.
async function getAccessToken(env) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(
        `https://${env.SHOP_DOMAIN}/admin/oauth/access_token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id:     env.CLIENT_ID,
            client_secret: env.CLIENT_SECRET,
            grant_type:    'client_credentials',
          }),
        }
      );
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`OAuth: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      // 🔴 نفس التصنيف اللي في `shopifyGQL`: ٤٢٩ (زحمة على الـ Custom App)
      //    و٥xx (عطل مؤقت من شوبيفاي) بيتعاد المحاولة عليهم، غير كده رمي فوري.
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`OAuth failed: ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`OAuth: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }
    if (!data.access_token) throw new Error('No access_token in response');
    return data.access_token;
  }
  throw lastErr || new Error('OAuth: فشل غير معروف');
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي، منسوخة كما هي ───
// أي فشل بيترمي: ① شبكة ② HTTP status ③ رد مش JSON ④ data.errors ⑤ data فاضية.
// ⚠️ ④ هو الخطير: ميوتيشن بتترفض على مستوى الحقل بترجّع {"errors":[…],"data":null}
//    و`userErrors` بتبقى `[]` — كود بيفحص `userErrors` بس بيقرا ده **نجاح**.
// 🔴 **`_lastThrottle`/`_lastQueryCost` بيتحدّثوا من آخر نداء بس — مش من نداء
//    `diag` نفسه.** لو `diag` اتنادى قبل أي استعلام تاني في نفس الـ isolate،
//    القيمة بتفضل `null`. مش عطل — الـ isolate ممكن يتصفّر في أي وقت
//    (Cloudflare)، فمفيش ضمان إن أي نداءين متتاليين واقعين على نفس الـ isolate.
let _lastThrottle = null;    // بيتعرض في diag — الاقتراب من السقف مابيبانش غير بانفجار دفعة
// 🟡 **إضافة v1.3.0 — قياس تكلفة الاستعلام الحقيقية لتجربة إعادة هيكلة §QUEUE.**
//    `throttleStatus` بيقول الرصيد المتبقي، **مش** تكلفة النداء نفسه.
//    `actualQueryCost` هو اللي بيتاكل من الرصيد فعليًا لكل نداء — وهو الرقم
//    اللي المقارنة قبل/بعد التجربة مبنية عليه. التفاصيل الكاملة في
//    `docs/query-cost-experiment.md` بريبو `Warehouse-Operations-Center`.
let _lastQueryCost = null;   // { op, requested, actual } — آخر نداء بس، نفس تحفّظ _lastThrottle فوق
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify', costLog = null) {
  const MAX_ATTEMPTS = 3;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let resp, text;
    try {
      resp = await fetch(`https://${env.SHOP_DOMAIN}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': token },
        body:    JSON.stringify({ query, variables }),
      });
      text = await resp.text();
    } catch (e) {
      lastErr = new Error(`${opName}: فشل الاتصال بشوبيفاي — ${e.message}`);
      if (attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 400 * attempt)); continue; }
      throw lastErr;
    }

    if (!resp.ok) {
      const retriable = resp.status === 429 || resp.status >= 500;
      lastErr = new Error(`${opName}: شوبيفاي ردّت HTTP ${resp.status} — ${text.slice(0, 180)}`);
      if (retriable && attempt < MAX_ATTEMPTS) { await new Promise(r => setTimeout(r, 700 * attempt)); continue; }
      throw lastErr;
    }

    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error(`${opName}: رد شوبيفاي مش JSON صالح — ${text.slice(0, 180)}`); }

    if (Array.isArray(data.errors) && data.errors.length) {
      const codes = data.errors.map(e => e?.extensions?.code).filter(Boolean);
      lastErr = new Error(
        `${opName}: ${data.errors.map(e => e.message).join(' | ')}` +
        (codes.length ? ` [${codes.join(',')}]` : '')
      );
      if (codes.includes('THROTTLED') && attempt < MAX_ATTEMPTS) {
        await new Promise(r => setTimeout(r, 1200 * attempt)); continue;
      }
      throw lastErr;
    }

    if (!data.data) throw new Error(`${opName}: رد شوبيفاي بدون data — ${text.slice(0, 180)}`);
    // 🔴 **تلات قيم منفصلة في `extensions.cost` — مش رقم واحد:**
    //    `requestedQueryCost` = السقف النظري قبل التنفيذ · `actualQueryCost` =
    //    اللي اتاكل فعليًا من الرصيد بعد أي تقليم · `throttleStatus` = الرصيد
    //    المتبقي بعده. أي قياس أو مقارنة لازم يكون على `actualQueryCost` —
    //    هو الرقم الحقيقي، مش سقف نظري ومش رصيد متبقي.
    if (data.extensions?.cost) {
      const c = data.extensions.cost;
      if (c.throttleStatus) _lastThrottle = c.throttleStatus;
      _lastQueryCost = { op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null };
      if (costLog) costLog.push({ op: opName, requested: c.requestedQueryCost ?? null, actual: c.actualQueryCost ?? null });
    }
    return data;
  }
  throw lastErr || new Error(`${opName}: فشل غير معروف`);
}

// ─── §HELPERS::assertEnv ───
const ENV_REQUIRED = { shopify: ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET'] };
function assertEnv(env, ...groups) {
  const missing = [];
  for (const g of groups) {
    for (const key of (ENV_REQUIRED[g] || [])) {
      if (env[key] === undefined || env[key] === null || String(env[key]).trim() === '') missing.push(key);
    }
  }
  if (!env.DB) missing.push('DB (D1 binding)');
  if (missing.length) {
    throw new Error(
      `متغيرات ناقصة في الـ Worker: ${missing.join('، ')} — ضِفها من ` +
      `Dashboard → Settings → Variables ثم Promote النسخة. (شغّل ?action=diag)`
    );
  }
}


// ══════════════════════════════════════════════════════════════
// §QUEUE — طابور «جاهز للرجوع للمخزن»
// ══════════════════════════════════════════════════════════════
//
// 🔴 **`package_whereabouts_s1`/`_s2` لسه مش قابلين للفلترة في `query`** —
//    مقاس (١٠٬٠٠٠ صف — 15-09-2026)، والفلتر عليهم بيتجاهَل في صمت ويرجّع
//    المتجر كله. القيد ده **ما اتلغاش** — راجع `docs/query-cost-experiment.md`
//    بريبو الهب لبند مفتوح عن تفعيل Filtering على تعريف الميتافيلد نفسه
//    (مورد نادر: ٥ تعريفات بس لكل مورد على مستوى المتجر).
//
// 🔴 **من v1.3.0: فلترة العهدة بتحصل في الـ Worker — مش في الواجهة زي v1.2.0.**
//    تمريرتين بدل واحدة (`§QUEUE::STEP1`/`STEP2` تحت): تمريرة رخيصة بتحدد
//    المرشّحين (عهدة = `Office`، بنفس أولوية `wocWarehouseGate` بالحرف)،
//    وتمريرة تانية بتجيب التفاصيل الكاملة **للمرشّحين بس**. السبب: v1.2.0
//    كانت بتجيب كل الحقول التقيلة لكل أوردر مطابق للحالة **قبل** ما تعرف لو
//    هيتستبعد بعدين، وده اللي سبّب `THROTTLED` فعلي على المتجر الحقيقي.
// ⚠️ **والرد للواجهة زي ما هو بالظبط** (نفس `shapeOrder`، نفس المفاتيح) —
//    صفر تغيير في العقد. `wocWarehouseGate`/`wocWarehouseQueue` في
//    `shared/shell.js` §WAREHOUSE-GATE لسه **المصدر الوحيد** للأهلية في
//    الواجهة، وبتتطبّق على الرد **زي ما هي** — الفرق الوحيد إن عدد الصفوف
//    الراجعة بقى أقل، لأن اللي اتشال أصلاً كان هيترمى في `wocWarehouseQueue`
//    (تحقّق: `warehouse-return.html` و`index.html` بيطبّقوا الفلترة **فورًا**
//    على `data.orders` بلا أي استخدام تاني للمصفوفة الخام قبلها).
// ⛔ **وممنوع الاستنتاج إن الفلترة اتنقلت بالكامل للـ Worker** — باقي شروط
//    الأهلية (الزون · المندوب · الحالة · وقت التغليف بميتافيلد الماكينة
//    الصح) **لسه بالكامل في `wocWarehouseGate`**، زي ما هي. الـ Worker بيفلتر
//    بند واحد بس (العهدة) لأنه هو اللي بيقلّل حجم البيانات التقيلة المطلوب
//    جلبها — مش لأنه "أدق" من الواجهة.
//
// 🔴 **بس الحارس الحقيقي على الكتابة في `?action=scan` تحت** — حارس في الواجهة
//    بس **مش حارس** (`ecommoda-order-lifecycle` §1.5): تاب مفتوح من ساعة
//    والأوردر اتغيّرت حالته في الوقت ده كان هيعدّي. `scan` بيقرا الأوردر
//    **حيًا** وقت الضغطة، بغض النظر عن أي فلترة حصلت في الطابور.

// 🔴 **جزء الحقول واحد** — الطابور والسكان بيقروا **نفس** المجموعة بالحرف.
//    بناء الاستعلام التاني بـ`.replace()` على نص الأول كان بيفشل **في صمت**
//    لو مسافة اتغيّرت، فالحقول بتتعرّف مرة واحدة هنا وبتتركّب في التلاتة.
// 🔴 **`updatedAt` مش موجود هنا عن قصد — واتشال بقرار أحمد 19-09-2026.**
//    كان بيتجاب وبيتعرض في عمودين («آخر تحديث» · «الوقت منذ آخر تحديث»)،
//    و**كان تقريب مش تسجيل**: شوبيفاي مالهاش حقل بيقول «الطرد رجع إمتى»،
//    و`updatedAt` بيتحرّك مع **أي** تعديل — تاج · تعديل بند · وحتى كتابة
//    الميتافيلد بتاعتنا إحنا. النتيجة الواقعية إن عملية جماعية واحدة كانت
//    بتخلّي صفوف كتير تقول نفس التاريخ بالظبط، فالعمود بيتقري **سجل رجوع**
//    وهو مش كده.
//    ⛔ ممنوع يترجع كحقل ولا كعمود إلا لما يبقى فيه **تسجيل حقيقي** لوقت
//       الرجوع (ميتافيلد بتكتبه الأداة دي نفسها وقت السكانة مثلاً).
// 🔴 **v1.6.0 (قرار أحمد 22-10-2026): الطابور بقى بعمود «العنوان» بدل «العميل»
//    و«تاريخ الأوردر».** فـ`shippingAddress` بقى بيجيب أجزاء العنوان
//    (`address1`/`address2`/`city`/`province`) بدل اسم العميل، و`createdAt`
//    اتشال من الاستعلام ومن `shapeOrder` (مفيش مستهلك ليه). أرضية التاريخ
//    (`computeOrdersSince`) بتتطبّق في **نص الاستعلام** (`created_at:>=`) —
//    مش بقراءة الحقل — فشيله ما بيأثّرش عليها.
const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  cancelledAt
  displayFulfillmentStatus
  currentSubtotalLineItemsQuantity
  currentTotalPriceSet { shopMoney { amount } }
  shippingAddress { address1 address2 city province }
  zone:    metafield(namespace: "custom", key: "zone") { value }
  courier: metafield(namespace: "custom", key: "courier") { value }
  s1:      metafield(namespace: "custom", key: "manual_status") { value }
  s2:      metafield(namespace: "custom", key: "status_2_r_e") { value }
  p1:      metafield(namespace: "custom", key: "s1_packing_date_time") { value }
  p2:      metafield(namespace: "custom", key: "s2_packing_date_time") { value }
  pb1:     metafield(namespace: "custom", key: "s1_packed_by") { value }
  pb2:     metafield(namespace: "custom", key: "s2_packed_by") { value }
  w1:      metafield(namespace: "custom", key: "package_whereabouts_s1") { value }
  w2:      metafield(namespace: "custom", key: "package_whereabouts_s2") { value }
`;

// ─── §QUEUE::STEP1 — تمريرة رخيصة: هوية الأوردر + عهدة الطرد بس ───
// 🔴 **السبب الوحيد لوجود التمريرة دي:** `package_whereabouts_s1`/`_s2` مش
//    قابلين للفلترة في `query` — فمفيش طريقة نستبعد غير `Office` **في
//    شوبيفاي نفسها**. التمريرة دي بتجيب أقل حقول ممكنة عشان نطبّق الاستبعاد
//    ده **إحنا** بأرخص تكلفة ممكنة، قبل ما ندفع تكلفة باقي الحقول التقيلة
//    (زون/مندوب/وقتَي تغليف) على أوردرات هتترمى أصلاً.
// ⚠️ **`cancelledAt` مطلوب هنا — مش زينة.** `wocWarehouseGate` بتدّي أولوية
//    S1 لو `cancelledAt` موجودة **حتى لو `status_2_r_e` هي اللي طابقت
//    الاستعلام** — نفس المنطق منسوخ بالحرف في `mergeStep1` تحت.
const STEP1_FIELDS = `
  id
  legacyResourceId
  name
  cancelledAt
  w1: metafield(namespace: "custom", key: "package_whereabouts_s1") { value }
  w2: metafield(namespace: "custom", key: "package_whereabouts_s2") { value }
`;

const STEP1_QUERY = `
query WarehouseStep1($q: String!, $after: String, $n: Int!) {
  orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
    nodes { ${STEP1_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ─── §QUEUE::shapeOrder — شكل واحد للطابور وللسكان ───
// ⚠️ الشكل ده **عقد مع الواجهة**: `wocWarehouseGate` في الـ shell بتقرا
//    المفاتيح دي بالاسم. تغيير اسم مفتاح هنا = الطابور يرجع فاضي **بلا أي
//    خطأ**.
// 🔴 «العنوان» في الطابور: سطر واحد — الشارع ثم المدينة ثم المحافظة. الفاضي `null`
//    (الواجهة بتعرض `—`) مش نص فاضي.
function formatAddress(a) {
  if (!a) return null;
  const txt = [a.address1, a.address2, a.city, a.province]
    .map(x => String(x || '').trim()).filter(Boolean).join('، ');
  return txt || null;
}

function shapeOrder(o) {
  return {
    orderId:   o.legacyResourceId || (o.id ? String(o.id).split('/').pop() : null),
    orderGid:  o.id,
    orderName: o.name,
    cancelledAt: o.cancelledAt || null,
    fulfillment: o.displayFulfillmentStatus || null,
    address:   formatAddress(o.shippingAddress),
    itemsQty:  o.currentSubtotalLineItemsQuantity ?? null,
    total:     o.currentTotalPriceSet?.shopMoney?.amount ?? null,
    zone:      o.zone?.value    || null,
    courier:   o.courier?.value || null,
    s1:        o.s1?.value      || null,
    s2:        o.s2?.value      || null,
    packedAtS1: o.p1?.value     || null,
    packedAtS2: o.p2?.value     || null,
    packedByS1: o.pb1?.value    || null,
    packedByS2: o.pb2?.value    || null,
    whereaboutsS1: o.w1?.value  || null,
    whereaboutsS2: o.w2?.value  || null,
  };
}

async function fetchStep1Page(env, token, q, opName, costLog, query = STEP1_QUERY) {
  const out = [];
  let after = null, pages = 0, truncated = false;
  while (pages < STEP1_MAX_PAGES) {
    const data = await shopifyGQL(env, token, query,
      { q, after, n: STEP1_PAGE_SIZE }, opName, costLog);
    const conn = data.data?.orders;
    if (!conn) throw new Error(`${opName}: رد شوبيفاي بلا \`orders\``);
    out.push(...(conn.nodes || []));
    pages++;
    if (!conn.pageInfo?.hasNextPage) { after = null; break; }
    after = conn.pageInfo.endCursor;
    if (pages >= STEP1_MAX_PAGES) truncated = true;
  }
  return { nodes: out, truncated, pages, op: opName };
}

// ─── §QUEUE::STEP2 — التفاصيل الكاملة، للمرشّحين بس (بعد فلتر العهدة) ───
const STEP2_QUERY = `
query WarehouseStep2($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order { ${ORDER_FIELDS} }
  }
}`;

async function fetchStep2Batch(env, token, gids, costLog) {
  const out = [];
  for (let i = 0; i < gids.length; i += STEP2_CHUNK) {
    const chunk = gids.slice(i, i + STEP2_CHUNK);
    const data = await shopifyGQL(env, token, STEP2_QUERY, { ids: chunk }, 'warehouseStep2', costLog);
    for (const n of (data.data?.nodes || [])) if (n) out.push(n);
  }
  return out;
}

// ─── §QUEUE::mergeStep1 — أولوية الماكينة، منسوخة بالحرف من `wocWarehouseGate` ───
// 🔴 **الأولوية: S1 الأول (لو الحالة طابقت أو `cancelledAt` موجودة)، وإلا S2.**
//    نفس ترتيب `shared/shell.js §WAREHOUSE-GATE` سطر بسطر — أي اختلاف هنا
//    بيخلّي أوردر يتفحص بميتافيلد غلط (`w2` بدل `w1` مثلًا) ويترفض أو يتقبل
//    غلط **بلا أي خطأ في الكونسول**.
//    ① أوردرات `s1Nodes` (`manual_status` طابق فعليًا — Returned أو Cancelled)
//       — S1 مؤكَّد، فحص `w1`.
//    ② أوردرات `s2OnlyNodes` (`status_2_r_e` طابق و`manual_status` ما طابقش)
//       — لو `cancelledAt` موجودة: S1 برضه بيغلب (فحص `w1`)، بالظبط زي
//       `wocWarehouseGate` (`s1Eligible = ... || !!o.cancelledAt`). غير كده: S2
//       (فحص `w2`).
// ⚠️ **التكرار بين الاستعلامات مش خطأ** — أوردر ممكن يطابق `manual_status`
//    و`status_2_r_e` مع بعض (طرد S1 ملغي وطرد S2 راجع على نفس الأوردر). لو
//    اتحسم في المسار S1 (خطوة ①)، خطوة ② بتتخطّاه (`candidates.has(id)`).
function mergeStep1(s1Nodes, s2OnlyNodes) {
  const candidates = new Map();   // orderId → { node, machine }
  for (const n of s1Nodes) {
    const id = n.legacyResourceId;
    if (id && !candidates.has(id)) candidates.set(id, { node: n, machine: 's1' });
  }
  for (const n of s2OnlyNodes) {
    const id = n.legacyResourceId;
    if (!id || candidates.has(id)) continue;   // اتحسم في المسار S1 خلاص
    candidates.set(id, { node: n, machine: n.cancelledAt ? 's1' : 's2' });
  }
  const survivors = [];
  for (const { node, machine } of candidates.values()) {
    const wa = machine === 's1' ? node.w1?.value : node.w2?.value;
    if (wa === WA_VALUES.OFFICE) survivors.push(node.id);   // GID — جاهز لـ nodes(ids:)
  }
  return survivors;
}

// ─── §QUEUE::S2-CYCLE — «استبدال ولا استرجاع؟» لصفوف S2 (v1.7.0 · طلب أحمد 22-10-2026) ───
// 🔴 `status_2_r_e` بيوصل لـ`Returned` من `Confirmed + RETURN` و`Confirmed + EXCHANGE`
//    الاتنين، فالميتافيلد **بيضيّع** النوع. المصدر الوحيد: `returns[].exchangeLineItems`
//    (`ecommoda-order-lifecycle` قاعدة ٨) — **أحدث** دورة مش ملغية (قاعدة ١٥).
// ⚠️ **`exchange` مؤكَّد، و`return` مش مضمون:** `exchangeLineItems` بيفضل فاضي
//    للأبد لو الموظف عدّل الأوردر بإيده وشال سطر الاستبدال (`#53531` · `#53701`).
//    فالواجهة بتكتب «استرجاع» على إنه الأرجح مش المؤكد، ومابنركّبش أي فعل على التفرقة دي.
// 🔴 **استعلام منفصل مش جوّه `ORDER_FIELDS`** — `returns` محتاجة `read_returns`، ولو
//    اتحطت في الاستعلام الأساسي غياب الصلاحية كان هيوقّع الطابور كله (S1 كمان).
//    فشله = `s2Cycle: null` («غير معروف») مش فشل الطابور.
const S2_CYCLE_QUERY = `
query WarehouseS2Cycle($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Order {
      id
      returns(first: 10) {
        nodes { id status createdAt exchangeLineItems(first: 1) { nodes { id } } }
      }
    }
  }
}`;

async function fetchS2CycleTypes(env, token, gids, costLog) {
  const out = new Map();   // gid → 'exchange' | 'return' | null
  for (let i = 0; i < gids.length; i += STEP2_CHUNK) {
    const data = await shopifyGQL(env, token, S2_CYCLE_QUERY,
      { ids: gids.slice(i, i + STEP2_CHUNK) }, 'warehouseS2Cycle', costLog);
    for (const n of (data.data?.nodes || [])) {
      if (!n) continue;
      const live = (n.returns?.nodes || [])
        .filter(r => r.status !== 'CANCELED' && r.status !== 'DECLINED')
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const cur = live[0];
      out.set(n.id, !cur ? null : ((cur.exchangeLineItems?.nodes || []).length ? 'exchange' : 'return'));
    }
  }
  return out;
}

// ─── §QUEUE::handleReadyQueue ───
// بيجيب **تلات استعلامات**: `manual_status = Returned` · `manual_status =
// Cancelled` · `status_2_r_e = Returned`. أوردر ممكن يكون في أكتر من واحد —
// بيتدمج بالـ id (`mergeStep1` فوق).
//
// ⚠️ **والتلاتة عليهم أرضية `created_at >= computeOrdersSince()`** — فوق في
//    §CONSTANTS. نافذة **متحرّكة** (`ROLLING_WINDOW_DAYS` يوم) من v1.4.0،
//    مش أرضية ثابتة — قرار v1.29.0 اترجع فيه صراحةً (قرار أحمد 19-09-2026).
//
// 🔴 **وفيه حالة مقصودة مش في الاستعلامات دي: الملغي على شوبيفاي نفسها**
//    (`cancelledAt` من غير `manual_status = Cancelled`). فلتر `status:cancelled`
//    كان هيرجّع **كل** ملغيات تاريخ المتجر، فاستُبعد من الطابور بقرار.
//    ⚠️ **والأوردر ده بيتسكن عادي** — `evaluate` تحت بتقبل `cancelledAt`
//       صراحةً. يعني هو **مش في القايمة بس السكانة بتشتغل عليه** — وده
//       بالظبط معنى «القايمة عرض والـ Worker مرجع».
//
// 🔴 **من v1.3.0: تمريرتين مش واحدة (تجربة — `docs/query-cost-experiment.md`
//    بريبو الهب).** تمريرة ١ رخيصة بتحدد المرشّحين (فلتر العهدة `Office`
//    بيتطبّق **هنا** بنفس أولوية `wocWarehouseGate` — `mergeStep1` فوق)،
//    وتمريرة ٢ بتجيب التفاصيل الكاملة **للمرشّحين بس** عبر `nodes(ids:)`.
// ⚠️ **الرد للواجهة زي ما هو بالظبط** (نفس شكل `shapeOrder`، نفس المفاتيح) —
//    صفر تغيير في العقد. الفرق الوحيد: عدد الصفوف الراجعة أقل من v1.2.0، لأن
//    الواجهة كانت هترميها في `wocWarehouseQueue` أصلاً (صفر أثر على الشاشة).
// ⚠️ **`queryCost` حقل تجريبي جديد في الرد** — للقياس بس، الواجهة مش محتاجة
//    تقراه ومفيش أي اعتماد عليه. لو التجربة اتلغت، الحقل ده بيتشال بلا أي أثر.
async function handleReadyQueue(env, request) {
  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);
  const costLog = [];

  // ⚠️ الأرضية بتتحط على **التلات استعلامات** — واحد من غيرها معناه إن حالة
  //    بتعرض أقدم من التانيتين، والجدول بيخلط النطاقين بلا أي إشارة.
  // 🔴 بتتحسب لحظيًا هنا مش مرة واحدة وقت الـ cold start — نافذة متحرّكة
  //    فعلاً لازم تتحرك مع كل نداء.
  const ordersSince = computeOrdersSince();
  const floor = ` AND created_at:>=${ordersSince}`;

  const [s1Returned, s1Cancelled, s2Returned] = await Promise.all([
    fetchStep1Page(env, token, `metafields.custom.manual_status:'${S1_STATUS.RETURNED}'${floor}`,
                   'warehouseStep1_s1Returned', costLog),
    fetchStep1Page(env, token, `metafields.custom.manual_status:'${S1_STATUS.CANCELLED}'${floor}`,
                   'warehouseStep1_s1Cancelled', costLog),
    fetchStep1Page(env, token, `metafields.custom.status_2_r_e:'${S2_STATUS.RETURNED}'${floor}`,
                   'warehouseStep1_s2Returned', costLog),
  ]);

  const candidateGids = mergeStep1([...s1Returned.nodes, ...s1Cancelled.nodes], s2Returned.nodes);
  const step1Truncated = s1Returned.truncated || s1Cancelled.truncated || s2Returned.truncated;

  // 🟡 تفصيل لكل استعلام لوحده — بدون ده `step1Calls` رقم مجمّع بس ومش
  //    بيقول أنهي استعلام من التلاتة هو اللي وصل لسقف الصفحات. أُضيف بعد
  //    ما `truncated: true` ظهر فعليًا على `1.3.0` ومكناش عارفين مين السبب.
  const step1Detail = [s1Returned, s1Cancelled, s2Returned].map(r => (
    { op: r.op, pages: r.pages, truncated: r.truncated }
  ));

  // 🔴 حارس دفاعي — لو المرشّحين (بعد فلتر العهدة) زادوا عن السقف، نقتطع
  //    ونعلن الاقتطاع، بدل ما الـ Worker يعلّق في عشرات نداءات nodes(ids:).
  //    مش متوقّع عمليًا (الفلترة المفروض تقلّل العدد بمراحل)، بس §CONSTANTS::caps
  //    مبدأ عام: مفيش حلقة من غير سقف.
  const ids = candidateGids.slice(0, STEP2_MAX_IDS);
  const step2Truncated = candidateGids.length > STEP2_MAX_IDS;

  const detailNodes = ids.length ? await fetchStep2Batch(env, token, ids, costLog) : [];

  const byId = new Map();
  for (const n of detailNodes) {
    const s = shapeOrder(n);
    if (s.orderId) byId.set(s.orderId, s);
  }

  // 🔴 نوع دورة S2 — لصفوف S2 بس (نفس أولوية `ecoWarehouseGate`: S1 الأول). فشله
  //    مايوقّعش الطابور: `s2Cycle: null` والواجهة بتكتب «استبدال/استرجاع».
  let cycleTypeFailed = null;
  const s2Rows = [...byId.values()].filter(o =>
    o.s2 === S2_STATUS.RETURNED && !o.cancelledAt && !S1_ELIGIBLE.has(o.s1 || ''));
  if (s2Rows.length) {
    try {
      const cyc = await fetchS2CycleTypes(env, token, s2Rows.map(o => o.orderGid), costLog);
      for (const o of s2Rows) o.s2Cycle = cyc.get(o.orderGid) ?? null;
    } catch (e) {
      cycleTypeFailed = String(e?.message || e).slice(0, 200);
      for (const o of s2Rows) o.s2Cycle = null;
    }
  }

  const step1Cost = costLog.filter(c => c.op.startsWith('warehouseStep1')).reduce((s, c) => s + (c.actual || 0), 0);
  const step2Cost = costLog.filter(c => c.op === 'warehouseStep2').reduce((s, c) => s + (c.actual || 0), 0);

  return json({
    ok: true,
    orders: [...byId.values()],
    truncated: step1Truncated || step2Truncated,
    // 🟡 v1.7.0 — لو استعلام نوع دورة S2 فشل (غالبًا `read_returns` ناقصة): الصفوف بـ`s2Cycle: null`
    cycleTypeFailed,
    // 🔴 الأرضية بترجع في الرد عشان **الواجهة تعرضها من هنا** — مش مكتوبة
    //    بالإيد هناك. رقمان يفترقوا في صمت هو درس R1 بالحرف.
    ordersSince,
    fetchedAt: new Date().toISOString(),
    // 🟡 تجريبي — راجع docs/query-cost-experiment.md بريبو الهب. مفيش أي
    //    اعتماد من الواجهة عليه، وحذفه بلا أي أثر.
    queryCost: {
      step1Calls:          costLog.filter(c => c.op.startsWith('warehouseStep1')).length,
      step1ActualTotal:    step1Cost,
      step2Calls:          costLog.filter(c => c.op === 'warehouseStep2').length,
      step2ActualTotal:    step2Cost,
      totalActual:         step1Cost + step2Cost,
      candidatesAfterStep1: candidateGids.length,
      detailsFetched:       detailNodes.length,
      step1Detail,          // [{ op, pages, truncated }, …] — لكل استعلام لوحده
    },
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §EDITED — طابور «أوردرات معدّلة» + «تحويل بوسطة» (v1.10.0 · طلب أحمد 25-10-2026)
// ══════════════════════════════════════════════════════════════
// 🔴 **استعلام واحد مشترك للتابين** — المصدر واحد (حالات عابرة: `Confirmed` · `Confirmed + Edit` ·
//    S2 `Confirmed + EXCHANGE`)، والفرق (المندوب/الزون) فلتر عرض في `ecoEditedGate` بالهب. استعلامين
//    كانوا هيضاعفوا تكلفة شوبيفاي لنفس الرد. ⛔ ومنفصل عن `get_ready_to_warehouse` بقرار: حالاته
//    نهائية وبتتراكم (آلاف)، وده عشرات — دمجهم بيربط فشلهم وبيخلط `truncated`.
// ⚠️ **فلتر `query` على الميتافيلد ممكن يلقط أكتر من المطلوب** (مثلاً `WhatsApp-Confirmed`) — فبنفلتر
//    بالقيمة الحرفية في الكود (`S1_EDITED`/`S2_EDITED`)، والاستعلام بس بيضيّق النطاق.
// ⚠️ **التمريرة ١ فيها وقتَي التغليف كمان** (خفيف) عشان نستبعد غير المتغلّف قبل التفاصيل الكاملة.
// ⚠️ **والعهدة `Office` بس في الطابور** (نفس قرار المرتجعات) — فلتر عرض، `evaluateEdited` بيقبل الباقي.
const EDITED_STEP1_FIELDS = `
  id
  legacyResourceId
  name
  cancelledAt
  s1: metafield(namespace: "custom", key: "manual_status") { value }
  s2: metafield(namespace: "custom", key: "status_2_r_e") { value }
  p1: metafield(namespace: "custom", key: "s1_packing_date_time") { value }
  p2: metafield(namespace: "custom", key: "s2_packing_date_time") { value }
  w1: metafield(namespace: "custom", key: "package_whereabouts_s1") { value }
  w2: metafield(namespace: "custom", key: "package_whereabouts_s2") { value }
`;
const EDITED_STEP1_QUERY = `
query EditedStep1($q: String!, $after: String, $n: Int!) {
  orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
    nodes { ${EDITED_STEP1_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

// أولوية الماكينة زي `evaluateEdited`: S1 الأول، وإلا S2. الملغي مستبعَد (شغل تاب المرتجعات).
function mergeEditedStep1(nodes) {
  const seen = new Set();
  const survivors = [];
  for (const n of nodes) {
    const id = n.legacyResourceId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (n.cancelledAt) continue;
    const s1 = n.s1?.value || '', s2 = n.s2?.value || '';
    const machine = S1_EDITED.has(s1) ? 's1' : (S2_EDITED.has(s2) ? 's2' : null);
    if (!machine) continue;
    const packed = machine === 's1' ? n.p1?.value : n.p2?.value;
    if (!packed) continue;
    const wa = machine === 's1' ? n.w1?.value : n.w2?.value;
    if (wa === WA_VALUES.OFFICE) survivors.push(n.id);
  }
  return survivors;
}

async function handleEditedQueue(env, request) {
  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);
  const costLog = [];
  const ordersSince = computeOrdersSince();
  const floor = ` AND created_at:>=${ordersSince}`;

  const [s1Confirmed, s1Edit, s2Exchange] = await Promise.all([
    fetchStep1Page(env, token, `metafields.custom.manual_status:'${S1_STATUS.CONFIRMED}'${floor}`,
                   'editedStep1_s1Confirmed', costLog, EDITED_STEP1_QUERY),
    fetchStep1Page(env, token, `metafields.custom.manual_status:'${S1_STATUS.CONFIRMED_EDIT}'${floor}`,
                   'editedStep1_s1Edit', costLog, EDITED_STEP1_QUERY),
    fetchStep1Page(env, token, `metafields.custom.status_2_r_e:'${S2_STATUS.CONFIRMED_EXCHANGE}'${floor}`,
                   'editedStep1_s2Exchange', costLog, EDITED_STEP1_QUERY),
  ]);

  const candidateGids = mergeEditedStep1([...s1Confirmed.nodes, ...s1Edit.nodes, ...s2Exchange.nodes]);
  const step1Truncated = s1Confirmed.truncated || s1Edit.truncated || s2Exchange.truncated;
  const ids = candidateGids.slice(0, STEP2_MAX_IDS);
  const step2Truncated = candidateGids.length > STEP2_MAX_IDS;
  const detailNodes = ids.length ? await fetchStep2Batch(env, token, ids, costLog) : [];

  const byId = new Map();
  for (const n of detailNodes) {
    const s = shapeOrder(n);
    if (s.orderId) byId.set(s.orderId, s);
  }
  const sum = pre => costLog.filter(c => c.op.startsWith(pre)).reduce((t, c) => t + (c.actual || 0), 0);

  return json({
    ok: true,
    orders: [...byId.values()],
    truncated: step1Truncated || step2Truncated,
    ordersSince,
    fetchedAt: new Date().toISOString(),
    queryCost: {
      step1Calls: costLog.filter(c => c.op.startsWith('editedStep1')).length,
      step1ActualTotal: sum('editedStep1'),
      step2Calls: costLog.filter(c => c.op === 'warehouseStep2').length,
      step2ActualTotal: sum('warehouseStep2'),
      candidatesAfterStep1: candidateGids.length,
      detailsFetched: detailNodes.length,
      step1Detail: [s1Confirmed, s1Edit, s2Exchange].map(r => ({ op: r.op, pages: r.pages, truncated: r.truncated })),
    },
  }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §SCAN — سكان باركود الأوردر → كتابة `Warehouse`
// ══════════════════════════════════════════════════════════════

// ─── §SCAN::queries — مبنية من نفس `ORDER_FIELDS` ───
const ORDER_BY_ID_QUERY   = `query OrderById($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
const ORDER_BY_NAME_QUERY = `query OrderByName($q: String!) { orders(first: 5, query: $q) { nodes { ${ORDER_FIELDS} } } }`;

// ─── §SCAN::resolveOrder ───
// 🔴 **باركود الفاتورة بيشفّر الـ ID الرقمي** (١٠ خانات فأكتر)، واسم الأوردر
//    ٥ خانات. الرقم الطويل بيتقرا **قراءة بمفتاح**، والقصير **بحث**.
// ⚠️ والبحث بالاسم **بحث مش قراءة** (`shopify-graphql-helper`): `name:#5362`
//    بيطابق `#53621` كمان. المطابقة التامة على الاسم الراجع **إلزامية** —
//    من غيرها الأداة بتكتب `Warehouse` على **أوردر تاني**.
async function resolveOrder(env, token, code) {
  const raw    = String(code || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { order: null, reason: 'الباركود ما فيهوش أرقام — اسكنه تاني' };

  if (digits.length >= 10) {
    const data = await shopifyGQL(env, token, ORDER_BY_ID_QUERY,
      { id: `gid://shopify/Order/${digits}` }, 'orderById');
    const node = data.data?.order;
    if (!node) return { order: null, reason: `مفيش أوردر على شوبيفاي بالرقم ${digits}` };
    return { order: shapeOrder(node) };
  }

  const wanted = `#${digits}`;
  const data   = await shopifyGQL(env, token, ORDER_BY_NAME_QUERY,
    { q: `name:${wanted}` }, 'orderByName');
  const nodes  = data.data?.orders?.nodes || [];
  const hit    = nodes.find(n => n.name === wanted);
  if (!hit) {
    return { order: null, reason: nodes.length
      ? `الأوردر ${wanted} مش موجود — البحث رجّع ${nodes.length} أوردر تاني، ومحدش منهم مطابق`
      : `الأوردر ${wanted} مش موجود على شوبيفاي` };
  }
  return { order: shapeOrder(hit) };
}

// ─── §SCAN::evaluate — الحكم، وهو **المرجع** ───
// بيرجّع { level, machine, code, message, warnings[] }:
//   blocked  → مفيش كتابة خالص · الشاشة حمرا بالسبب
//   already  → العهدة **هي المستهدفة أصلاً** — مفيش حاجة كانت مطلوبة
//              (`ecommoda-constants` §12: ⛔ ممنوع تتعدّ فشل وممنوع تاخد لون تحذير)
//   warn     → فيه شغل بس محتاج مراجعة — بيكمّل **بإقرار** (`ack`)
//   ok       → يتكتب على طول
//
// 🔴 **الترتيب هنا مقلوب عن أداة المكتب عن قصد.** هناك الإلغاء أول حارس
//    بيرفض؛ هنا الإلغاء **شرط أهلية**، فالترتيب بيبدأ بالنطاق (بوسطة/زون)
//    وبعده الحالة. ⛔ أي نسخ لحارس الإلغاء من هناك بيقفل الأداة دي بالكامل.
function evaluate(o, mode = MODE.RETURNED) {
  if (mode !== MODE.RETURNED) return evaluateEdited(o, mode);
  const warnings = [];

  // ① خارج النطاق — بوسطة
  // ⚠️ الفحص على المندوب **والزون** مع بعض: المندوب حقيقة متسجّلة عن الشحن،
  //    والزون قرار توجيه.
  if (o.courier === COURIER_BOSTA || o.zone === 'Other_Regions') {
    return { level: 'blocked', code: 'bosta', machine: null,
      message: 'الأوردر ده بيتشحن مع بوسطة — مرتجعات بوسطة ليها أداتها '
             + '(«قسم مرتجعات بوسطة»)، وعهدة الطرد مابتتسجّلش على شحنات بوسطة' };
  }
  if (!ZONE_IN_SCOPE.has(o.zone || '')) {
    return { level: 'blocked', code: 'zone', machine: null,
      message: `الزون «${o.zone || 'فاضي'}» مش من نطاق الأداة — النطاق: قاهرة+جيزة أو شو روم` };
  }

  // ② الماكينة — الحالة المؤهلة هي `Returned` أو `Cancelled`
  // 🔴 S1 الأول (زي أداة المكتب بالحرف)، و S2 بعده. الأوردر اللي الاتنين
  //    فيه مؤهلين حالة شاذة — بيتسجّل على S1 **بإقرار**، مش بيترفض.
  // ⚠️ و`cancelledAt` (الإلغاء على شوبيفاي نفسها) **مؤهل زي `Cancelled`
  //    بالظبط** — الطرد راجع سواء الإلغاء اتكتب في الميتافيلد ولا لأ.
  //    ودي الحالة اللي **مش في الطابور** (فوق في §QUEUE)، فلو اترفضت هنا
  //    كمان بقى مالهاش أي طريق خالص.
  const s1Eligible = S1_ELIGIBLE.has(o.s1 || '') || !!o.cancelledAt;
  const s2Eligible = S2_ELIGIBLE.has(o.s2 || '');

  let machine = null;
  if (s1Eligible)      machine = 's1';
  else if (s2Eligible) machine = 's2';

  if (!machine) {
    return { level: 'blocked', code: 'status', machine: null,
      message: `الأوردر ده لا مرتجع ولا ملغي (S1 = ${o.s1 || '—'} · S2 = ${o.s2 || '—'}) — `
             + 'الطرد ده مش راجع للمخزن' };
  }

  // ③ متغلّف فعلاً — **وقت تغليف الشحنة الأصلية (S1)** على الماكينتين
  // 🔴 **v1.6.0 — قرار أحمد 22-10-2026:** الشرط كان بيفحص `s2_packing_date_time`
  //    على صف S2، فكل **استرجاع خالص** (`#53764`) كان بيترفض بـ«مفيش طرد يرجع»
  //    — مع إن الطرد الراجع هو الشحنة الأصلية اللي اتغلّفت وخرجت، ومفيش طرد S2
  //    اتغلّف أصلاً. فحص `s2_…` صح في أداة المكتب (الطرد الخارج)، **غلط هنا**
  //    (الطرد الراجع). التفاصيل في `packedAtOf` فوق.
  // ⚠️ **ومعنى الشرط هنا أقوى من هناك:** أوردر اتلغى قبل ما يتغلّف **مفيهوش طرد
  //    أصلاً** — مفيش حاجة ترجع على الرف، والمنتجات ما خرجتش من مكانها.
  // ⚠️ وتسلسل S2 راجع والشحنة الأصلية مش `Delivered` لسه بيطلع تحذير تحت (⑤).
  if (!packedAtOf(o)) {
    return { level: 'blocked', code: 'not_packed', machine,
      message: machine === 's1'
        ? 'الأوردر ده ما اتغلّفش أصلاً — مفيش طرد يرجع، والمنتجات ما خرجتش من مكانها'
        : 'الشحنة الأصلية ما اتغلّفتش — مفيش وقت تغليف (S1) مسجّل، فمفيش طرد يرجع' };
  }

  // ④ العهدة الحالية
  // 🔴 **مقلوبة عن أداة المكتب.** هناك `Office` = خلاص متعمل و`Courier` = رفض؛
  //    هنا `Warehouse` = خلاص متعمل، و**`Office` و`Courier` هما الحالتان
  //    الطبيعيتان** — الطرد راجع من المكتب أو من إيد المندوب.
  const cur = machine === 's1' ? o.whereaboutsS1 : o.whereaboutsS2;
  if (cur === WA_VALUES.WAREHOUSE) {
    return { level: 'already', code: 'already_warehouse', machine,
      message: 'الطرد ده مسجّل في المخزن خلاص — مفيش حاجة كانت مطلوبة' };
  }
  if (cur && cur !== WA_VALUES.OFFICE && cur !== WA_VALUES.COURIER) {
    // Rule 13 — قيمة بره قايمة الاختيار: **بلّغ عنها، متحركهاش في صمت**
    warnings.push(`عهدة الطرد فيها قيمة غير معروفة: «${cur}»`);
  }

  // ⑤ الحالات الشاذة — بتتسكن، بس **بإقرار**
  if (s1Eligible && s2Eligible) {
    warnings.push('الشحنة الأصلية ودورة الاستبدال/الاسترجاع **الاتنين** مرتجعين/ملغيين — '
                + 'هنسجّل على الشحنة الأصلية (S1). لو الطرد اللي في إيدك بتاع الاستبدال، اسأل الأول.');
  }
  // ⚠️ طرد S2 راجع والشحنة الأصلية لسه مش `Delivered` = تسلسل غير متوقّع.
  //    مش رفض — الطرد في إيد الموظف فعلاً — بس لازم يتقال.
  if (machine === 's2' && o.s1 !== S1_STATUS.DELIVERED) {
    warnings.push(`دورة الاستبدال/الاسترجاع مرتجعة بينما الشحنة الأصلية `
                + `(S1 = ${o.s1 || '—'}) لسه مش Delivered — راجع حالة الأوردر`);
  }
  const S1_KNOWN = new Set(Object.values(S1_STATUS));
  const S2_KNOWN = new Set(Object.values(S2_STATUS));
  if (o.s1 && !S1_KNOWN.has(o.s1)) warnings.push(`حالة S1 «${o.s1}» مش من القايمة المعتمدة`);
  if (o.s2 && !S2_KNOWN.has(o.s2)) warnings.push(`حالة S2 «${o.s2}» مش من القايمة المعتمدة`);

  if (warnings.length) {
    return { level: 'warn', code: 'anomaly', machine, warnings,
      message: 'الأوردر مؤهل، بس فيه حاجة محتاجة مراجعة قبل التسجيل' };
  }
  return { level: 'ok', code: 'ok', machine, warnings: [] };
}

// ─── §EDITED::evaluate — الحكم في تابَي «أوردرات معدّلة» و«تحويل بوسطة» (v1.10.0) ───
// 🔴 نفس هيكل `evaluate` بالظبط، بس الحالة المؤهلة `Confirmed`/`Confirmed + Edit` (S1) و
//    `Confirmed + EXCHANGE` (S2)، **والملغي مرفوض** (ده شغل تاب المرتجعات)، والتغليف بميتافيلد
//    الماكينة. ⛔ نفس الشروط في `ecoEditedGate` (`shared/gates.js` بالهب) في نفس التمريرة (درس R1).
function evaluateEdited(o, mode) {
  const warnings = [];
  const bostaTab = mode === MODE.EDITED_BOSTA;
  const isBosta  = o.courier === COURIER_BOSTA;

  // ① النطاق — بوسطة / الزون
  if (bostaTab) {
    if (!isBosta)
      return { level: 'blocked', code: 'not_bosta', machine: null, mode,
        message: `المندوب «${o.courier || 'فاضي'}» مش Bosta — الأوردر ده مكانه تاب «أوردرات معدّلة»` };
    if (o.zone !== BOSTA_ZONE)
      return { level: 'blocked', code: 'zone', machine: null, mode,
        message: `الزون «${o.zone || 'فاضي'}» مش ${BOSTA_ZONE} — تاب «تحويل بوسطة» للأوردرات اللي زونها اتحوّل لبوسطة` };
  } else {
    if (isBosta || o.zone === BOSTA_ZONE)
      return { level: 'blocked', code: 'bosta', machine: null, mode,
        message: 'الأوردر ده بوسطة — مكانه تاب «تحويل بوسطة»' };
    if (!ZONE_IN_SCOPE.has(o.zone || ''))
      return { level: 'blocked', code: 'zone', machine: null, mode,
        message: `الزون «${o.zone || 'فاضي'}» مش من نطاق الأداة — النطاق: قاهرة+جيزة أو شو روم` };
  }

  // ② الملغي — شغل تاب «مرتجعات + لواغي»
  if (o.cancelledAt || S1_ELIGIBLE.has(o.s1 || ''))
    return { level: 'blocked', code: 'cancelled', machine: null, mode,
      message: 'الأوردر ده ملغي أو مرتجع — مكانه تاب «مرتجعات + لواغي»' };

  // ③ الماكينة — S1 الأول
  const s1Eligible = S1_EDITED.has(o.s1 || '');
  const s2Eligible = S2_EDITED.has(o.s2 || '');
  const machine = s1Eligible ? 's1' : (s2Eligible ? 's2' : null);
  if (!machine)
    return { level: 'blocked', code: 'status', machine: null, mode,
      message: `الأوردر ده مش معدّل (S1 = ${o.s1 || '—'} · S2 = ${o.s2 || '—'}) — `
             + 'المطلوب Confirmed / Confirmed + Edit (S1) أو Confirmed + EXCHANGE (S2)' };

  // ④ متغلّف فعلاً — بميتافيلد الماكينة بتاعتها (الطرد الخارج)
  if (!(machine === 's1' ? o.packedAtS1 : o.packedAtS2))
    return { level: 'blocked', code: 'not_packed', machine, mode,
      message: 'الأوردر ده ما اتغلّفش — مفيش طرد في المكتب يرجع' };

  // ⑤ العهدة الحالية
  const cur = machine === 's1' ? o.whereaboutsS1 : o.whereaboutsS2;
  if (cur === WA_VALUES.WAREHOUSE)
    return { level: 'already', code: 'already_warehouse', machine, mode,
      message: 'الطرد ده مسجّل في المخزن خلاص — مفيش حاجة كانت مطلوبة' };
  if (cur && cur !== WA_VALUES.OFFICE && cur !== WA_VALUES.COURIER)
    warnings.push(`عهدة الطرد فيها قيمة غير معروفة: «${cur}»`);

  // ⑥ الحالات الشاذة — بإقرار
  if (s1Eligible && s2Eligible)
    warnings.push('الشحنة الأصلية ودورة الاستبدال **الاتنين** معدّلين — هنسجّل على الشحنة الأصلية (S1). '
                + 'لو الطرد اللي في إيدك بتاع الاستبدال، اسأل الأول.');
  const S1_KNOWN = new Set(Object.values(S1_STATUS));
  const S2_KNOWN = new Set(Object.values(S2_STATUS));
  if (o.s1 && !S1_KNOWN.has(o.s1)) warnings.push(`حالة S1 «${o.s1}» مش من القايمة المعتمدة`);
  if (o.s2 && !S2_KNOWN.has(o.s2)) warnings.push(`حالة S2 «${o.s2}» مش من القايمة المعتمدة`);

  if (warnings.length)
    return { level: 'warn', code: 'anomaly', machine, mode, warnings,
      message: 'الأوردر مؤهل، بس فيه حاجة محتاجة مراجعة قبل التسجيل' };
  return { level: 'ok', code: 'ok', machine, mode, warnings: [] };
}

// ─── §SCAN::writeWhereabouts ───
// التلات فحوصات (worker-builder Step 5A ②): top-level (جوّه `shopifyGQL`) →
// `userErrors` → **تأكيد الـ payload**. الفحص التالت هو اللي بيتنسى:
// `userErrors: []` معناها «مفيش اعتراض»، مش «اتنفّذت».
const SET_MF = `
mutation SetWhereabouts($mf: [MetafieldsSetInput!]!) {
  metafieldsSet(metafields: $mf) {
    metafields { key value namespace }
    userErrors { field message code }
  }
}`;

async function writeWhereabouts(env, token, orderGid, machine) {
  const key  = WA_KEY[machine];
  const data = await shopifyGQL(env, token, SET_MF, {
    mf: [{ ownerId: orderGid, namespace: 'custom', key, type: WA_TYPE, value: WA_TARGET }],
  }, 'metafieldsSet');

  const res  = data.data?.metafieldsSet;
  const errs = res?.userErrors || [];
  if (errs.length) throw new Error('metafieldsSet: ' + errs.map(e => e.message).join(' | '));

  const wrote = (res?.metafields || []).find(m => m.key === key);
  if (!wrote) throw new Error('metafieldsSet: شوبيفاي ما أكدتش الكتابة (مفيش ميتافيلد راجع)');
  if (wrote.value !== WA_TARGET)
    throw new Error(`metafieldsSet: القيمة الراجعة «${wrote.value}» مش «${WA_TARGET}»`);
  return wrote.value;
}

// ─── §SCAN::handleScan ───
// 🔴 **قاعدة عدم الضياع (worker-builder ⑭): كل سكانة بتسيب صف واحد بالظبط** —
//    يا `update` يا `rejected`. صفر صفوف = سؤال «الأوردر ده اتسكن ولا لأ؟»
//    مالوش إجابة بعد ما الشاشة تتقفل.
//    ⚠️ **الاستثناء الوحيد:** حالة `needs_ack` — مفيش قرار اتاخد لسه، والسكانة
//       **هتكمّل** بصف كامل بعد الإقرار. صف هنا كان هيبقى صفّين لسكانة واحدة.
async function handleScan(env, request) {
  const body = await request.json().catch(() => ({}));
  const code     = String(body.code || '').trim();
  const employee = body.employee ? String(body.employee) : null;
  const ack      = body.ack === true;
  const mode     = parseMode(body);

  if (!code) return json({ ok: false, error: 'مفيش باركود في الطلب' }, 400, request);

  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);

  const { order, reason } = await resolveOrder(env, token, code);

  // ① الأوردر نفسه مش موجود — صف رفض باسم اللي اتسكن (مفيش orderName)
  if (!order) {
    const logged = await safeLog(env, {
      tool: TOOL_NAME, type: 'rejected', employee,
      notes: reason,
      extra: { sourceTool: SOURCE_TOOL, result: 'rejected', stage: 'lookup',
               code: 'not_found', scanned: code, mode },
    });
    return json({ ok: true, result: 'rejected', code: 'not_found',
      message: reason, scanned: code, ...logged }, 200, request);
  }

  const v = evaluate(order, mode);

  // ② محتاج إقرار ولسه ما اقرّش — مفيش كتابة ومفيش صف
  if (v.level === 'warn' && !ack) {
    return json({ ok: true, result: 'needs_ack', code: v.code,
      message: v.message, warnings: v.warnings || [], machine: v.machine,
      order }, 200, request);
  }

  // ③ مرفوض / خلاص متعمل — صف بلا أي لمسة على شوبيفاي
  if (v.level === 'blocked' || v.level === 'already') {
    const result = v.level === 'already' ? 'already' : 'rejected';
    const logged = await safeLog(env, {
      tool: TOOL_NAME, type: 'rejected', employee,
      orderId: order.orderId, orderName: order.orderName,
      valueBefore: currentWhereabouts(order, v.machine), valueAfter: null,
      notes: v.message,
      extra: { sourceTool: SOURCE_TOOL, result, stage: 'lookup', code: v.code,
               machine: machineLabel(v.machine), mode,
               zone: order.zone, courier: order.courier, s1: order.s1, s2: order.s2 },
    });
    return json({ ok: true, result, code: v.code, message: v.message,
      order, machine: v.machine, ...logged }, 200, request);
  }

  // ④ الكتابة
  const before = currentWhereabouts(order, v.machine);
  let wrote = null, error = null;
  try {
    wrote = await writeWhereabouts(env, token, order.orderGid, v.machine);
  } catch (e) { error = e.message; }

  const result = error ? 'error' : (v.warnings && v.warnings.length ? 'warning' : 'success');
  const logged = await safeLog(env, {
    // ⚠️ `update` — القيمة دي **مسجّلة أصلاً** لصف `metafields_change` في
    //    `ecommoda-constants` §7، والفصل بيحصل بـ`extra.sourceTool`. قيمة
    //    `type` جديدة كانت هتفتح بند Rule 7 بلا داعي.
    tool: TOOL_NAME, type: 'update', employee,
    orderId: order.orderId, orderName: order.orderName,
    valueBefore: before, valueAfter: error ? null : WA_TARGET,
    notes: error || (v.warnings || []).join(' · ') || null,
    extra: {
      sourceTool: SOURCE_TOOL,
      result, stage: 'write', machine: machineLabel(v.machine), mode,
      zone: order.zone, courier: order.courier, s1: order.s1, s2: order.s2,
      cancelledAt: order.cancelledAt || undefined,
      packedAt: packedAtOf(order, v),
      packedBy: packedByOf(order, v),
      acknowledged: ack || undefined,
      warnings: (v.warnings && v.warnings.length) ? v.warnings : undefined,
      cairoDate: cairoDate(),
    },
  });

  return json({
    ok: !error, result, code: error ? 'write_failed' : 'written',
    message: error || null, order, machine: v.machine,
    warnings: v.warnings || [], valueBefore: before, valueAfter: wrote, ...logged,
  }, 200, request);
}

// 🔴 **وقت التغليف ومين غلّف بيتقروا من S1 على الماكينتين** (v1.6.0 — قرار أحمد
//    22-10-2026). الطرد اللي بيرجع المخزن هو **الشحنة الأصلية** اللي اتغلّفت
//    وخرجت في S1: في دورة S2 (استرجاع/استبدال) القطعة الراجعة هي القديمة، و**في
//    الاسترجاع الخالص مفيش طرد S2 اتغلّف أصلاً** (`s2_packing_date_time` فاضي
//    طبيعي). فحص `s2_…` هنا كان بيرفض كل استرجاع بـ«مفيش طرد يرجع».
// ⚠️ **ده عكس أداة المكتب بالحرف** — هناك الطرد S2 خارج، فهو طرد الاستبدال
//    (`s2_…` صح). ⛔ ممنوع الرجوع لـ`machine === 's1' ? …S1 : …S2` هنا.
// ⚠️ ومش بنفرّق بين استرجاع واستبدال: `exchangeLineItems` الفاضي مش دليل
//    إنها استرجاع (`ecommoda-order-lifecycle` قاعدة ٨).
// ⚠️ **v1.10.0:** في تابَي المعدّلة (`v.mode !== returned`) الطرد **خارج** فالتغليف بميتافيلد
//    الماكينة (`s2_…` لـS2) — عكس المرتجعات. بدون `v` = سلوك المرتجعات بالحرف.
function packedAtOf(o, v)  {
  if (v && v.mode && v.mode !== MODE.RETURNED && v.machine === 's2') return o.packedAtS2 || null;
  return o.packedAtS1 || null;
}
function packedByOf(o, v)  {
  if (v && v.mode && v.mode !== MODE.RETURNED && v.machine === 's2') return o.packedByS2 || null;
  return o.packedByS1 || null;
}

function currentWhereabouts(o, machine) {
  if (!machine) return null;
  return (machine === 's1' ? o.whereaboutsS1 : o.whereaboutsS2) || null;
}
function machineLabel(machine) {
  return machine === 's1' ? 'S1' : machine === 's2' ? 'S2' : null;
}

// ⚠️ فشل D1 **بيبان** — مفيش `.catch(() => {})`. العملية على شوبيفاي حصلت
//    فعلاً، والواجهة لازم تحذّر إن مفيش أثر في السجل.
async function safeLog(env, entry) {
  try { await writeLog(env.DB, entry); return { logged: true }; }
  catch (e) { return { logged: false, logError: e.message }; }
}

// ══════════════════════════════════════════════════════════════
// §RECEIVE — الاستلام قطعة قطعة + دفتر القطع الراجعة (v1.5.0 · طلب أحمد 22-10-2026)
// ══════════════════════════════════════════════════════════════
// 🔴 **الدفتر** = جدول D1 `warehouse_return_items` (التعريف في
//    `schema/warehouse_return_items.sql` في الريبو ده — بيتعمل مرة واحدة من
//    D1 Console). سطر لكل **قطعة** (`unit_index`)، بتلات حالات:
//    `pending` (مستنية الاستلام) · `received` (اتسلّمت للمخزن) · `missing` (ناقصة).
//
// 🔴 **مين بيكتب فيه (عقد — يتعدّل في الريبوهين مع بعض):**
//    ① `partial-delivery-worker` → `pending` لكل قطعة اتشالت (source = partial_delivery).
//       الأوردر بيفضل `Shipped` فعمره ما بيظهر في طابور المحطة — السطر ده هو
//       الأثر الوحيد إن القطعة في المكتب.
//    ② الـ Worker ده → بيقفل سطور ① (`receive_item`)، وبيكتب قطع الأوردرات
//       الكاملة **وقت الاستلام** (`receive_order` · source = order_return).
//       الأوردر الكامل موجود أصلاً في الطابور (§QUEUE)، وقطعه بتتقرا من شوبيفاي.
//
// ⚠️ **`scan` و`get_ready_to_warehouse` ما اتلمسوش** — الصفحة الجديدة بتنادي
//    `order_items` + `receive_order` بدل `scan`، و`scan` فاضل لأي تاب مفتوح على
//    نسخة الصفحة القديمة. الطابور نفس العقد بالحرف.
//
// 🔴 **قطع الطرد مش في `currentQuantity`** — الإلغاء/المرتجع بيصفّرها (مقيس حي
//    22-10-2026 على #61251 · #61404). المصادر الحقيقية (مقيسة كمان):
//    · S1 (ملغي / مرتجع قبل التسليم): `refunds.refundLineItems` بتاع سجل الإلغاء
//      — اللي اتعمل في نفس لحظة `cancelledAt`. القطع اللي اتشالت قبلها بالتسليم
//      الجزئي **مش فيه** (اتشالت قبل الإلغاء)، فمفيش عدّ مرتين.
//    · S2 (مرتجع دورة استرجاع/استبدال): `returnLineItems` في آخر Return مش ملغي
//      = **القطعة القديمة** الراجعة من العميل (مش قطعة الاستبدال — #60513).
const LEDGER_TABLE        = 'warehouse_return_items';
const LEDGER_SRC_PARTIAL  = 'partial_delivery';
const LEDGER_SRC_ORDER    = 'order_return';
const LEDGER_LIST_MAX     = 2000;                 // حارس — القايمة المستنية عشرات مش آلاف
const CANCEL_REFUND_WINDOW_MS = 10 * 60 * 1000;   // سجل الإلغاء بيتعمل قبل cancelledAt بثانية-اتنين (مقيس)

// ⚠️ **استعلامين منفصلين بالماكينة مش واحد** — `returns` محتاجة صلاحية
//    `read_returns`. لو اتجمعوا في استعلام واحد، غياب الصلاحية كان هيوقّع
//    استلام S1 كمان (اللي مالوش أي علاقة بالمرتجعات).
const ORDER_ITEMS_S1_QUERY = `
query OrderItemsS1($id: ID!) {
  order(id: $id) {
    id
    cancelledAt
    lineItems(first: 50) { nodes { id sku name currentQuantity image { url } variant { id barcode image { url } } } }
    refunds {
      createdAt
      refundLineItems(first: 50) { nodes { quantity lineItem { id sku name image { url } variant { id barcode image { url } } } } }
    }
  }
}`;
const ORDER_ITEMS_S2_QUERY = `
query OrderItemsS2($id: ID!) {
  order(id: $id) {
    id
    returns(first: 10) {
      nodes {
        id status createdAt
        returnLineItems(first: 50) {
          nodes { quantity ... on ReturnLineItem { fulfillmentLineItem { lineItem { id sku name image { url } variant { id barcode image { url } } } } } }
        }
      }
    }
  }
}`;

function addItem(map, li, qty) {
  if (!li?.id || !(qty > 0)) return;
  const cur = map.get(li.id);
  if (cur) { cur.qty += qty; return; }
  map.set(li.id, { lineItemId: li.id, sku: li.sku || null, title: li.name || null,
                   variantId: li.variant?.id || null, barcode: li.variant?.barcode || null,
                   imageUrl: li.image?.url || li.variant?.image?.url || null, qty });
}

// ─── §RECEIVE::fetchOrderItems — قطع الطرد الفعلية حسب الماكينة ───
// بيرجّع { items, cycleKey, itemsSource } — و`items = []` معناه «ما قدرناش
// نحدد القطع» (مش «الطرد فاضي»)، والواجهة بتطلب إقرار صريح قبل الإكمال.
async function fetchOrderItems(env, token, orderGid, machine) {
  const data = await shopifyGQL(env, token,
    machine === 's2' ? ORDER_ITEMS_S2_QUERY : ORDER_ITEMS_S1_QUERY, { id: orderGid },
    machine === 's2' ? 'orderItemsS2' : 'orderItemsS1');
  const o = data.data?.order;
  if (!o) throw new Error('orderItems: الأوردر مارجعش من شوبيفاي');
  const map = new Map();

  if (machine === 's2') {
    const live = (o.returns?.nodes || [])
      .filter(r => r.status !== 'CANCELED' && r.status !== 'DECLINED')
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const ret = live[0];
    if (!ret) return { items: [], cycleKey: null, itemsSource: 'none' };
    for (const n of (ret.returnLineItems?.nodes || []))
      addItem(map, n.fulfillmentLineItem?.lineItem, n.quantity);
    return { items: [...map.values()], cycleKey: ret.id, itemsSource: 'return' };
  }

  // S1
  if (o.cancelledAt) {
    const at = Date.parse(o.cancelledAt);
    for (const rf of (o.refunds || [])) {
      const t = Date.parse(rf.createdAt);
      if (!Number.isFinite(t) || Math.abs(t - at) > CANCEL_REFUND_WINDOW_MS) continue;
      for (const n of (rf.refundLineItems?.nodes || [])) addItem(map, n.lineItem, n.quantity);
    }
    return { items: [...map.values()], cycleKey: 'S1', itemsSource: 'cancel_refund' };
  }
  // الحالة متسجّلة Returned/Cancelled والأوردر مش ملغي على شوبيفاي — القطع لسه
  // في `currentQuantity`.
  for (const li of (o.lineItems?.nodes || [])) addItem(map, li, li.currentQuantity);
  return { items: [...map.values()], cycleKey: 'S1', itemsSource: 'current' };
}

function unitKey(lineItemId, unitIndex) { return `${lineItemId}#${unitIndex}`; }
function expandUnits(items) {
  const out = [];
  for (const it of items) for (let u = 1; u <= it.qty; u++) out.push({ ...it, unitIndex: u, key: unitKey(it.lineItemId, u) });
  return out;
}

function ledgerMissingMsg(e) {
  return /no such table/i.test(String(e?.message || ''))
    ? `جدول ${LEDGER_TABLE} مش موجود في D1 — شغّل schema/${LEDGER_TABLE}.sql مرة واحدة من D1 Console`
    : String(e?.message || e);
}

// ─── §RECEIVE::handleOrderItems — الخطوة ① بعد سكان باركود الأوردر ───
// 🔴 نفس أحكام `scan` بالحرف (resolveOrder + evaluate)، ونفس صف السجل على
//    الرفض/«خلاص متعمل» — عشان «كل سكانة بتسيب صف» تفضل صحيحة. الفرق إن
//    الحالة السليمة **مابتكتبش** — بترجّع قايمة القطع، والكتابة في `receive_order`.
async function handleOrderItems(env, request) {
  const body = await request.json().catch(() => ({}));
  const code     = String(body.code || '').trim();
  const employee = body.employee ? String(body.employee) : null;
  const ack      = body.ack === true;
  if (parseMode(body) !== MODE.RETURNED)
    return json({ ok: false, error: 'الاستلام قطعة قطعة لتاب المرتجعات بس — التابين التانيين بيستخدموا scan' }, 400, request);
  if (!code) return json({ ok: false, error: 'مفيش باركود في الطلب' }, 400, request);

  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);
  const { order, reason } = await resolveOrder(env, token, code);

  if (!order) {
    const logged = await safeLog(env, {
      tool: TOOL_NAME, type: 'rejected', employee, notes: reason,
      extra: { sourceTool: SOURCE_TOOL, result: 'rejected', stage: 'lookup', code: 'not_found', scanned: code },
    });
    return json({ ok: true, result: 'rejected', code: 'not_found', message: reason, scanned: code, ...logged }, 200, request);
  }

  const v = evaluate(order);
  if (v.level === 'warn' && !ack) {
    return json({ ok: true, result: 'needs_ack', code: v.code, message: v.message,
      warnings: v.warnings || [], machine: v.machine, order }, 200, request);
  }
  if (v.level === 'blocked' || v.level === 'already') {
    const result = v.level === 'already' ? 'already' : 'rejected';
    const logged = await safeLog(env, {
      tool: TOOL_NAME, type: 'rejected', employee,
      orderId: order.orderId, orderName: order.orderName,
      valueBefore: currentWhereabouts(order, v.machine), valueAfter: null, notes: v.message,
      extra: { sourceTool: SOURCE_TOOL, result, stage: 'lookup', code: v.code, machine: machineLabel(v.machine),
               zone: order.zone, courier: order.courier, s1: order.s1, s2: order.s2 },
    });
    return json({ ok: true, result, code: v.code, message: v.message, order, machine: v.machine, ...logged }, 200, request);
  }

  const { items, cycleKey, itemsSource } = await fetchOrderItems(env, token, order.orderGid, v.machine);
  return json({ ok: true, result: 'items', order, machine: v.machine, warnings: v.warnings || [],
    items, cycleKey, itemsSource, itemsUnknown: items.length === 0 }, 200, request);
}

// 409 = «مفيش كتابة حصلت — راجع وأعد». `error` بيتملّى من `message` عشان أي مستهلك
// بيقرا `error` بس (زي `ecoApi`) يعرض الجملة نفسها مش «HTTP 409».
function conflict409(request, obj) {
  return json({ ...obj, error: obj.error || obj.message }, 409, request);
}

// ─── §RECEIVE::handleReceiveOrder — الخطوة ② بعد سكان كل القطع ───
// الطلب: { code, employee, ack, scanned: [{ key, mode }], missing: [key],
//          missingAck, itemsUnknownAck }
// 🔴 **كل حاجة بتتعاد على قراءة طازجة** (worker-builder ⑩④): الحكم والقطع.
//    أي مفتاح قطعة مش في القايمة الحيّة، أو قطعة مش مغطّية (لا اتسكنت ولا
//    اتعلّمت ناقصة) = 409 **قبل** أي كتابة.
// 🔴 **الترتيب:** عهدة الطرد الأول (الفعل الأساسي — زي `scan` بالحرف)، وبعدها
//    الدفتر (تكميلي — فشله `warning` مش `error`).
async function handleReceiveOrder(env, request) {
  const body = await request.json().catch(() => ({}));
  const code     = String(body.code || '').trim();
  const employee = body.employee ? String(body.employee) : null;
  const ack      = body.ack === true;
  const scanned  = Array.isArray(body.scanned) ? body.scanned : [];
  const missing  = Array.isArray(body.missing) ? body.missing.map(String) : [];
  if (parseMode(body) !== MODE.RETURNED)
    return json({ ok: false, error: 'الاستلام قطعة قطعة لتاب المرتجعات بس — التابين التانيين بيستخدموا scan' }, 400, request);
  if (!code) return json({ ok: false, error: 'مفيش باركود في الطلب' }, 400, request);

  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);
  const { order, reason } = await resolveOrder(env, token, code);
  if (!order) return conflict409(request, { ok: false, result: 'rejected', code: 'not_found', message: reason });

  const v = evaluate(order);
  if (v.level === 'blocked' || v.level === 'already') {
    // الحالة اتغيّرت بين السكانة والإكمال — مفيش كتابة، والواجهة بتعيد السكان.
    return conflict409(request, { ok: false, result: v.level === 'already' ? 'already' : 'rejected', code: v.code,
      message: v.message, order });
  }
  if (v.level === 'warn' && !ack)
    return conflict409(request, { ok: false, result: 'needs_ack', code: v.code, message: v.message, warnings: v.warnings || [] });

  const { items, cycleKey, itemsSource } = await fetchOrderItems(env, token, order.orderGid, v.machine);
  const units = expandUnits(items);
  const scannedMap = new Map();
  for (const s of scanned) {
    const k = String(s?.key || '');
    scannedMap.set(k, s?.mode === 'manual' ? 'manual' : 'scan');
  }

  if (!units.length) {
    if (body.itemsUnknownAck !== true)
      return conflict409(request, { ok: false, result: 'needs_ack', code: 'items_unknown',
        message: 'ما قدرناش نحدد قطع الطرد من شوبيفاي — أكّد الاستلام يدويًا' });
  } else {
    const valid = new Set(units.map(u => u.key));
    const unknown = [...scannedMap.keys(), ...missing].filter(k => !valid.has(k));
    if (unknown.length)
      return conflict409(request, { ok: false, result: 'stale', code: 'items_changed',
        message: 'قطع الأوردر اتغيّرت على شوبيفاي من وقت السكان — اسكن الأوردر تاني', items });
    const both = missing.filter(k => scannedMap.has(k));
    if (both.length)
      return json({ ok: false, error: 'نفس القطعة اتعلّمت «اتسكنت» و«ناقصة» مع بعض' }, 400, request);
    const uncovered = units.filter(u => !scannedMap.has(u.key) && !missing.includes(u.key));
    if (uncovered.length)
      return conflict409(request, { ok: false, result: 'incomplete', code: 'uncovered',
        message: `فاضل ${uncovered.length} قطعة لا اتسكنت ولا اتعلّمت ناقصة` });
    if (missing.length && body.missingAck !== true)
      return conflict409(request, { ok: false, result: 'needs_ack', code: 'missing_ack',
        message: 'فيه قطع ناقصة — لازم إقرار صريح' });
  }

  // ① الفعل الأساسي — نفس `scan` بالحرف
  const before = currentWhereabouts(order, v.machine);
  let wrote = null, error = null;
  try { wrote = await writeWhereabouts(env, token, order.orderGid, v.machine); }
  catch (e) { error = e.message; }

  // ② الدفتر — بعد نجاح الكتابة بس
  const warnings = [...(v.warnings || [])];
  let ledger = null;
  const missingUnits = units.filter(u => missing.includes(u.key));
  if (!error && units.length) {
    try {
      const now = new Date().toISOString();
      const stmt = env.DB.prepare(`
        INSERT OR IGNORE INTO ${LEDGER_TABLE}
          (source, cycle_key, order_id, order_name, machine, line_item_id, variant_id, sku, barcode, title,
           unit_index, status, created_at, created_by, received_at, received_by, receive_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      const res = await env.DB.batch(units.map(u => {
        const isMissing = missing.includes(u.key);
        return stmt.bind(LEDGER_SRC_ORDER, cycleKey, String(order.orderId), order.orderName,
          machineLabel(v.machine), u.lineItemId, u.variantId, u.sku, u.barcode, u.title, u.unitIndex,
          isMissing ? 'missing' : 'received', now, employee,
          isMissing ? null : now, isMissing ? null : employee, isMissing ? null : scannedMap.get(u.key));
      }));
      ledger = { units: units.length, inserted: res.reduce((s, r) => s + (r?.meta?.changes || 0), 0),
                 missing: missingUnits.length };
    } catch (e) {
      ledger = { error: ledgerMissingMsg(e) };
      warnings.push(`عهدة الطرد اتسجّلت «في المخزن»، لكن القطع ما اتسجّلتش في دفتر الرجوع (${ledger.error})`);
    }
  }
  if (!error && missingUnits.length)
    warnings.push(`${missingUnits.length} قطعة ناقصة: ${missingUnits.map(u => u.sku || u.title).join('، ')} — اتسجّلت «ناقصة» ومستنية مراجعة`);
  if (!error && !units.length)
    warnings.push('قطع الطرد ما اتحددتش من شوبيفاي — الاستلام اتأكد يدويًا من غير سكان القطع');

  const result = error ? 'error' : (warnings.length ? 'warning' : 'success');
  const logged = await safeLog(env, {
    tool: TOOL_NAME, type: 'update', employee,
    orderId: order.orderId, orderName: order.orderName,
    valueBefore: before, valueAfter: error ? null : WA_TARGET,
    notes: error || warnings.join(' · ') || null,
    extra: {
      sourceTool: SOURCE_TOOL, result, stage: 'write', machine: machineLabel(v.machine),
      zone: order.zone, courier: order.courier, s1: order.s1, s2: order.s2,
      cancelledAt: order.cancelledAt || undefined,
      packedAt: packedAtOf(order),
      packedBy: packedByOf(order),
      acknowledged: ack || undefined,
      warnings: warnings.length ? warnings : undefined,
      itemByItem: true, itemsSource, cycleKey: cycleKey || undefined,
      units: units.length, unitsMissing: missingUnits.length || undefined,
      // 1.9.0: تفاصيل المنتجات في السجل — SKU وعدد القطع (وعدد الناقص) لكل صنف. الواجهة بتعرضها في تاب «سجل العمليات».
      items: unitsSummary(units, missing),
      ledger: ledger || undefined,
      cairoDate: cairoDate(),
    },
  });

  return json({ ok: !error, result, code: error ? 'write_failed' : 'written', message: error || null,
    order, machine: v.machine, warnings, valueBefore: before, valueAfter: wrote,
    units: units.length, missing: missingUnits.length, ledger, ...logged }, 200, request);
}

// 1.9.0 — تجميع قطع الاستلام حسب الـ SKU للسجل: [{ sku, qty, missing? }]
function unitsSummary(units, missing) {
  const m = new Map();
  for (const u of units) {
    const k = u.sku || u.title || '—';
    const e = m.get(k) || { sku: k, qty: 0, missing: 0 };
    e.qty++;
    if (missing.includes(u.key)) e.missing++;
    m.set(k, e);
  }
  return [...m.values()].map(e => e.missing ? e : { sku: e.sku, qty: e.qty });
}

// ─── §RECEIVE::handleReturnItems — القطع المستنية + الناقصة ───
// القايمة بتاعة تبويب «قطع التسليم الجزئي» وصف الشاشة الرئيسية.
async function handleReturnItems(env, request) {
  try {
    const rows = await env.DB.prepare(`
      SELECT id, source, order_id, order_name, machine, line_item_id, sku, barcode, title,
             unit_index, status, created_at, created_by
      FROM ${LEDGER_TABLE}
      WHERE status IN ('pending', 'missing')
      ORDER BY created_at ASC, id ASC
      LIMIT ?`).bind(LEDGER_LIST_MAX + 1).all();
    const list = (rows.results || []);
    const truncated = list.length > LEDGER_LIST_MAX;
    const items = list.slice(0, LEDGER_LIST_MAX).map(r => ({
      id: r.id, source: r.source, orderId: r.order_id, orderName: r.order_name, machine: r.machine,
      lineItemId: r.line_item_id, sku: r.sku, barcode: r.barcode, title: r.title,
      unitIndex: r.unit_index, status: r.status, createdAt: r.created_at, createdBy: r.created_by,
    }));
    const counts = { pending: 0, missing: 0 };
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
    return json({ ok: true, items, counts, truncated, fetchedAt: new Date().toISOString() }, 200, request);
  } catch (e) {
    return json({ ok: false, error: ledgerMissingMsg(e) }, 500, request);
  }
}

// ─── §RECEIVE::handleReceiveItem — سكان قطعة سايبة (أو استلام يدوي بالـ id) ───
// 🔴 **بالباركود: الأقدم أولاً** (قرار أحمد 22-10-2026) — `pending` قبل `missing`،
//    وبعدها الأقدم تسجيلاً. والـ UPDATE مشروط بالحالة (`status IN (…)`) فقطعة
//    اتقفلت من جهاز تاني في نفس اللحظة مابتتقفلش مرتين.
async function handleReceiveItem(env, request) {
  const body = await request.json().catch(() => ({}));
  const employee = body.employee ? String(body.employee) : null;
  const barcode  = String(body.barcode || '').replace(/\D/g, '');
  const id       = Number.isInteger(body.id) ? body.id : null;
  if (!barcode && !id) return json({ ok: false, error: 'مفيش باركود ولا id في الطلب' }, 400, request);

  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = id
        ? await env.DB.prepare(`SELECT * FROM ${LEDGER_TABLE} WHERE id = ?`).bind(id).first()
        : await env.DB.prepare(`
            SELECT * FROM ${LEDGER_TABLE}
            WHERE barcode = ? AND status IN ('pending', 'missing')
            ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END, created_at ASC, id ASC
            LIMIT 1`).bind(barcode).first();

      if (!row || (id && row.status === 'received')) {
        if (id && row) return json({ ok: true, result: 'already', message: 'القطعة دي اتسلّمت خلاص',
          item: { id: row.id, orderName: row.order_name, sku: row.sku } }, 200, request);
        if (id) return json({ ok: false, result: 'not_found', message: 'السطر ده مش موجود' }, 404, request);
        const done = await env.DB.prepare(`
          SELECT order_name, sku, received_at, received_by FROM ${LEDGER_TABLE}
          WHERE barcode = ? AND status = 'received' ORDER BY received_at DESC LIMIT 1`).bind(barcode).first();
        return json({ ok: true, result: done ? 'already' : 'not_found', barcode,
          message: done
            ? `مفيش قطعة مستنية بالباركود ده — آخر قطعة بيه اتسلّمت خلاص (${done.order_name || '—'})`
            : 'مفيش قطعة مستنية الاستلام بالباركود ده — لو ده طرد أوردر كامل، اسكن باركود الأوردر' }, 200, request);
      }

      const now = new Date().toISOString();
      const up = await env.DB.prepare(`
        UPDATE ${LEDGER_TABLE}
        SET status = 'received', received_at = ?, received_by = ?, receive_mode = ?
        WHERE id = ? AND status IN ('pending', 'missing')`)
        .bind(now, employee, id ? 'manual' : 'scan', row.id).run();
      if ((up?.meta?.changes || 0) === 1) {
        return json({ ok: true, result: 'success', barcode: barcode || row.barcode,
          item: { id: row.id, source: row.source, orderId: row.order_id, orderName: row.order_name,
                  sku: row.sku, title: row.title, unitIndex: row.unit_index, wasStatus: row.status,
                  receivedAt: now, receivedBy: employee } }, 200, request);
      }
      // جهاز تاني قفل نفس السطر — جرّب السطر اللي بعده
    }
    return json({ ok: false, error: 'تعارض مع جهاز تاني — اسكن القطعة تاني' }, 409, request);
  } catch (e) {
    return json({ ok: false, error: ledgerMissingMsg(e) }, 500, request);
  }
}

// ══════════════════════════════════════════════════════════════
// §DIAG
// ══════════════════════════════════════════════════════════════
// الشكل المعتمد للجديد: **مصفوفة** `[{ ok, label, detail }]` — `ok` صريحة.
// ⛔ ممنوع يرجّع قيمة أي سر — الأسماء والأطوال بس.
const DEF_QUERY = `
query Defs {
  currentAppInstallation { accessScopes { handle } }
  metafieldDefinitions(ownerType: ORDER, namespace: "custom", first: 100) {
    nodes { key type { name } validations { name value } }
  }
}`;

async function handleDiag(env, request) {
  const checks = [];
  const push = (ok, label, detail, hint) => checks.push({ ok, label, detail, hint });

  // ① المتغيرات — أسماء وأطوال بس
  const names = ['SHOP_DOMAIN', 'CLIENT_ID', 'CLIENT_SECRET', 'WORKER_SECRET'];
  const envDetail = names.map(k => {
    const v = env[k];
    return `${k}=${v === undefined || v === null || String(v).trim() === '' ? '❌ ناقص' : String(v).length + ' حرف'}`;
  }).join(' · ');
  const envOk = names.every(k => env[k] !== undefined && String(env[k] ?? '').trim() !== '');
  push(envOk, 'متغيرات وأسرار الـ Worker', envDetail,
       'Dashboard → Settings → Variables، وبعدها **Promote** للنسخة — من غير Promote القيمة بتفضل undefined');

  // ② D1
  try {
    // ⚠️ العدّ بـ`sourceTool` كمان — من غيره الرقم بيشمل صفوف سكانرَي بوسطة
    //    وأداة المكتب، وبيقول «فيه صفوف» على أداة لسه ما كتبتش ولا صف.
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM logs WHERE tool = ? AND json_extract(extra, '$.sourceTool') = ?`
    ).bind(TOOL_NAME, SOURCE_TOOL).first();
    push(true, 'D1 (DB)', `متصلة — ${row?.n ?? 0} صف للأداة دي (من سجل ${TOOL_NAME} المشترك)`);
  } catch (e) {
    push(false, 'D1 (DB)', `FAILED: ${e.message}`,
         'binding اسمه `DB` في `wrangler.toml` — أي اسم تاني = كتابة فاشلة بصمت');
  }

  // ②-ب دفتر القطع الراجعة (v1.5.0)
  try {
    const r = await env.DB.prepare(
      `SELECT SUM(status = 'pending') AS p, SUM(status = 'missing') AS m, COUNT(*) AS n FROM ${LEDGER_TABLE}`
    ).first();
    push(true, `دفتر القطع الراجعة (${LEDGER_TABLE})`,
         `موجود — ${r?.p ?? 0} مستنية · ${r?.m ?? 0} ناقصة · ${r?.n ?? 0} سطر إجمالي`);
  } catch (e) {
    push(false, `دفتر القطع الراجعة (${LEDGER_TABLE})`, `FAILED: ${ledgerMissingMsg(e)}`,
         `شغّل schema/${LEDGER_TABLE}.sql مرة واحدة من D1 Console (ecommoda-dev-logs)`);
  }

  // ③ شوبيفاي + الصلاحيات + **تعريف الميتافيلد الحيّ**
  try {
    assertEnv(env, 'shopify');
    const token = await getAccessToken(env);
    const data  = await shopifyGQL(env, token, DEF_QUERY, {}, 'diag');
    push(true, 'OAuth شوبيفاي', 'التوكن اتجاب بنجاح');

    const scopes = (data.data?.currentAppInstallation?.accessScopes || []).map(s => s.handle);
    push(scopes.includes('write_orders'), 'صلاحية write_orders',
         scopes.includes('write_orders') ? 'موجودة' : 'ناقصة — الكتابة على الميتافيلد هتفشل',
         'Custom App → Configuration → Admin API access scopes');

    // ⚠️ **بند موروث من الأداتين الشقيقتين** — الأداة دي بتقرا أوردرات
    //    مرتجعة وملغية، وهي **أقدم** من الأوردرات الجاهزة للشحن بطبيعتها.
    //    شوبيفاي بتخفي أي أوردر أقدم من ٦٠ يوم عن تطبيق مالوش
    //    `read_all_orders`، والرسالة اللي بتطلع وقتها «الأوردر مش موجود» —
    //    وهي **كاذبة تمامًا**.
    // 🔴 v1.5.0 — قطع مرتجع S2 بتتقرا من `returns` (محتاجة read_returns).
    //    من غيرها `order_items` بيرمي على كل مرتجع S2 والطرد مايتسلّمش.
    push(scopes.includes('read_returns'), 'صلاحية read_returns',
         scopes.includes('read_returns') ? 'موجودة — قطع مرتجعات S2 مقروءة'
           : 'ناقصة — قطع مرتجعات S2 (returnLineItems) مش هتتقرا والاستلام هيفشل',
         'Custom App → Configuration → Admin API access scopes → read_returns');

    push(scopes.includes('read_all_orders'), 'صلاحية read_all_orders',
         scopes.includes('read_all_orders')
           ? 'موجودة — الأوردرات الأقدم من ٦٠ يوم مقروءة'
           : 'ناقصة — أي أوردر أقدم من ٦٠ يوم هيقول «مش موجود على شوبيفاي» وهي رسالة كاذبة',
         'Custom App → Configuration → Admin API access scopes → read_all_orders');

    // 🔴 الفحص ده هو اللي بيمسك «التعريف اتغيّر من الأدمن» في ٥ ثواني بدل ما
    //    يطلع كفشل كتابة غامض على أول سكانة من الموظف.
    const defs = data.data?.metafieldDefinitions?.nodes || [];
    for (const m of ['s1', 's2']) {
      const key = WA_KEY[m];
      const d   = defs.find(x => x.key === key);
      if (!d) { push(false, `تعريف ${key}`, 'مش موجود على شوبيفاي',
                     'Settings → Custom data → Orders — لازم Choice list بقيم Warehouse · Office · Courier'); continue; }
      const typeOk = d.type?.name === WA_TYPE;
      const choices = (() => {
        try { return JSON.parse(d.validations?.find(v => v.name === 'choices')?.value || '[]'); }
        catch { return []; }
      })();
      const choiceOk = choices.includes(WA_TARGET);
      push(typeOk && choiceOk, `تعريف ${key}`,
           `type=${d.type?.name} · choices=[${choices.join(', ')}]`,
           !typeOk ? `النوع لازم يبقى ${WA_TYPE} بالحرف — غير كده metafieldsSet بترفض الكتابة كلها`
                   : `قيمة «${WA_TARGET}» مش في قايمة الاختيار`);
    }
  } catch (e) {
    push(false, 'شوبيفاي', `FAILED: ${e.message}`);
  }

  // ④ تكلفة الاستعلام — الاقتراب من السقف مابيبانش غير بانفجار دفعة كاملة
  // ⚠️ القيمتان دول من **آخر نداء GraphQL حصل في الـ isolate ده** — ممكن
  //    يكونوا من `diag` نفسه (لو نادى شوبيفاي) أو من نداء سابق. مش لقطة
  //    لحظية دقيقة، بس بتدّي إحساس عام بالوضع.
  push(true, 'رصيد تكلفة الاستعلام (throttleStatus)', _lastThrottle
    ? `currentlyAvailable=${_lastThrottle.currentlyAvailable} / ${_lastThrottle.maximumAvailable} · restoreRate=${_lastThrottle.restoreRate}/s`
    : 'لسه مفيش استعلام في الاستدعاء ده');
  // 🟡 تجريبي (v1.3.0) — `actualQueryCost` تكلفة آخر نداء فعليًا، مش الرصيد
  //    المتبقي. للقياس بتاع docs/query-cost-experiment.md بريبو الهب.
  push(true, 'تكلفة آخر نداء (actualQueryCost)', _lastQueryCost
    ? `${_lastQueryCost.op}: requested=${_lastQueryCost.requested} · actual=${_lastQueryCost.actual}`
    : 'لسه مفيش استعلام في الاستدعاء ده');

  // ⑤ أرضية تاريخ الأوردر — معلومة، مش نجاح ولا فشل
  push(true, 'أرضية تاريخ الأوردر', `نافذة متحرّكة ${ROLLING_WINDOW_DAYS} يوم — الطابور بيعرض `
    + `أوردرات من ${computeOrdersSince()} فأحدث · `
    + `سقف تمريرة ١: ${STEP1_PAGE_SIZE * STEP1_MAX_PAGES} أوردر لكل استعلام (حقول خفيفة) · `
    + `سقف تمريرة ٢: ${STEP2_MAX_IDS} مرشّح (حقول كاملة)`,
    'الأرضية عرض بس — الأوردر الأقدم منها بيتسكن عادي والـ Worker بيكتب عليه. '
    + 'شبكة الأمان المطلوبة مع النافذة المتحرّكة (تقرير دوري) بند مفتوح — راجع CLAUDE.md');

  // ⑥ الأصل
  const origin = request.headers.get('Origin') || '(بلا Origin)';
  push(ALLOWED_ORIGINS.includes(origin), 'الـ Origin', `${origin} · المسموح: ${ALLOWED_ORIGINS.join(', ')}`);

  return json({ ok: checks.every(c => c.ok), version: WORKER_VERSION,
                tool: TOOL_NAME, sourceTool: SOURCE_TOOL, checks }, 200, request);
}

// ══════════════════════════════════════════════════════════════
// §HANDLER
// ══════════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers: getCORS(request) });

    // 🔴 حارس السر الغايب **قبل** فحص الـ auth — من غيره القالب بينتج السلسلة
    //    الحرفية "Bearer undefined"، يعني أي طلب معاه الهيدر ده **بيعدّي**،
    //    والحالة اللي المفروض تبقى «كل حاجة 401» بتتحوّل لـ«الحماية اتشالت».
    if (typeof env.WORKER_SECRET !== 'string' || !env.WORKER_SECRET.trim())
      return json({ ok: false, error: 'WORKER_SECRET غير مضبوط على الـ Worker', step: 'env' }, 500, request);

    const auth = request.headers.get('Authorization');
    if (!auth || auth !== `Bearer ${env.WORKER_SECRET}`)
      return json({ error: 'Unauthorized' }, 401, request);

    const url    = new URL(request.url);
    const action = url.searchParams.get('action') || '';

    try {
      // ─── §CONFIG ──────────────────────────────────────────────
      if (action === 'get_config')
        return json({ ok: true, version: WORKER_VERSION, WORKER_VERSION,
                      tool: TOOL_NAME, sourceTool: SOURCE_TOOL }, 200, request);

      if (action === 'diag') return await handleDiag(env, request);

      // ─── §AUTH ────────────────────────────────────────────────
      // 🔴 **انحراف مقصود:** مفيش `check_employee`/`register_pin`/
      //    `verify_employee`/`log_logout` هنا. الأداة **مالهاش واجهة مستقلة**،
      //    والدخول بيحصل **مرة واحدة** في `index.html` بتاع الهب عبر Worker
      //    التغليف، والهوية بتوصل من `sessionStorage`. نقطة دخول تانية هنا =
      //    سطح هجوم بلا مستهلك (نفس قرار أداة المكتب).
      //    ⚠️ و`get_employees` **موجود** لأنه مستهلَك فعلاً — فلتر الموظف في
      //       تاب السجل. من غيره الفلتر بيفضل فاضي **بلا أي خطأ**.
      if (action === 'get_employees') {
        const rows = await env.DB.prepare(
          'SELECT username, display_name FROM employees WHERE is_active = 1 ORDER BY display_name'
        ).all();
        return json({ ok: true, employees: rows.results || [] }, 200, request);
      }

      // ─── §QUEUE ───────────────────────────────────────────────
      if (action === 'get_ready_to_warehouse') return await handleReadyQueue(env, request);
      if (action === 'get_ready_edited')       return await handleEditedQueue(env, request);   // v1.10.0 — مشترك لتابَي المعدّلة وتحويل بوسطة

      // ─── §SCAN ────────────────────────────────────────────────
      if (action === 'scan') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return await handleScan(env, request);
      }

      // ─── §RECEIVE (v1.5.0) — الاستلام قطعة قطعة + دفتر القطع الراجعة ───
      if (action === 'get_return_items') return await handleReturnItems(env, request);
      if (action === 'order_items' || action === 'receive_order' || action === 'receive_item') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        if (action === 'order_items')   return await handleOrderItems(env, request);
        if (action === 'receive_order') return await handleReceiveOrder(env, request);
        return await handleReceiveItem(env, request);
      }

      // ─── §LOG-ENDPOINTS ───────────────────────────────────────
      if (action === 'get_logs') {
        const p = logParamsFrom(url, TOOL_NAME, SOURCE_TOOL);
        // 🔴 parseInt('abc') → NaN → بيوصل لـ D1 كـ bind ويرجّع خطأ غامض.
        const limitRaw  = parseInt(url.searchParams.get('limit')  || '100', 10);
        const offsetRaw = parseInt(url.searchParams.get('offset') || '0',   10);
        const limit  = Number.isFinite(limitRaw)  ? Math.min(Math.max(limitRaw, 1), 100) : 100;
        const offset = Number.isFinite(offsetRaw) ? Math.max(offsetRaw, 0) : 0;
        const entries = await getLogs(env.DB, {
          ...p, limit, offset,
          sortBy:  url.searchParams.get('sortBy'),
          sortDir: url.searchParams.get('sortDir'),
        });
        return json({ ok: true, entries }, 200, request);
      }

      if (action === 'get_logs_count') {
        const total = await getLogsCount(env.DB, logParamsFrom(url, TOOL_NAME, SOURCE_TOOL));
        return json({ ok: true, total }, 200, request);
      }

      if (action === 'get_logs_export') {
        const p = logParamsFrom(url, TOOL_NAME, SOURCE_TOOL);
        const [entries, total] = await Promise.all([
          getLogsExport(env.DB, p),
          getLogsCount(env.DB, p),
        ]);
        return json({ ok: true, entries, cap: LOG_EXPORT_MAX, total,
                      truncated: total > LOG_EXPORT_MAX }, 200, request);
      }

      return json({ error: `Unknown action: ${action}` }, 404, request);
    } catch (e) {
      return json({ ok: false, error: e.message }, 500, request);
    }
  },
};
