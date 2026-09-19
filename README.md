<div dir="rtl" style="text-align: right;">

# قسم استلام المرتجعات — Package Transfer To Warehouse

![worker](https://img.shields.io/badge/worker-v1.1.0-blue)

**Worker بس — مفيش واجهة في الريبو ده.**

الأداة بتسجّل رجوع الطرد **للمخزن**: الموظف بيسكن باركود الأوردر المرتجع أو
الملغي، والـ Worker بيكتب `custom.package_whereabouts_s1` (أو `_s2` لدورة
الاستبدال/الاسترجاع) بقيمة **`Warehouse`**.

🔗 **الواجهة:** https://ecommoda-dev.github.io/Warehouse-Operations-Center/warehouse-return.html
(صفحة `warehouse-return.html` جوّه ريبو `Warehouse-Operations-Center`)

> ⛔ **ممنوع يتضاف `index.html` هنا.** الأداة **مالهاش نسخة مستقلة بقرار** —
> الدخول بيحصل مرة واحدة في الهب، والسر سر مجموعة `warehouse_ops`.

## علاقتها بـ `Package-Transfer-To-Office`

الأداتان على **نفس الحقل** وبالاتجاهين:

| | تسليمات المكتب | **استلام المرتجعات (دي)** |
|---|---|---|
| الحالة المؤهلة | `Ready` | **`Returned` · `Cancelled`** |
| الإلغاء | 🔴 **رافض** | 🔴 **شرط أهلية** |
| العهدة قبل | `Warehouse` أو فاضية | **`Office` · `Courier` · فاضية** |
| القيمة المكتوبة | `Office` | **`Warehouse`** |
| «خلاص متعمل» | العهدة `Office` | العهدة **`Warehouse`** |

يعني دي **شبكة الأمان** اللي كانت بند مفتوح في أداة المكتب: قيمة `Office`
من غير طريق رجوع كانت بتعلّق الطرد على المكتب للأبد
(`ecommoda-order-lifecycle` → `known-gaps.md` **G-17**).

## نطاق الأداة

أوردرات **قاهرة+جيزة والشو روم** بس.
🔴 **بوسطة خارج النطاق** — مرتجعاتها ليها أداتها («قسم مرتجعات بوسطة»)،
و`package_whereabouts` مش بيتتبع لطرود بوسطة أصلاً. التفاصيل والتحفّظ الكامل
في `CLAUDE.md` §النطاق.

## Endpoints

```
GET  ?action=get_config              نسخة الـ Worker
GET  ?action=diag                    فحص ذاتي بلا كتابة (بيقرا تعريف الميتافيلد الحيّ)
GET  ?action=get_employees           فلتر الموظف في تاب السجل
GET  ?action=get_ready_to_warehouse  المرتجع/الملغي من 2026-04-01 فأحدث بحقوله الخام
POST ?action=scan                    قراءة حيّة + حكم + metafieldsSet + صف D1
GET  ?action=get_logs[_count|_export]
```

## النشر

منشور من git عبر **Workers Builds** على `main`.
الأسرار من الداشبورد ثم **Promote**: `WORKER_SECRET` (= سر مجموعة
`warehouse_ops`) · `CLIENT_ID` · `CLIENT_SECRET`.

التفاصيل والقرارات والفخاخ → **`CLAUDE.md`**

</div>
