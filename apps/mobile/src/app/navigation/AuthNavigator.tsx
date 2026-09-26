import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { LoginScreen } from '../../features/auth/screens/LoginScreen';
import { renderScreenLayout } from './ScreenLayout';
import type { AuthStackParamList } from './types';

const Stack = createNativeStackNavigator<AuthStackParamList>();

/** Unauthenticated flow. Version 2 adds real sign-in (and Register/ForgotPassword if needed). */
export function AuthNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      screenOptions={{ headerShown: false }}
      screenLayout={renderScreenLayout}
    >
      <Stack.Screen name="Login" component={LoginScreen} />
    </Stack.Navigator>
  );
}
