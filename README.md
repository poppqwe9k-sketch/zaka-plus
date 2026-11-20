# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية بـ React وVite. ينشرها Cloudflare Worker مع خدمة الملفات الثابتة من `dist/` ومسار خادمي آمن لـ Gemini على `/api/chat`.

## البناء والنشر

```bash
npm install
npm run build
```

ينشئ Vite الملفات الثابتة داخل `dist/`. للنشر استخدم إعداد Workers Builds: `npm run build` كأمر بناء و`npx wrangler deploy` كأمر نشر. لا يوضع مفتاح Gemini في bundle المتصفح.

## إعداد Cloudflare

- Root directory: `/`
- Build command: `npm run build`
- Deploy command: `npx wrangler deploy`
- أضف `GEMINI_API_KEY` كـ Worker Secret في إعدادات بيئة الإنتاج ثم أعد النشر.
- النموذج الافتراضي هو `gemini-2.5-flash`؛ يمكن تغييره عبر المتغير النصي `GEMINI_MODEL`.
- يمكن تغيير عنوان API عبر `GEMINI_API_BASE_URL`؛ الافتراضي `https://generativelanguage.googleapis.com/v1beta`.

Worker يقرأ المفتاح من `env.GEMINI_API_KEY` ويرسله إلى Google عبر ترويسة `x-goog-api-key`، لا ضمن عنوان URL أو ملفات المتصفح. يعرض `/api/chat` رسائل عربية أوضح لحالات المفتاح غير الصالح (401)، الصلاحيات (403)، النموذج غير المتاح (404)، والحصة (429). بعد تغيير Secrets أو المتغيرات، أعد نشر Worker كي تُطبّق الإعدادات.

ملف `wrangler.jsonc` يربط `dist/` كأصول ثابتة ويضبط fallback لتطبيق SPA. ملف `public/_redirects` لا يحتوي على قواعد تحويل فعلية لتجنب حلقات إعادة التوجيه.

## تطوير محلي

انسخ `.dev.vars.example` إلى `.dev.vars`، وضع مفتاحك الحقيقي محلياً، ثم:

```bash
npm run build
npx wrangler dev
```

لا ترفع `.dev.vars` أو أي مفتاح حقيقي إلى GitHub.
