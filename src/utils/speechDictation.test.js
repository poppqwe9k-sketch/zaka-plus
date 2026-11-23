import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGUAGES } from '../i18n/translations.js';
import {
  SPEECH_LOCALE_BY_LANG,
  extractSpeechTranscript,
  getSpeechRecognitionConstructor,
  mapSpeechErrorToKey,
  mergeDictatedText,
  resolveSpeechLocale
} from './speechDictation.js';

test('maps every supported app language to a valid BCP-47 speech locale', () => {
  for (const lang of LANGUAGES) {
    assert.ok(SPEECH_LOCALE_BY_LANG[lang.code], `Missing speech locale for ${lang.code}`);
    const resolved = resolveSpeechLocale(lang.code);
    assert.ok(resolved.includes('-'), `Expected BCP-47 locale with region for ${lang.code}, got ${resolved}`);
  }
  assert.equal(resolveSpeechLocale('ar'), 'ar-SA');
  assert.equal(resolveSpeechLocale('en'), 'en-US');
  assert.equal(resolveSpeechLocale('fil'), 'fil-PH');
  assert.equal(resolveSpeechLocale(''), 'ar-SA');
});

test('detects standard and webkit SpeechRecognition constructors safely', () => {
  class MockSpeech {}
  class MockWebkitSpeech {}

  assert.equal(getSpeechRecognitionConstructor({ SpeechRecognition: MockSpeech }), MockSpeech);
  assert.equal(getSpeechRecognitionConstructor({ webkitSpeechRecognition: MockWebkitSpeech }), MockWebkitSpeech);
  assert.equal(getSpeechRecognitionConstructor({}), null);
  assert.equal(getSpeechRecognitionConstructor(null), null);
});

test('extracts finalized and interim speech results without duplicating words and merges cleanly with base text', () => {
  const results = [
    Object.assign([{ transcript: 'مرحبا' }], { isFinal: true }),
    Object.assign([{ transcript: 'ذكاء بلس' }], { isFinal: true }),
    Object.assign([{ transcript: 'أريد مساعدة' }], { isFinal: false })
  ];

  const { finalText, interimText } = extractSpeechTranscript(results);
  assert.equal(finalText, 'مرحبا ذكاء بلس');
  assert.equal(interimText, 'أريد مساعدة');

  assert.equal(mergeDictatedText('', finalText, interimText), 'مرحبا ذكاء بلس أريد مساعدة');
  assert.equal(mergeDictatedText('سؤال:', finalText, ''), 'سؤال: مرحبا ذكاء بلس');
  assert.equal(mergeDictatedText('سؤال: ', '', ''), 'سؤال:');
});

test('maps Web Speech API errors to localized keys and ignores user abort', () => {
  assert.equal(mapSpeechErrorToKey('not-allowed'), 'voicePermissionError');
  assert.equal(mapSpeechErrorToKey('service-not-allowed'), 'voicePermissionError');
  assert.equal(mapSpeechErrorToKey('audio-capture'), 'voiceNoMicError');
  assert.equal(mapSpeechErrorToKey('no-speech'), 'voiceNoSpeechError');
  assert.equal(mapSpeechErrorToKey('network'), 'voiceNetworkError');
  assert.equal(mapSpeechErrorToKey('aborted'), '');
  assert.equal(mapSpeechErrorToKey('unknown-err'), 'voiceGenericError');
});
