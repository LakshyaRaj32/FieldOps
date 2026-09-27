import {
  OrganizationStatus,
  Role,
  type ChangePasswordRequest,
  type CreateMemberRequest,
  type CreateOrganizationRequest,
  type Member,
  type Organization,
  type UpdateMemberRequest,
  type UpdateOrganizationRequest,
} from '@fieldops/types';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { fetchChecked, sendEmpty } from '../../../services/api/fetchChecked';
import {
  isArrayOf,
  isBoolean,
  isNullableString,
  isNullableUser,
  isNumber,
  isRecord,
  isString,
  oneOf,
} from '../../../services/api/guards';

const isRole = oneOf(Role);
const isOrganizationStatus = oneOf(OrganizationStatus);

export function isMember(value: unknown): value is Member {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    email,
    firstName,
    lastName,
    role,
    isActive,
    organizationWideAccess,
    manager,
    createdAt,
  } = value;
  return (
    [id, email, firstName, lastName, createdAt].every(isString) &&
    isRole(role) &&
    isBoolean(isActive) &&
    isBoolean(organizationWideAccess) &&
    isNullableUser(manager)
  );
}

const isMemberList = (value: unknown): value is Member[] =>
  isArrayOf(value, isMember);

export function isOrganization(value: unknown): value is Organization {
  if (!isRecord(value)) {
    return false;
  }
  const {
    id,
    name,
    status,
    currency,
    timeZone,
    contactName,
    contactEmail,
    contactPhone,
    address,
    arrivalRadiusMeters,
    memberCount,
    createdAt,
    updatedAt,
  } = value;
  return (
    [id, name, currency, timeZone, createdAt, updatedAt].every(isString) &&
    isOrganizationStatus(status) &&
    [contactName, contactEmail, contactPhone, address].every(
      isNullableString,
    ) &&
    isNumber(arrivalRadiusMeters) &&
    isNumber(memberCount)
  );
}

const isOrganizationList = (value: unknown): value is Organization[] =>
  isArrayOf(value, isOrganization);

const MEMBERS = { type: 'Member', id: 'LIST' } as const;
const ORGANIZATIONS = { type: 'Organization', id: 'LIST' } as const;

/**
 * Organization administration (ORGANIZATION_ADMIN: members and teams, settings) and the
 * platform (SUPER_ADMIN: organizations). The server refuses anyone else; screens hide it.
 */
export const organizationApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Member', 'Organization', 'Worker'] })
  .injectEndpoints({
    endpoints: build => ({
      listMembers: build.query<Member[], void>({
        queryFn: (_arg, _api, _extra, send) =>
          fetchChecked(
            send,
            `${API_V1}/organization/members`,
            isMemberList,
            'member list',
          ),
        providesTags: [MEMBERS],
      }),
      createMember: build.mutation<Member, CreateMemberRequest>({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/organization/members`, method: 'POST', body },
            isMember,
            'member create',
          ),
        invalidatesTags: [MEMBERS, 'Worker'],
      }),
      updateMember: build.mutation<
        Member,
        { readonly id: string; readonly changes: UpdateMemberRequest }
      >({
        queryFn: ({ id, changes }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/organization/members/${id}`,
              method: 'PATCH',
              body: changes,
            },
            isMember,
            'member update',
          ),
        invalidatesTags: [MEMBERS, 'Worker'],
      }),
      setMemberManager: build.mutation<
        Member,
        { readonly id: string; readonly managerId: string | null }
      >({
        queryFn: ({ id, managerId }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/organization/members/${id}/manager`,
              method: 'PUT',
              body: { managerId },
            },
            isMember,
            'team change',
          ),
        invalidatesTags: [MEMBERS, 'Worker'],
      }),
      getOwnOrganization: build.query<Organization, void>({
        queryFn: (_arg, _api, _extra, send) =>
          fetchChecked(
            send,
            `${API_V1}/organization`,
            isOrganization,
            'organization',
          ),
        providesTags: ['Organization'],
      }),
      updateOwnOrganization: build.mutation<
        Organization,
        UpdateOrganizationRequest
      >({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/organization`, method: 'PATCH', body },
            isOrganization,
            'organization update',
          ),
        invalidatesTags: ['Organization'],
      }),
      listOrganizations: build.query<Organization[], void>({
        queryFn: (_arg, _api, _extra, send) =>
          fetchChecked(
            send,
            `${API_V1}/organizations`,
            isOrganizationList,
            'organization list',
          ),
        providesTags: [ORGANIZATIONS],
      }),
      createOrganization: build.mutation<
        Organization,
        CreateOrganizationRequest
      >({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/organizations`, method: 'POST', body },
            isOrganization,
            'organization create',
          ),
        invalidatesTags: [ORGANIZATIONS],
      }),
      setOrganizationSuspended: build.mutation<
        Organization,
        { readonly id: string; readonly suspended: boolean }
      >({
        queryFn: ({ id, suspended }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/organizations/${id}/${
                suspended ? 'suspend' : 'activate'
              }`,
              method: 'POST',
            },
            isOrganization,
            'organization status',
          ),
        invalidatesTags: [ORGANIZATIONS],
      }),
      changePassword: build.mutation<null, ChangePasswordRequest>({
        queryFn: (body, _api, _extra, send) =>
          sendEmpty(send, {
            url: `${API_V1}/auth/change-password`,
            method: 'POST',
            body,
          }),
      }),
    }),
  });

export const {
  useListMembersQuery,
  useCreateMemberMutation,
  useUpdateMemberMutation,
  useSetMemberManagerMutation,
  useGetOwnOrganizationQuery,
  useUpdateOwnOrganizationMutation,
  useListOrganizationsQuery,
  useCreateOrganizationMutation,
  useSetOrganizationSuspendedMutation,
  useChangePasswordMutation,
} = organizationApi;
