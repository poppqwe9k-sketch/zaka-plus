export const SPEECH_LOCALE_BY_LANG = {
  ar: 'ar-SA',
  en: 'en-US',
  fr: 'fr-FR',
  es: 'es-ES',
  de: 'de-DE',
  tr: 'tr-TR',
  fa: 'fa-IR',
  ur: 'ur-PK',
  he: 'he-IL',
  ru: 'ru-RU',
  zh: 'zh-CN',
  ja: 'ja-JP',
  ko: 'ko-KR',
  hi: 'hi-IN',
  it: 'it-IT',
  pt: 'pt-BR',
  nl: 'nl-NL',
  pl: 'pl-PL',
  uk: 'uk-UA',
  sv: 'sv-SE',
  no: 'nb-NO',
  da: 'da-DK',
  fi: 'fi-FI',
  el: 'el-GR',
  cs: 'cs-CZ',
  ro: 'ro-RO',
  hu: 'hu-HU',
  id: 'id-ID',
  ms: 'ms-MY',
  th: 'th-TH',
  vi: 'vi-VN',
  bn: 'bn-BD',
  ta: 'ta-IN',
  te: 'te-IN',
  mr: 'mr-IN',
  sw: 'sw-KE',
  am: 'am-ET',
  az: 'az-AZ',
  uz: 'uz-UZ',
  fil: 'fil-PH'
};

export function resolveSpeechLocale(langCode) {
  if (typeof langCode !== 'string' || !langCode.trim()) {
    return 'ar-SA';
  }
  const normalized = langCode.trim().toLowerCase();
  return SPEECH_LOCALE_BY_LANG[normalized] || langCode;
}

export function getSpeechRecognitionConstructor(globalObj = typeof window !== 'undefined' ? window : null) {
  if (!globalObj || typeof globalObj !== 'object') return null;
  const ctor = globalObj.SpeechRecognition || globalObj.webkitSpeechRecognition;
  return typeof ctor === 'function' ? ctor : null;
}

export function extractSpeechTranscript(results) {
  if (!results || typeof results.length !== 'number') {
    return { finalText: '', interimText: '' };
  }

  const finalParts = [];
  const interimParts = [];

  for (let i = 0; i < results.length; i += 1) {
    const result = results[i];
    if (!result || typeof result.length !== 'number' || result.length === 0) continue;
    const alt = result[0];
    const transcript = typeof alt?.transcript === 'string' ? alt.transcript.trim() : '';
    if (!transcript) continue;
    if (result.isFinal) {
      finalParts.push(transcript);
    } else {
      interimParts.push(transcript);
    }
  }

  return {
    finalText: finalParts.join(' ').trim(),
    interimText: interimParts.join(' ').trim()
  };
}

export function mergeDictatedText(baseText = '', finalText = '', interimText = '') {
  const cleanBase = typeof baseText === 'string' ? baseText.trimEnd() : '';
  const spoken = [
    typeof finalText === 'string' ? finalText.trim() : '',
    typeof interimText === 'string' ? interimText.trim() : ''
  ]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (!cleanBase) return spoken;
  if (!spoken) return cleanBase;
  return `${cleanBase} ${spoken}`;
}

export function mapSpeechErrorToKey(errorCode) {
  switch (errorCode) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'voicePermissionError';
    case 'audio-capture':
      return 'voiceNoMicError';
    case 'no-speech':
      return 'voiceNoSpeechError';
    case 'network':
      return 'voiceNetworkError';
    case 'aborted':
      return '';
    default:
      return 'voiceGenericError';
  }
}
