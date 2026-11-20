# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية باستخدام React وVite كتطبيق ويب ثابت (SPA)، مع Cloudflare Pages Function وسيطة للاتصال بـ Google Gemini.

## التشغيل والبناء

```bash
npm install
npm run dev
npm run build
npm run preview
```

أمر البناء ينشئ أصول الموقع الثابت داخل `dist/` ولا يشغّل Wrangler أو أي خطوة نشر.

## إعداد Gemini على Cloudflare Pages

1. أنشئ مفتاحاً من Google AI Studio.
2. في إعدادات مشروع Cloudflare Pages، أضف `GEMINI_API_KEY` كـ **Secret** (وليس كمتغير `VITE_*` ولا في ملفات Git).
3. أضف اختيارياً `GEMINI_MODEL` كمتغير نصي؛ القيمة الافتراضية `gemini-2.5-flash` ويمكن تغييرها إلى نموذج متاح لحسابك.
4. أضف اختيارياً `GEMINI_API_BASE_URL`؛ الافتراضي `https://generativelanguage.googleapis.com/v1beta`.
5. أعد النشر بعد ضبط المتغيرات. Pages Functions تُنشر مع الموقع وتوفّر المسار `/api/chat`.

لا تضع مفتاح API ضمن `VITE_GEMINI_API_KEY`: أي متغير `VITE_*` يُضمّن في ملفات المتصفح ويصبح مرئياً لزوار الموقع. المفتاح يُقرأ داخل الدالة الخادمية فقط.

للتطوير المحلي عبر Cloudflare Pages، انسخ `.dev.vars.example` إلى `.dev.vars` وضع المفتاح في الملف المحلي غير المرفوع إلى Git. استخدم `wrangler pages dev dist` لتجربة Function محلياً بعد بناء التطبيق.

## إعداد Cloudflare Pages

- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`

