# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية باستخدام React وVite كتطبيق ويب ثابت (SPA).

## التشغيل والبناء

```bash
npm install
npm run dev
npm run build
npm run preview
```

ينشئ `npm run build` ملفات الموقع الثابت داخل `dist/`. لا يشغّل أمر Wrangler أو أي خطوة نشر.

## Cloudflare Pages

- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`

عند نشر هذا التطبيق على Cloudflare Pages، يُقدَّم `index.html` تلقائياً كـ fallback لتطبيق SPA. ملف `public/_redirects` لا يحتوي على قواعد تحويل فعلية؛ تجنّب قاعدة `/* /index.html 200` إذا كان إعداد النشر يفعّل SPA fallback، لأنها قد تؤدي إلى حلقة تحويل. لا يوجد ملف `wrangler.jsonc` أو إعداد Wrangler ضمن ملفات المستودع الحالية.
