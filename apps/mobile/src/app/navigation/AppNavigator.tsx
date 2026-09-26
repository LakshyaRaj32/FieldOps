import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { NotificationsScreen } from '../../features/notifications/screens/NotificationsScreen';
import { ProfileScreen } from '../../features/profile/screens/ProfileScreen';
import { useTheme } from '../../theme';
import { JobsNavigator } from './JobsNavigator';
import { renderScreenLayout } from './ScreenLayout';
import type { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

/** A small pill above the tab label. Icons arrive with the expanded design system. */
function TabIndicator({
  focused,
  color,
}: {
  focused: boolean;
  color: string;
}): React.JSX.Element {
  return (
    <View style={[styles.indicator, focused && { backgroundColor: color }]} />
  );
}

const renderTabIndicator = (props: {
  focused: boolean;
  color: string;
}): React.JSX.Element => <TabIndicator {...props} />;

const renderPlainLayout = ({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element => <>{children}</>;

/** Authenticated flow: the main tabs. */
export function AppNavigator(): React.JSX.Element {
  const theme = useTheme();
  return (
    <Tab.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarIcon: renderTabIndicator,
        headerTitleStyle: { fontSize: 18, fontWeight: '700' },
      }}
    >
      <Tab.Screen name="Dashboard" component={DashboardScreen} />
      <Tab.Screen
        name="Jobs"
        component={JobsNavigator}
        // The stack shows its own headers and wraps its screens in the shared layout.
        options={{ headerShown: false }}
        layout={renderPlainLayout}
      />
      <Tab.Screen name="Notifications" component={NotificationsScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  indicator: { width: 20, height: 4, borderRadius: 2 },
});
