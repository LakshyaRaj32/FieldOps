import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ChangePasswordScreen } from '../../features/organization/screens/ChangePasswordScreen';
import { MemberFormScreen } from '../../features/organization/screens/MemberFormScreen';
import { MembersScreen } from '../../features/organization/screens/MembersScreen';
import { OrganizationSettingsScreen } from '../../features/organization/screens/OrganizationSettingsScreen';
import { ProductFormScreen } from '../../features/organization/screens/ProductFormScreen';
import { ProductsScreen } from '../../features/organization/screens/ProductsScreen';
import { ProfileScreen } from '../../features/profile/screens/ProfileScreen';
import { useTheme } from '../../theme';
import { renderScreenLayout } from './ScreenLayout';
import { stackScreenOptions } from './stackOptions';
import type { AccountStackParamList } from './types';

const Stack = createNativeStackNavigator<AccountStackParamList>();

/**
 * The Account tab: the profile and password for everyone; for organization admins also the
 * organization's people and teams, products and settings.
 */
export function AccountNavigator(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Stack.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={stackScreenOptions(theme)}
    >
      <Stack.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ title: 'Account' }}
      />
      <Stack.Screen
        name="ChangePassword"
        component={ChangePasswordScreen}
        options={{ title: 'Change password' }}
      />
      <Stack.Screen
        name="Members"
        component={MembersScreen}
        options={{ title: 'People and teams' }}
      />
      <Stack.Screen
        name="MemberForm"
        component={MemberFormScreen}
        options={({ route }) => ({
          title:
            route.params?.memberId === undefined ? 'Add a person' : 'Person',
        })}
      />
      <Stack.Screen
        name="Products"
        component={ProductsScreen}
        options={{ title: 'Products' }}
      />
      <Stack.Screen
        name="ProductForm"
        component={ProductFormScreen}
        options={({ route }) => ({
          title:
            route.params?.productId === undefined ? 'New product' : 'Product',
        })}
      />
      <Stack.Screen
        name="OrganizationSettings"
        component={OrganizationSettingsScreen}
        options={{ title: 'Organization' }}
      />
    </Stack.Navigator>
  );
}
