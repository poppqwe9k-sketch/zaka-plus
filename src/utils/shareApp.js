export function resolveShareUrl(locationLike) {
  if (!locationLike) return '';
  const origin = typeof locationLike.origin === 'string' && locationLike.origin !== 'null'
    ? locationLike.origin.trim()
    : '';
  if (origin && /^https?:\/\//i.test(origin)) {
    return `${origin.replace(/\/+$/, '')}/`;
  }
  const href = typeof locationLike.href === 'string' ? locationLike.href.trim() : '';
  if (href && /^https?:\/\//i.test(href)) {
    return href.split('#')[0];
  }
  return '';
}

export function buildSharePayload(t = {}, locationLike = null) {
  const url = resolveShareUrl(
    locationLike || (typeof window !== 'undefined' ? window.location : null)
  );
  const title = t.shareAppTitle || 'Plus AI';
  const text = t.shareAppInviteText
    || 'جرّب تطبيق Plus AI مجاناً! مساعدك الذكي للإجابة على الأسئلة، تحليل الصور وملفات PDF، وتوليد الصور باحترافية ✨';
  const clipboardText = url ? `${text}\n${url}` : text;

  return {
    title,
    text,
    url,
    clipboardText
  };
}

export async function shareOrCopyApp({
  payload,
  navigatorObj = typeof navigator !== 'undefined' ? navigator : null,
  documentObj = typeof document !== 'undefined' ? document : null
} = {}) {
  const sharePayload = payload || buildSharePayload();

  if (navigatorObj && typeof navigatorObj.share === 'function') {
    try {
      const data = sharePayload.url
        ? { title: sharePayload.title, text: sharePayload.text, url: sharePayload.url }
        : { title: sharePayload.title, text: sharePayload.text };
      await navigatorObj.share(data);
      return { ok: true, method: 'web-share', aborted: false, clipboardText: sharePayload.clipboardText };
    } catch (err) {
      if (err && err.name === 'AbortError') {
        return { ok: false, method: 'web-share', aborted: true, clipboardText: sharePayload.clipboardText };
      }
      // Fall through to clipboard copy if native Web Share failed or is blocked by desktop/iframe rules.
    }
  }

  if (navigatorObj?.clipboard && typeof navigatorObj.clipboard.writeText === 'function') {
    try {
      await navigatorObj.clipboard.writeText(sharePayload.clipboardText);
      return { ok: true, method: 'clipboard', aborted: false, clipboardText: sharePayload.clipboardText };
    } catch {
      // Fall through to execCommand copy fallback.
    }
  }

  if (documentObj && typeof documentObj.createElement === 'function' && documentObj.body) {
    try {
      const textarea = documentObj.createElement('textarea');
      textarea.value = sharePayload.clipboardText;
      textarea.setAttribute('readonly', '');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      documentObj.body.appendChild(textarea);
      textarea.select();
      const copied = typeof documentObj.execCommand === 'function'
        ? documentObj.execCommand('copy')
        : false;
      textarea.remove();
      if (copied) {
        return { ok: true, method: 'clipboard', aborted: false, clipboardText: sharePayload.clipboardText };
      }
    } catch {
      // Ignore DOM fallback errors.
    }
  }

  return { ok: false, method: 'none', aborted: false, clipboardText: sharePayload.clipboardText };
}
