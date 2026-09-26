import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Screens available before sign-in. Register and ForgotPassword join in Version 2 if needed. */
export type AuthStackParamList = {
  Login: undefined;
};

/** Main tabs after sign-in. */
export type AppTabParamList = {
  Dashboard: undefined;
  Jobs: undefined;
  Notifications: undefined;
  Profile: undefined;
};

/** Root: exactly one of Auth or App is mounted, depending on the session. */
export type RootStackParamList = {
  Auth: NavigatorScreenParams<AuthStackParamList>;
  App: NavigatorScreenParams<AppTabParamList>;
};

export type AuthScreenProps<Screen extends keyof AuthStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AuthStackParamList, Screen>,
    NativeStackScreenProps<RootStackParamList>
  >;

export type AppTabScreenProps<Screen extends keyof AppTabParamList> =
  CompositeScreenProps<
    BottomTabScreenProps<AppTabParamList, Screen>,
    NativeStackScreenProps<RootStackParamList>
  >;

// Gives useNavigation() and <Link> type checking without passing generics everywhere.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
