# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية بـ React وVite. ينشرها Cloudflare Worker مع أصول Vite من `dist/` ومسار خادمي آمن لـ Gemini على `/api/chat`.

## إعداد النموذج

Worker يقرأ `GEMINI_MODEL` كـ Cloudflare runtime variable (مع حذف المسافات، ودعم الاسم `models/<id>`، والرجوع إلى `gemini-2.5-flash` إذا لم يُضبط). عنوان REST الافتراضي هو `https://generativelanguage.googleapis.com/v1beta`، ويمكن تغييره إلى `v1` عبر `GEMINI_API_BASE_URL`.

لإعداد `gemini-2.0-flash` في Cloudflare، تأكد أن Worker variable اسمه تماماً `GEMINI_MODEL` وقيمته `gemini-2.0-flash` في البيئة المنشورة، ثم أعد نشر Worker. المتصفح لا يرسل النموذج ولا يملك وصولاً إلى المفتاح؛ يرسِل سجل المحادثة فقط إلى `/api/chat`.

في حال رفض Gemini الطلب، يعرض Worker الآن HTTP status ورقم/وصف الحالة والنموذج وإصدار API، إضافة إلى رسالة `error.message` الواردة من Gemini بعد تنقيح المفتاح. أمثلة: invalid API key (401)، صلاحيات/قيود API key (403)، model not found (404)، الحصة (429).

## الأمان والنشر

- لا تستخدم `VITE_GEMINI_API_KEY`؛ فهذا سيكشف المفتاح في ملفات المتصفح.
- خزّن `GEMINI_API_KEY` كـ Worker Secret في Cloudflare.
- عيّن `GEMINI_MODEL` و`GEMINI_API_BASE_URL` كـ runtime variables للـ Worker، لا كمتغيرات Vite.
- انشر Worker وأصول `dist/` عبر Workers Builds؛ أمر البناء `npm run build` وأمر النشر `npx wrangler deploy`.
