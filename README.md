# ذكاء بلس | Zaka+

واجهة دردشة عربية RTL مبنية باستخدام React وVite، كتطبيق ويب ثابت (SPA).

## التشغيل والبناء

```bash
npm install
npm run dev
npm run build
npm run preview
```

أمر `npm run build` ينشئ الموقع الثابت داخل `dist/`، بما في ذلك `dist/index.html` والأصول المبنية وملفات `public/`. لا ينفّذ أمر البناء أي نشر عبر Wrangler.

## Cloudflare Pages

- Root directory: `/`
- Build command: `npm run build`
- Build output directory: `dist`

يجب إعداد Cloudflare Pages لنشر مجلد `dist` الناتج عن البناء. يحتوي `public/_redirects` على قاعدة SPA لتوجيه المسارات إلى `index.html`.
