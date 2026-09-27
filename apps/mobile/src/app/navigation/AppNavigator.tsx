import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { skipToken } from '@reduxjs/toolkit/query/react';

import { Icon, type IconName } from '../../components/ui';
import {
  isStaff,
  isSuperAdmin,
  isUnaffiliated,
} from '../../features/auth/roles';
import { DashboardScreen } from '../../features/dashboard/screens/DashboardScreen';
import { useGetNotificationsQuery } from '../../features/notifications/api/notificationsApi';
import { NotificationsScreen } from '../../features/notifications/screens/NotificationsScreen';
import { useAppSelector } from '../../store/hooks';
import { selectSessionUser } from '../../store/slices/sessionSlice';
import { useTheme } from '../../theme';
import { AccountNavigator } from './AccountNavigator';
import { JobsNavigator } from './JobsNavigator';
import { PlatformNavigator } from './PlatformNavigator';
import { renderScreenLayout } from './ScreenLayout';
import { ShopsNavigator } from './ShopsNavigator';
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
  Shops: { active: 'storefront', inactive: 'storefront-outline' },
  Notifications: { active: 'notifications', inactive: 'notifications-outline' },
  Organizations: { active: 'business', inactive: 'business-outline' },
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
 * Authenticated flow: the main tabs, by role (UX only; the server enforces every rule):
 *
 *   WORKER               Dashboard · Operations · Inbox · Account
 *   MANAGER, ORG ADMIN   Dashboard · Operations · Shops · Inbox · Account
 *   SUPER_ADMIN          Organizations · Account (the platform runs no field operations)
 *   no organization yet  Dashboard (what to do next) · Account
 *
 * Organization administration (members, teams, products, settings) lives in the Account tab.
 */
export function AppNavigator(): React.JSX.Element {
  const theme = useTheme();
  const user = useAppSelector(selectSessionUser);
  const platform = isSuperAdmin(user);
  const unaffiliated = isUnaffiliated(user);
  const staff = isStaff(user);
  const hasInbox = !platform && !unaffiliated;
  // Refreshed by realtime events and pushes (app/providers/RealtimeConnection).
  const { data: inbox } = useGetNotificationsQuery(
    hasInbox ? undefined : skipToken,
  );
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
      {platform ? (
        <Tab.Screen
          name="Organizations"
          component={PlatformNavigator}
          options={{ headerShown: false, tabBarIcon: tabIcon('Organizations') }}
          layout={renderPlainLayout}
        />
      ) : (
        <Tab.Screen
          name="Dashboard"
          component={DashboardScreen}
          options={{ tabBarIcon: tabIcon('Dashboard') }}
        />
      )}
      {!platform && !unaffiliated ? (
        <Tab.Screen
          name="Jobs"
          component={JobsNavigator}
          // The stack shows its own headers and wraps its screens in the shared layout.
          options={{
            title: 'Operations',
            headerShown: false,
            tabBarIcon: tabIcon('Jobs'),
          }}
          layout={renderPlainLayout}
        />
      ) : null}
      {staff ? (
        <Tab.Screen
          name="Shops"
          component={ShopsNavigator}
          options={{ headerShown: false, tabBarIcon: tabIcon('Shops') }}
          layout={renderPlainLayout}
        />
      ) : null}
      {hasInbox ? (
        <Tab.Screen
          name="Notifications"
          component={NotificationsScreen}
          options={{
            title: 'Inbox',
            tabBarIcon: tabIcon('Notifications'),
            tabBarAccessibilityLabel:
              unread > 0 ? `Inbox, ${unread} unread` : 'Inbox',
            ...(unread > 0 && { tabBarBadge: unread > 99 ? '99+' : unread }),
          }}
        />
      ) : null}
      <Tab.Screen
        name="Profile"
        component={AccountNavigator}
        options={{
          title: 'Account',
          headerShown: false,
          tabBarIcon: tabIcon('Profile'),
        }}
        layout={renderPlainLayout}
      />
    </Tab.Navigator>
  );
}
