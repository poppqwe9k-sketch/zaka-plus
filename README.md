# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية بـ React وVite. ينشرها Cloudflare Worker مع خدمة الملفات الثابتة من `dist/` ومسار خادمي آمن لـ Gemini على `/api/chat`.

## البناء والنشر

```bash
npm install
npm run build
```

ينشئ Vite الملفات الثابتة داخل `dist/`. للنشر من بيئة محلية مصادق عليها مع Cloudflare، استخدم `npm run deploy`؛ ينفّذ البناء أولاً ثم `wrangler deploy`. لا يوضع مفتاح Gemini في bundle المتصفح.

## إعداد Cloudflare

- اربط المستودع بمشروع **Cloudflare Workers Builds** (وليس نشر أصول ثابتة فقط).
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- Root directory: `/`
- أضف `GEMINI_API_KEY` كـ Worker Secret في إعدادات بيئة الإنتاج. لا تستخدم `VITE_GEMINI_API_KEY`.
- يمكن تعيين `GEMINI_MODEL` كمتغير عادي؛ القيمة الافتراضية `gemini-2.5-flash`.
- يمكن تعيين `GEMINI_API_BASE_URL` اختيارياً؛ الافتراضي `https://generativelanguage.googleapis.com/v1beta`.

`wrangler.jsonc` يربط `dist/` كأصول ثابتة، ويضبط fallback لتطبيق SPA. Worker يعالج `/api/chat` قبل تمرير بقية الطلبات إلى binding الأصول `ASSETS`. ملف `public/_redirects` لا يحتوي على قواعد تحويل فعلية، لتجنب تعارض أو حلقات إعادة التوجيه.

## تطوير محلي

انسخ `.dev.vars.example` إلى `.dev.vars`، وضع مفتاحك الحقيقي محلياً، ثم:

```bash
npm run build
npx wrangler dev
```

لا ترفع `.dev.vars` أو أي مفتاح حقيقي إلى GitHub.
