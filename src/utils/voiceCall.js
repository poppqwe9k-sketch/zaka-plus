export function formatCallDuration(totalSeconds = 0) {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? Math.floor(totalSeconds) : 0;
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function prepareTextForSpeech(rawText = '') {
  if (typeof rawText !== 'string') return '';
  return rawText
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[*_~#>|]+/g, ' ')
    .replace(/^\s*[-+•]\s+/gm, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2400);
}

export function buildVoiceSystemInstruction(baseInstruction = '', langCode = 'ar') {
  const trimmed = typeof baseInstruction === 'string' ? baseInstruction.trim() : '';
  const voiceRule = langCode === 'ar'
    ? 'أنت الآن في مكالمة صوتية مباشرة مع المستخدم. أجب بشكل طبيعي، ودي، ومباشر ومختصر (جملتين إلى أربع جمل غالباً)، وبدون رموز ماركداون أو قوائم معقدة أو روابط طويلة ليبدو الرد مناسباً للقراءة الصوتية.'
    : 'You are in a live voice call with the user. Respond naturally, warmly, and concisely (typically 2 to 4 spoken sentences) without markdown formatting, asterisks, complex bullet lists, or raw URLs.';
  return trimmed ? `${trimmed}\n\n${voiceRule}` : voiceRule;
}

export function extractAudioBase64Payload(dataUrl = '') {
  if (typeof dataUrl !== 'string') return null;
  const match = dataUrl.match(/^data:(audio\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) return null;
  return {
    mimeType: match[1].toLowerCase(),
    audioBase64: match[2]
  };
}
