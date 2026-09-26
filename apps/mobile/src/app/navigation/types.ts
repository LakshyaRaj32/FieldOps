import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

/** Screens available before sign-in. */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

/** The Jobs tab: list, details and the manager's create/edit/assign screens. */
export type JobsStackParamList = {
  JobList: undefined;
  JobDetail: { readonly jobId: string };
  /** Create when `jobId` is absent, edit otherwise. */
  JobForm: { readonly jobId?: string } | undefined;
  AssignWorker: { readonly jobId: string };
};

/** Main tabs after sign-in. */
export type AppTabParamList = {
  Dashboard: undefined;
  Jobs: NavigatorScreenParams<JobsStackParamList> | undefined;
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

export type JobsScreenProps<Screen extends keyof JobsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<JobsStackParamList, Screen>,
    AppTabScreenProps<'Jobs'>
  >;

// Gives useNavigation() and <Link> type checking without passing generics everywhere.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
