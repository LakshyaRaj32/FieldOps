import React, { useEffect, useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LoadingState } from '../../components/common/LoadingState';
import { Screen } from '../../components/ui';
import { useAppSelector } from '../../store/hooks';
import { selectSessionStatus } from '../../store/slices/sessionSlice';
import { useTheme } from '../../theme';
import { AppNavigator } from './AppNavigator';
import { AuthNavigator } from './AuthNavigator';
import { flushPendingNavigation, navigationRef } from './navigationRef';
import { toNavigationTheme } from './navigationTheme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Chooses the flow from session state. Only one of Auth/App is mounted at a time, so signing
 * out (or the server ending the session) unmounts every authenticated screen and back
 * navigation can never return to it.
 *
 * While the stored session is being read at startup nothing is mounted, so the sign-in
 * screen never flashes for a user who is already signed in.
 */
export function RootNavigator(): React.JSX.Element {
  const theme = useTheme();
  const navigationTheme = useMemo(() => toNavigationTheme(theme), [theme]);
  const sessionStatus = useAppSelector(selectSessionStatus);

  // A notification tapped before sign-in completed opens its job once the App flow exists.
  useEffect(() => {
    if (sessionStatus === 'signedIn') {
      const timer = setTimeout(flushPendingNavigation, 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [sessionStatus]);

  if (sessionStatus === 'restoring') {
    return (
      <Screen edges={['top', 'bottom', 'left', 'right']} scroll={false}>
        <LoadingState message="Starting FieldOps…" />
      </Screen>
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      onReady={flushPendingNavigation}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {sessionStatus === 'signedIn' ? (
          <Stack.Screen name="App" component={AppNavigator} />
        ) : (
          <Stack.Screen
            name="Auth"
            component={AuthNavigator}
            options={{ animationTypeForReplace: 'pop' }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
