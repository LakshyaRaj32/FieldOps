import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * Navigation from outside screens: a tapped push notification opens its job. The tap can
 * arrive before navigation exists (the app was started by it, the session is still being
 * restored), so the target is kept until the navigator is ready and signed in.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pending:
  | { readonly screen: 'job'; readonly id: string }
  | { readonly screen: 'shop'; readonly id: string }
  | null = null;

function tryNavigate(): void {
  if (pending === null || !navigationRef.isReady()) {
    return;
  }
  const state = navigationRef.getRootState();
  // Only the signed-in App flow has these screens.
  if (state === undefined || !state.routeNames.includes('App')) {
    return;
  }
  const target = pending;
  pending = null;
  if (target.screen === 'job') {
    navigationRef.navigate('App', {
      screen: 'Jobs',
      params: {
        screen: 'JobDetail',
        params: { jobId: target.id },
        initial: false,
      },
    });
  } else {
    navigationRef.navigate('App', {
      screen: 'Shops',
      params: {
        screen: 'ShopDetail',
        params: { shopId: target.id },
        initial: false,
      },
    });
  }
}

export function openJobWhenReady(jobId: string): void {
  pending = { screen: 'job', id: jobId };
  tryNavigate();
}

/** An overdue payment's push: the shop's account (staff only receive these). */
export function openShopWhenReady(shopId: string): void {
  pending = { screen: 'shop', id: shopId };
  tryNavigate();
}

export function openNotificationsWhenReady(): void {
  if (navigationRef.isReady()) {
    const state = navigationRef.getRootState();
    if (state?.routeNames.includes('App') === true) {
      navigationRef.navigate('App', { screen: 'Notifications' });
    }
  }
}

/** Called when the navigator becomes ready or its flow changes (sign-in). */
export function flushPendingNavigation(): void {
  tryNavigate();
}
