import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LANGUAGES,
  getLanguageMeta,
  getTranslation
} from './translations.js';

test('provides exactly 40 unique world languages with native names and proper direction', () => {
  assert.equal(LANGUAGES.length, 40);
  const codes = new Set(LANGUAGES.map((l) => l.code));
  assert.equal(codes.size, 40);

  for (const lang of LANGUAGES) {
    assert.ok(lang.code.length >= 2);
    assert.ok(lang.name.trim().length > 0);
    assert.ok(lang.dir === 'rtl' || lang.dir === 'ltr');
  }

  assert.equal(getLanguageMeta('ar').dir, 'rtl');
  assert.equal(getLanguageMeta('fa').dir, 'rtl');
  assert.equal(getLanguageMeta('ur').dir, 'rtl');
  assert.equal(getLanguageMeta('he').dir, 'rtl');
  assert.equal(getLanguageMeta('fr').dir, 'ltr');
  assert.equal(getLanguageMeta('ja').dir, 'ltr');
});

test('returns full localized UI copy for all 40 languages', () => {
  const requiredKeys = [
    'newChat',
    'history',
    'searchPlaceholder',
    'settings',
    'welcomeTitle',
    'deepThinking',
    'imageMode',
    'placeholder',
    'send',
    'downloadImage',
    'settingsTitle',
    'languageLabel'
  ];

  for (const lang of LANGUAGES) {
    const copy = getTranslation(lang.code);
    for (const key of requiredKeys) {
      assert.equal(typeof copy[key], 'string', `Missing key ${key} for ${lang.code}`);
      assert.ok(copy[key].length > 0, `Empty key ${key} for ${lang.code}`);
    }
    assert.ok(copy.tiers?.plus?.label);
    assert.ok(copy.tiers?.['plus-plus']?.label);
    assert.ok(copy.tiers?.['plus-max']?.label);
  }
});
