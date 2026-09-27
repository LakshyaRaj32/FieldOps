import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OrganizationFormScreen } from '../../features/platform/screens/OrganizationFormScreen';
import { OrganizationsScreen } from '../../features/platform/screens/OrganizationsScreen';
import { useTheme } from '../../theme';
import { renderScreenLayout } from './ScreenLayout';
import { stackScreenOptions } from './stackOptions';
import type { PlatformStackParamList } from './types';

const Stack = createNativeStackNavigator<PlatformStackParamList>();

/** The platform (SUPER_ADMIN): the organizations using FieldOps. */
export function PlatformNavigator(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Stack.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={stackScreenOptions(theme)}
    >
      <Stack.Screen
        name="OrganizationList"
        component={OrganizationsScreen}
        options={{ title: 'Organizations' }}
      />
      <Stack.Screen
        name="OrganizationForm"
        component={OrganizationFormScreen}
        options={{ title: 'New organization' }}
      />
    </Stack.Navigator>
  );
}
