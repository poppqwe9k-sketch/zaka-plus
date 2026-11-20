# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية بـ React وVite، ينشرها Cloudflare Worker مع أصول Vite من `dist/` ومسار خادمي آمن لـ Gemini على `/api/chat`.

## التعامل مع HTTP 503 من Gemini

عند فشل النموذج الأساسي (المحدد عبر `GEMINI_MODEL`، أو الافتراضي `gemini-2.5-flash`) باستجابة HTTP 503، يعيد Worker المحاولة مرة واحدة بانتظار قصير بتأخير أسي مع jitter. إذا استمر 503، يجرب النموذج الاحتياطي المحدد عبر `GEMINI_FALLBACK_MODEL`؛ الافتراضي `gemini-3.5-flash-lite`. عند نجاح البديل يُعاد الرد مع `fallbackUsed: true`. لا ينتقل إلى بديل عند أخطاء المفتاح أو الصلاحيات أو الطلب (مثل 401/403/400)، لتجنب إخفاء الإعداد الخاطئ.

يمكن تغيير النموذجين كمتغيرات Runtime في Worker:

- `GEMINI_MODEL`: الأساسي.
- `GEMINI_FALLBACK_MODEL`: البديل.
- `GEMINI_API_BASE_URL`: افتراضياً `https://generativelanguage.googleapis.com/v1beta`.
- `GEMINI_API_KEY`: Secret؛ لا تضعه في متغير `VITE_*` أو ملفات المتصفح.

## البناء والنشر

```bash
npm install
npm run build
npx wrangler deploy
```

أمر `npm run build` ينشئ أصول Vite في `dist/`. يقدّم Worker هذه الأصول ويعالج `/api/chat` خادمياً. تأكد أن النشر على Cloudflare Workers يتضمن Worker وملفات `dist/`، وأن الأسرار والمتغيرات موجودة في البيئة المنش��رة.
