import { Capacitor } from '@capacitor/core';
import { AdMob, RewardAdPluginEvents } from '@capacitor-community/admob';
import { REWARD_CREDITS_AMOUNT } from './credits.js';

export const ADMOB_APP_ID = 'ca-app-pub-4013056048918002~1377092939';
export const ADMOB_REWARDED_AD_UNIT_ID = 'ca-app-pub-4013056048918002/6517738972';
export const SIMULATED_AD_DURATION_SECONDS = 5;

let sdkInitialized = false;

export function isNativeAdMobAvailable(capacitorObj = Capacitor) {
  try {
    return Boolean(capacitorObj?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function resetAdMobInitForTests() {
  sdkInitialized = false;
}

export async function showNativeRewardedAd({
  adMob = AdMob,
  events = RewardAdPluginEvents,
  adId = ADMOB_REWARDED_AD_UNIT_ID,
  rewardAmount = REWARD_CREDITS_AMOUNT
} = {}) {
  if (!adMob) {
    throw new Error('AdMob plugin is unavailable.');
  }

  if (!sdkInitialized) {
    await adMob.initialize({ initializeForTesting: false });
    sdkInitialized = true;
  }

  let earnedViaEvent = false;
  let loadFailure = null;
  let showFailure = null;
  const listenerHandles = [];

  try {
    if (typeof adMob.addListener === 'function' && events) {
      const register = async (eventName, handler) => {
        if (!eventName) return;
        const handle = await adMob.addListener(eventName, handler);
        if (handle && typeof handle.remove === 'function') {
          listenerHandles.push(handle);
        }
      };

      await register(events.Rewarded, () => {
        earnedViaEvent = true;
      });
      await register(events.FailedToLoad, (err) => {
        loadFailure = err;
      });
      await register(events.FailedToShow, (err) => {
        showFailure = err;
      });
    }

    await adMob.prepareRewardVideoAd({ adId });
    if (loadFailure) {
      throw new Error(loadFailure?.message || 'Failed to load rewarded ad.');
    }

    const rewardResult = await adMob.showRewardVideoAd({ adId });
    if (showFailure) {
      throw new Error(showFailure?.message || 'Failed to display rewarded ad.');
    }

    const earnedViaResolve = Number(rewardResult?.amount) > 0 || Boolean(rewardResult?.type);
    const rewarded = earnedViaEvent || earnedViaResolve;

    return {
      rewarded,
      amount: rewarded ? rewardAmount : 0,
      adUnitId: adId
    };
  } finally {
    await Promise.allSettled(listenerHandles.map((handle) => handle.remove()));
  }
}
