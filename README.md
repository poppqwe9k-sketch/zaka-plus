# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية بـ React وVite. ينشرها Cloudflare Worker مع أصول Vite من `dist/` ومسار خادمي آمن لـ Gemini على `/api/chat`.

## تشخيص HTTP 500 وإعادة المحاولة

مسار `/api/chat` يقرأ `GEMINI_API_KEY` من Worker Secret، ويستخدم `GEMINI_MODEL` أو النموذج الافتراضي `gemini-3.8-flash`. عند HTTP 503 من النموذج الأساسي، يجري محاولة ثانية قصيرة ثم ينتقل إلى `GEMINI_FALLBACK_MODEL` (الافتراضي `gemini-3.5-flash-lite`). تعاد أخطاء Gemini برسالة واضحة، وأي استثناء غير متوقع في المعالج يتحول إلى JSON برسالة عربية وHTTP 502 بدلاً من خطأ Worker مبهم 500.

## إعداد Cloudflare

- خزّن `GEMINI_API_KEY` كـ Worker Secret.
- اضبط اختيارياً `GEMINI_MODEL` و`GEMINI_FALLBACK_MODEL` و`GEMINI_API_BASE_URL` كـ runtime variables.
- لا تستخدم متغيرات `VITE_*` للمفتاح لأنها تكشفه في ملفات المتصفح.

## البناء والنشر

```bash
npm install
npm run build
npx wrangler deploy
```

ينشئ Vite الأصول في `dist/` ويقدمها Worker، بينما يعالج Worker طلبات `/api/chat` من جانب الخادم.
