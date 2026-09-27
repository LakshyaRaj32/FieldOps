import { createNavigationContainerRef } from '@react-navigation/native';

import type { RootStackParamList } from './types';

/**
 * Navigation from outside screens: a tapped push notification opens its job. The tap can
 * arrive before navigation exists (the app was started by it, the session is still being
 * restored), so the target is kept until the navigator is ready and signed in.
 */
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let pendingJobId: string | null = null;

function tryNavigate(): void {
  if (pendingJobId === null || !navigationRef.isReady()) {
    return;
  }
  const state = navigationRef.getRootState();
  // Only the signed-in App flow has job screens.
  if (state === undefined || !state.routeNames.includes('App')) {
    return;
  }
  const jobId = pendingJobId;
  pendingJobId = null;
  navigationRef.navigate('App', {
    screen: 'Jobs',
    params: { screen: 'JobDetail', params: { jobId }, initial: false },
  });
}

export function openJobWhenReady(jobId: string): void {
  pendingJobId = jobId;
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
