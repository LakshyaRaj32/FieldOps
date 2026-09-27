import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';

import { Icon, type IconName } from '../../components/ui';
import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { useGetNotificationsQuery } from '../../features/notifications/api/notificationsApi';
import { NotificationsScreen } from '../../features/notifications/screens/NotificationsScreen';
import { ProfileScreen } from '../../features/profile/screens/ProfileScreen';
import { useTheme } from '../../theme';
import { JobsNavigator } from './JobsNavigator';
import { renderScreenLayout } from './ScreenLayout';
import type { AppTabParamList } from './types';

const Tab = createBottomTabNavigator<AppTabParamList>();

/**
 * Each tab's icon: filled while the tab is active, outline otherwise, so the active tab is
 * recognizable by shape as well as by color.
 */
const TAB_ICONS: Readonly<
  Record<keyof AppTabParamList, { active: IconName; inactive: IconName }>
> = {
  Dashboard: { active: 'grid', inactive: 'grid-outline' },
  Jobs: { active: 'briefcase', inactive: 'briefcase-outline' },
  Notifications: { active: 'notifications', inactive: 'notifications-outline' },
  Profile: { active: 'person-circle', inactive: 'person-circle-outline' },
};

const tabIcon =
  (tab: keyof AppTabParamList) =>
  ({ focused, color }: { focused: boolean; color: string }) =>
    (
      <Icon
        name={focused ? TAB_ICONS[tab].active : TAB_ICONS[tab].inactive}
        size="lg"
        color={color}
      />
    );

const renderPlainLayout = ({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element => <>{children}</>;

/**
 * Authenticated flow: the main tabs. Every role has the same four tabs (each is useful to
 * workers and managers alike); what differs by role lives inside the screens, above all the
 * Dashboard (docs/mobile-architecture.md, "Navigation").
 */
export function AppNavigator(): React.JSX.Element {
  const theme = useTheme();
  // Refreshed by realtime events and pushes (app/providers/RealtimeConnection).
  const { data: inbox } = useGetNotificationsQuery();
  const unread = inbox?.unreadCount ?? 0;
  return (
    <Tab.Navigator
      screenLayout={renderScreenLayout}
      screenOptions={{
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.textMuted,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.border,
        },
        tabBarBadgeStyle: {
          backgroundColor: theme.colors.danger,
          color: theme.colors.onPrimary,
          fontSize: 11,
          fontWeight: '700',
        },
        // Forms get the whole height above the keyboard (see components/ui/Screen).
        tabBarHideOnKeyboard: true,
        headerTitleStyle: { fontSize: 18, fontWeight: '700' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: theme.colors.surface },
      }}
    >
      <Tab.Screen
        name="Dashboard"
        component={DashboardScreen}
        options={{ tabBarIcon: tabIcon('Dashboard') }}
      />
      <Tab.Screen
        name="Jobs"
        component={JobsNavigator}
        // The stack shows its own headers and wraps its screens in the shared layout.
        options={{ headerShown: false, tabBarIcon: tabIcon('Jobs') }}
        layout={renderPlainLayout}
      />
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarIcon: tabIcon('Notifications'),
          tabBarAccessibilityLabel:
            unread > 0 ? `Notifications, ${unread} unread` : 'Notifications',
          ...(unread > 0 && { tabBarBadge: unread > 99 ? '99+' : unread }),
        }}
      />
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarIcon: tabIcon('Profile') }}
      />
    </Tab.Navigator>
  );
}
