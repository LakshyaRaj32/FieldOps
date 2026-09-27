import type { BottomTabScreenProps } from '@react-navigation/bottom-tabs';
import type {
  CompositeScreenProps,
  NavigatorScreenParams,
} from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { JobType } from '@fieldops/types';

/** Screens available before sign-in. */
export type AuthStackParamList = {
  Login: undefined;
  Register: undefined;
};

/** The Operations tab: list, details and the staff's create/edit/assign screens. */
export type JobsStackParamList = {
  JobList: undefined;
  JobDetail: { readonly jobId: string };
  /** Create when `jobId` is absent (optionally for a shop and type), edit otherwise. */
  JobForm:
    | {
        readonly jobId?: string;
        readonly shopId?: string;
        readonly type?: JobType;
        readonly orderId?: string;
      }
    | undefined;
  AssignWorker: { readonly jobId: string };
};

/** The Shops tab (staff): shops, their accounts, orders and assignments. */
export type ShopsStackParamList = {
  ShopList: undefined;
  ShopDetail: { readonly shopId: string };
  /** Create when `shopId` is absent, edit otherwise (organization admins). */
  ShopForm: { readonly shopId?: string } | undefined;
  ShopAssign: { readonly shopId: string };
  OrderForm: { readonly shopId: string };
  OrderDetail: { readonly orderId: string };
};

/** The Account tab: profile, plus the organization's administration for its admins. */
export type AccountStackParamList = {
  Profile: undefined;
  ChangePassword: undefined;
  Members: undefined;
  /** Create when `memberId` is absent. */
  MemberForm: { readonly memberId?: string } | undefined;
  Products: undefined;
  ProductForm: { readonly productId?: string } | undefined;
  OrganizationSettings: undefined;
};

/** The platform (SUPER_ADMIN): organizations. */
export type PlatformStackParamList = {
  OrganizationList: undefined;
  OrganizationForm: undefined;
};

/** Main tabs after sign-in. Which ones exist depends on the role (AppNavigator). */
export type AppTabParamList = {
  Dashboard: undefined;
  Jobs: NavigatorScreenParams<JobsStackParamList> | undefined;
  Shops: NavigatorScreenParams<ShopsStackParamList> | undefined;
  Notifications: undefined;
  Organizations: NavigatorScreenParams<PlatformStackParamList> | undefined;
  Profile: NavigatorScreenParams<AccountStackParamList> | undefined;
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

export type ShopsScreenProps<Screen extends keyof ShopsStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<ShopsStackParamList, Screen>,
    AppTabScreenProps<'Shops'>
  >;

export type AccountScreenProps<Screen extends keyof AccountStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<AccountStackParamList, Screen>,
    AppTabScreenProps<'Profile'>
  >;

export type PlatformScreenProps<Screen extends keyof PlatformStackParamList> =
  CompositeScreenProps<
    NativeStackScreenProps<PlatformStackParamList, Screen>,
    AppTabScreenProps<'Organizations'>
  >;

// Gives useNavigation() and <Link> type checking without passing generics everywhere.
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}
