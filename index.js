// ══════════════════════════════════════════════════════════════
// §HEADER
// Worker: package-transfer-to-warehouse-worker — EcomModa
// Tool:   قسم استلام المرتجعات (Package Transfer To Warehouse)
//
// skills: worker-builder v3.3.0 · constants v2.6.0 · order-lifecycle v1.8.0
//         · shopify-graphql-helper v1.1.0 · html-builder v6.6.0 — 19-09-2026
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
const WORKER_VERSION = '1.1.0';

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
// ① الواجهة    CHUNK           = —    ← مفيش دفعة: السكان **فوري**، أوردر لكل نداء
// ② الـ Worker  MAX_BATCH       = —    ← مفيش endpoint بياخد مصفوفة
// ③ شوبيفاي     QUEUE_PAGE_SIZE = 50   ← نفس رقم أداة المكتب بالحرف: الاستعلام
//                                         بـ١١ ميتافيلد لكل نود. ⛔ متطلّعهاش
//                                         لـ100 من غير ما تقرا actualQueryCost.
const QUEUE_PAGE_SIZE = 50;
const QUEUE_MAX_PAGES = 6;          // حارس حلقة — 300 أوردر لكل استعلام

// 🔴 **أرضية تاريخ الأوردر — قرار أحمد 19-09-2026، ونفس القيمة في أداة
//    المكتب بالحرف.** الطابور بيعرض الأوردرات اللي **اتعملت من 01-04-2026**
//    فأحدث.
//    ⚠️ **والحاجة دي ألزم هنا منها في المكتب:** هناك المصدر
//    `manual_status:'Ready'` وهي حالة **عابرة** فعددها عشرات؛ هنا المصدر
//    `Returned` و`Cancelled`، وهما حالتان **نهائيتان بتتراكم** — كل مرتجع
//    وكل ملغي في تاريخ المتجر كله بيطابق الفلتر. من غير الأرضية الاستعلام
//    بيرجّع آلاف الصفوف، والـ 300 اللي بتعدّي حارس الحلقة بتبقى أحدث حاجة
//    أو أقدم حاجة حسب الترتيب — يعني رقم مالوش أي علاقة بالطرود اللي في إيد
//    الموظف.
// 🔴 **وهي أرضية ثابتة مش نافذة متحرّكة — والقرار ده اترجع فيه صراحةً.**
//    النسخة الأولى كانت `updated_at` بآخر ٣٠ يوم، و**اتشالت بقرار أحمد**:
//    النافذة المتحرّكة بتخفي الطرد الراجع من شهرين **بالظبط لما يبقى منسي
//    فعلاً**، وهو الطرد اللي الأداة دي (شبكة الأمان) اتعملت عشانه.
//    ⛔ ممنوع الرجوع لـ«آخر N يوم».
// ⚠️ **والفلتر على `created_at` مش `updated_at`** — تاريخ **الأوردر** هو
//    اللي الموظف بيقراه في الجدول؛ و`updated_at` بيتحرّك مع أي تعديل (حتى
//    كتابة الميتافيلد بتاعتنا)، فكان بيدّي أرضية بتتزحلق تحت الطرد نفسه.
// ⚠️ **والصيغة `YYYY-MM-DD` بتتقرا UTC عند شوبيفاي** — يوم فرق على أرضية
//    ثابتة مالوش أثر عملي، فمفيش تحويل توقيت هنا عن قصد.
// 🔴 **وهي أرضية عرض — مش شرط أهلية.** الأوردر الأقدم منها **بيتسكن عادي**
//    والـ Worker بيكتب عليه؛ هو مش في القايمة وبس. ⛔ ممنوع تتحط في
//    `evaluate`.
const ORDERS_SINCE = '2026-04-01';
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

// ══════════════════════════════════════════════════════════════
// §SHARED — copy verbatim from references/shared-functions.md — never modify
// ══════════════════════════════════════════════════════════════

async function writeLog(db, entry) {
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
    entry.extra ? JSON.stringify(entry.extra) : null
  ).run();
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
async function getAccessToken(env) {
  const resp = await fetch(
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
  if (!resp.ok) throw new Error(`OAuth failed: ${resp.status}`);
  const data = await resp.json();
  if (!data.access_token) throw new Error('No access_token in response');
  return data.access_token;
}

// ─── §SHOPIFY::shopifyGQL — العقد الإلزامي، منسوخة كما هي ───
// أي فشل بيترمي: ① شبكة ② HTTP status ③ رد مش JSON ④ data.errors ⑤ data فاضية.
// ⚠️ ④ هو الخطير: ميوتيشن بتترفض على مستوى الحقل بترجّع {"errors":[…],"data":null}
//    و`userErrors` بتبقى `[]` — كود بيفحص `userErrors` بس بيقرا ده **نجاح**.
let _lastThrottle = null;   // بيتعرض في diag — الاقتراب من السقف مابيبانش غير بانفجار دفعة
async function shopifyGQL(env, token, query, variables = {}, opName = 'shopify') {
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
    if (data.extensions?.cost?.throttleStatus) _lastThrottle = data.extensions.cost.throttleStatus;
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
// 🔴 **الـ Worker بيستعلم عن الحالة بس — الفلترة في الواجهة** (نفس قرار أداة
//    المكتب بالحرف). السبب حقيقي ومقيس: `custom.package_whereabouts_s1` **مش
//    قابل للفلترة** في بحث شوبيفاي، والفلتر عليه **بيتجاهَل في صمت** ويرجّع
//    **المتجر كله** (١٠٬٠٠٠ صف — مقيس 15-09-2026). يعني فلترة الأهلية على
//    مستوى الاستعلام مستحيلة أصلاً.
//
// ⚠️ **وعشان كده الرد بيرجّع الحقول الخام لكل أوردر** (زون · مندوب · حالتين ·
//    وقتَي تغليف · عهدتَي الطرد · الإلغاء)، والواجهة بتحكم بيهم من **مصدر
//    واحد** — `wocWarehouseGate` في `shared/shell.js` §WAREHOUSE-GATE. الصفحة
//    والشاشة الرئيسية بينادوا **نفس الدالة** على **نفس الرد**، فمستحيل
//    الرقمين يفترقوا (درس R1 — v1.11.0: الرئيسية قالت ٦٦ والصفحة فتحت على ٦).
//
// 🔴 **بس الحارس الحقيقي على الكتابة في `?action=scan` تحت** — حارس في الواجهة
//    بس **مش حارس** (`ecommoda-order-lifecycle` §1.5): تاب مفتوح من ساعة
//    والأوردر اتغيّرت حالته في الوقت ده كان هيعدّي.

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
const ORDER_FIELDS = `
  id
  legacyResourceId
  name
  createdAt
  cancelledAt
  displayFulfillmentStatus
  currentSubtotalLineItemsQuantity
  currentTotalPriceSet { shopMoney { amount } }
  shippingAddress { name }
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

const QUEUE_QUERY = `
query ReturnedOrders($q: String!, $after: String, $n: Int!) {
  orders(first: $n, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
    nodes { ${ORDER_FIELDS} }
    pageInfo { hasNextPage endCursor }
  }
}`;

// ─── §QUEUE::shapeOrder — شكل واحد للطابور وللسكان ───
// ⚠️ الشكل ده **عقد مع الواجهة**: `wocWarehouseGate` في الـ shell بتقرا
//    المفاتيح دي بالاسم. تغيير اسم مفتاح هنا = الطابور يرجع فاضي **بلا أي
//    خطأ**.
function shapeOrder(o) {
  return {
    orderId:   o.legacyResourceId || (o.id ? String(o.id).split('/').pop() : null),
    orderGid:  o.id,
    orderName: o.name,
    createdAt: o.createdAt,
    cancelledAt: o.cancelledAt || null,
    fulfillment: o.displayFulfillmentStatus || null,
    customer:  o.shippingAddress?.name || null,
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

async function fetchQueuePage(env, token, q) {
  const out = [];
  let after = null, pages = 0, truncated = false;
  while (pages < QUEUE_MAX_PAGES) {
    const data = await shopifyGQL(env, token, QUEUE_QUERY,
      { q, after, n: QUEUE_PAGE_SIZE }, 'returnedOrders');
    const conn = data.data?.orders;
    if (!conn) throw new Error('returnedOrders: رد شوبيفاي بلا `orders`');
    out.push(...(conn.nodes || []));
    pages++;
    if (!conn.pageInfo?.hasNextPage) { after = null; break; }
    after = conn.pageInfo.endCursor;
    if (pages >= QUEUE_MAX_PAGES) truncated = true;
  }
  return { nodes: out, truncated };
}

// ─── §QUEUE::handleReadyQueue ───
// بيجيب **تلات استعلامات**: `manual_status = Returned` · `manual_status =
// Cancelled` · `status_2_r_e = Returned`. أوردر ممكن يكون في أكتر من واحد —
// بيتدمج بالـ id، والواجهة هي اللي بتقرر الماكينة.
//
// ⚠️ **والتلاتة عليهم أرضية `created_at >= ORDERS_SINCE`** — فوق في
//    §CONSTANTS. أرضية **ثابتة** مش نافذة متحرّكة بقرار.
//
// 🔴 **وفيه حالة مقصودة مش في الاستعلامات دي: الملغي على شوبيفاي نفسها**
//    (`cancelledAt` من غير `manual_status = Cancelled`). فلتر `status:cancelled`
//    كان هيرجّع **كل** ملغيات تاريخ المتجر، فاستُبعد من الطابور بقرار.
//    ⚠️ **والأوردر ده بيتسكن عادي** — `evaluate` تحت بتقبل `cancelledAt`
//       صراحةً. يعني هو **مش في القايمة بس السكانة بتشتغل عليه** — وده
//       بالظبط معنى «القايمة عرض والـ Worker مرجع».
async function handleReadyQueue(env, request) {
  assertEnv(env, 'shopify');
  const token = await getAccessToken(env);

  // ⚠️ الأرضية بتتحط على **التلات استعلامات** — واحد من غيرها معناه إن حالة
  //    بتعرض أقدم من التانيتين، والجدول بيخلط النطاقين بلا أي إشارة.
  const floor = ` AND created_at:>=${ORDERS_SINCE}`;

  const parts = await Promise.all([
    fetchQueuePage(env, token, `metafields.custom.manual_status:'${S1_STATUS.RETURNED}'${floor}`),
    fetchQueuePage(env, token, `metafields.custom.manual_status:'${S1_STATUS.CANCELLED}'${floor}`),
    fetchQueuePage(env, token, `metafields.custom.status_2_r_e:'${S2_STATUS.RETURNED}'${floor}`),
  ]);

  const byId = new Map();
  for (const p of parts) for (const n of p.nodes) {
    const s = shapeOrder(n);
    if (s.orderId) byId.set(s.orderId, s);
  }

  return json({
    ok: true,
    orders: [...byId.values()],
    truncated: parts.some(p => p.truncated),
    // 🔴 الأرضية بترجع في الرد عشان **الواجهة تعرضها من هنا** — مش مكتوبة
    //    بالإيد هناك. رقمان يفترقوا في صمت هو درس R1 بالحرف.
    ordersSince: ORDERS_SINCE,
    fetchedAt: new Date().toISOString(),
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
function evaluate(o) {
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

  // ③ متغلّف فعلاً — بميتافيلد الماكينة بتاعتها
  // 🔴 صف S2 بيتفحص بـ`s2_packing_date_time` **مش** `s1_…`. الفحص بـ`s1_…`
  //    على صف S2 بيعدّي على طرد **ما اتغلّفش** (مقيس 15-09-2026 على أداة
  //    المكتب: ٦ من ٦ صفوف S2 كانت هتعدّي، والصح ٢).
  // ⚠️ **ومعنى الشرط هنا أقوى من هناك:** أوردر اتلغى قبل ما يتغلّف **مفيهوش
  //    طرد أصلاً** — مفيش حاجة ترجع على الرف، والمنتجات ما خرجتش من مكانها.
  const packedAt = machine === 's1' ? o.packedAtS1 : o.packedAtS2;
  if (!packedAt) {
    return { level: 'blocked', code: 'not_packed', machine,
      message: machine === 's1'
        ? 'الأوردر ده ما اتغلّفش أصلاً — مفيش طرد يرجع، والمنتجات ما خرجتش من مكانها'
        : 'طرد الاستبدال/الاسترجاع ما اتغلّفش — مفيش وقت تغليف (S2) مسجّل' };
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
               code: 'not_found', scanned: code },
    });
    return json({ ok: true, result: 'rejected', code: 'not_found',
      message: reason, scanned: code, ...logged }, 200, request);
  }

  const v = evaluate(order);

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
               machine: machineLabel(v.machine),
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
      result, stage: 'write', machine: machineLabel(v.machine),
      zone: order.zone, courier: order.courier, s1: order.s1, s2: order.s2,
      cancelledAt: order.cancelledAt || undefined,
      packedAt: v.machine === 's1' ? order.packedAtS1 : order.packedAtS2,
      packedBy: v.machine === 's1' ? order.packedByS1 : order.packedByS2,
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
  push(true, 'تكلفة استعلام شوبيفاي', _lastThrottle
    ? `currentlyAvailable=${_lastThrottle.currentlyAvailable} / ${_lastThrottle.maximumAvailable} · restoreRate=${_lastThrottle.restoreRate}/s`
    : 'لسه مفيش استعلام في الاستدعاء ده');

  // ⑤ أرضية تاريخ الأوردر — معلومة، مش نجاح ولا فشل
  push(true, 'أرضية تاريخ الأوردر', `الطابور بيعرض أوردرات من ${ORDERS_SINCE} فأحدث · `
    + `سقف ${QUEUE_PAGE_SIZE * QUEUE_MAX_PAGES} أوردر لكل استعلام`,
    'الأرضية عرض بس — الأوردر الأقدم منها بيتسكن عادي والـ Worker بيكتب عليه');

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

      // ─── §SCAN ────────────────────────────────────────────────
      if (action === 'scan') {
        if (request.method !== 'POST') return json({ error: 'POST required' }, 405, request);
        return await handleScan(env, request);
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
