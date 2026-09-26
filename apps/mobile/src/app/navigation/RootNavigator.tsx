import React, { useMemo } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useAppSelector } from '../../store/hooks';
import { selectSessionStatus } from '../../store/slices/sessionSlice';
import { useTheme } from '../../theme';
import { AppNavigator } from './AppNavigator';
import { AuthNavigator } from './AuthNavigator';
import { toNavigationTheme } from './navigationTheme';
import type { RootStackParamList } from './types';

const Stack = createNativeStackNavigator<RootStackParamList>();

/**
 * Chooses the flow from session state. Only one of Auth/App is mounted at a time, so signing
 * out unmounts every authenticated screen and back navigation can never return to it.
 */
export function RootNavigator(): React.JSX.Element {
  const theme = useTheme();
  const navigationTheme = useMemo(() => toNavigationTheme(theme), [theme]);
  const sessionStatus = useAppSelector(selectSessionStatus);

  return (
    <NavigationContainer theme={navigationTheme}>
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
