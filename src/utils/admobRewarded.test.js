import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ADMOB_APP_ID,
  ADMOB_REWARDED_AD_UNIT_ID,
  isNativeAdMobAvailable,
  resetAdMobInitForTests,
  showNativeRewardedAd
} from './admobRewarded.js';

test('configures exact official AdMob App ID and Rewarded Ad Unit ID', () => {
  assert.equal(ADMOB_APP_ID, 'ca-app-pub-4013056048918002~1377092939');
  assert.equal(ADMOB_REWARDED_AD_UNIT_ID, 'ca-app-pub-4013056048918002/6517738972');
});

test('detects native vs browser environment accurately', () => {
  assert.equal(isNativeAdMobAvailable({ isNativePlatform: () => false }), false);
  assert.equal(isNativeAdMobAvailable({ isNativePlatform: () => true }), true);
  assert.equal(isNativeAdMobAvailable(null), false);
});

test('initializes AdMob, prepares/shows rewarded ad, grants reward, and cleans up listeners', async () => {
  resetAdMobInitForTests();
  const listeners = new Map();
  let removedCount = 0;
  let initializedWith = null;
  let preparedWith = null;
  let shownWith = null;

  const mockAdMob = {
    async initialize(opts) {
      initializedWith = opts;
    },
    async addListener(event, fn) {
      listeners.set(event, fn);
      return {
        async remove() {
          removedCount += 1;
        }
      };
    },
    async prepareRewardVideoAd(opts) {
      preparedWith = opts;
      return { adUnitId: opts.adId };
    },
    async showRewardVideoAd(opts) {
      shownWith = opts;
      const rewardedListener = listeners.get('onRewardedVideoAdReward');
      if (rewardedListener) rewardedListener({ type: 'credits', amount: 5 });
      return { type: 'credits', amount: 5 };
    }
  };

  const result = await showNativeRewardedAd({ adMob: mockAdMob });
  assert.deepEqual(initializedWith, { initializeForTesting: false });
  assert.deepEqual(preparedWith, { adId: ADMOB_REWARDED_AD_UNIT_ID });
  assert.deepEqual(shownWith, { adId: ADMOB_REWARDED_AD_UNIT_ID });
  assert.equal(result.rewarded, true);
  assert.equal(result.amount, 5);
  assert.equal(removedCount, 3);
});

test('returns rewarded=false if native ad closes without earning reward', async () => {
  resetAdMobInitForTests();
  const mockAdMob = {
    async initialize() {},
    async addListener() {
      return { async remove() {} };
    },
    async prepareRewardVideoAd() {
      return { adUnitId: ADMOB_REWARDED_AD_UNIT_ID };
    },
    async showRewardVideoAd() {
      return { type: '', amount: 0 };
    }
  };

  const result = await showNativeRewardedAd({ adMob: mockAdMob });
  assert.equal(result.rewarded, false);
  assert.equal(result.amount, 0);
});
