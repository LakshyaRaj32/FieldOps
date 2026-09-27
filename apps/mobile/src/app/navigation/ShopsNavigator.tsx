import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { OrderDetailScreen } from '../../features/shops/screens/OrderDetailScreen';
import { OrderFormScreen } from '../../features/shops/screens/OrderFormScreen';
import { ShopAssignScreen } from '../../features/shops/screens/ShopAssignScreen';
import { ShopDetailScreen } from '../../features/shops/screens/ShopDetailScreen';
import { ShopFormScreen } from '../../features/shops/screens/ShopFormScreen';
import { ShopsScreen } from '../../features/shops/screens/ShopsScreen';
import { useTheme } from '../../theme';
import { renderScreenLayout } from './ScreenLayout';
import { stackScreenOptions } from './stackOptions';
import type { ShopsStackParamList } from './types';

const Stack = createNativeStackNavigator<ShopsStackParamList>();

/** The Shops tab (staff): shops → shop (account, orders, operations) → orders. */
export function ShopsNavigator(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Stack.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={stackScreenOptions(theme)}
    >
      <Stack.Screen
        name="ShopList"
        component={ShopsScreen}
        options={{ title: 'Shops' }}
      />
      <Stack.Screen
        name="ShopDetail"
        component={ShopDetailScreen}
        options={{ title: 'Shop' }}
      />
      <Stack.Screen
        name="ShopForm"
        component={ShopFormScreen}
        options={({ route }) => ({
          title: route.params?.shopId === undefined ? 'New shop' : 'Edit shop',
        })}
      />
      <Stack.Screen
        name="ShopAssign"
        component={ShopAssignScreen}
        options={{ title: 'Assign people' }}
      />
      <Stack.Screen
        name="OrderForm"
        component={OrderFormScreen}
        options={{ title: 'New order' }}
      />
      <Stack.Screen
        name="OrderDetail"
        component={OrderDetailScreen}
        options={{ title: 'Order' }}
      />
    </Stack.Navigator>
  );
}
