import type {
  CreateOrderRequest,
  CreateShopRequest,
  OrderDetail,
  OrderSummary,
  Shop,
  ShopAccount,
  ShopDetail,
  UpdateShopRequest,
} from '@fieldops/types';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { fetchChecked } from '../../../services/api/fetchChecked';
import {
  isOrderDetail,
  isOrderList,
  isShopAccount,
  isShopDetail,
  isShopList,
} from './contracts';

const SHOPS = { type: 'Shop', id: 'LIST' } as const;
const ORDERS = { type: 'Order', id: 'LIST' } as const;
const shopTag = (id: string) => ({ type: 'Shop', id } as const);
const accountTag = (id: string) => ({ type: 'ShopAccount', id } as const);
const orderTag = (id: string) => ({ type: 'Order', id } as const);

/**
 * Shops, their accounts and orders (staff, online). Money is always the server's: the app
 * shows balances, it never computes one. Verifying or rejecting an operation invalidates
 * the `ShopAccount` and `Order` tags (jobsApi), so balances refresh after a verification.
 */
export const shopsApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Shop', 'ShopAccount', 'Order'] })
  .injectEndpoints({
    endpoints: build => ({
      listShops: build.query<
        Shop[],
        { readonly search?: string; readonly all?: boolean } | void
      >({
        queryFn: (arg, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/shops`,
              params: {
                status: arg?.all === true ? 'ALL' : 'ACTIVE',
                ...(arg?.search !== undefined &&
                  arg.search !== '' && { search: arg.search }),
              },
            },
            isShopList,
            'shop list',
          ),
        providesTags: [SHOPS],
      }),
      getShop: build.query<ShopDetail, string>({
        queryFn: (id, _api, _extra, send) =>
          fetchChecked(send, `${API_V1}/shops/${id}`, isShopDetail, 'shop'),
        providesTags: (_result, _error, id) => [shopTag(id)],
      }),
      getShopAccount: build.query<ShopAccount, string>({
        queryFn: (id, _api, _extra, send) =>
          fetchChecked(
            send,
            `${API_V1}/shops/${id}/account`,
            isShopAccount,
            'shop account',
          ),
        providesTags: (_result, _error, id) => [accountTag(id), ORDERS],
      }),
      createShop: build.mutation<ShopDetail, CreateShopRequest>({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/shops`, method: 'POST', body },
            isShopDetail,
            'shop create',
          ),
        invalidatesTags: [SHOPS],
      }),
      updateShop: build.mutation<
        ShopDetail,
        { readonly id: string; readonly changes: UpdateShopRequest }
      >({
        queryFn: ({ id, changes }, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/shops/${id}`, method: 'PATCH', body: changes },
            isShopDetail,
            'shop update',
          ),
        invalidatesTags: (_result, _error, { id }) => [shopTag(id), SHOPS],
      }),
      assignToShop: build.mutation<
        ShopDetail,
        { readonly shopId: string; readonly userId: string }
      >({
        queryFn: ({ shopId, userId }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/shops/${shopId}/assignments`,
              method: 'POST',
              body: { userId },
            },
            isShopDetail,
            'shop assignment',
          ),
        invalidatesTags: (_result, _error, { shopId }) => [
          shopTag(shopId),
          SHOPS,
        ],
      }),
      endShopAssignment: build.mutation<
        ShopDetail,
        { readonly shopId: string; readonly userId: string }
      >({
        queryFn: ({ shopId, userId }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/shops/${shopId}/assignments/${userId}`,
              method: 'DELETE',
            },
            isShopDetail,
            'shop assignment',
          ),
        invalidatesTags: (_result, _error, { shopId }) => [
          shopTag(shopId),
          SHOPS,
        ],
      }),
      listOrders: build.query<
        OrderSummary[],
        { readonly shopId: string; readonly filter?: 'OPEN' | 'UNPAID' | 'ALL' }
      >({
        queryFn: ({ shopId, filter = 'ALL' }, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/orders`, params: { shopId, filter } },
            isOrderList,
            'order list',
          ),
        providesTags: [ORDERS],
      }),
      getOrder: build.query<OrderDetail, string>({
        queryFn: (id, _api, _extra, send) =>
          fetchChecked(send, `${API_V1}/orders/${id}`, isOrderDetail, 'order'),
        providesTags: (_result, _error, id) => [orderTag(id)],
      }),
      createOrder: build.mutation<OrderDetail, CreateOrderRequest>({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/orders`, method: 'POST', body },
            isOrderDetail,
            'order create',
          ),
        invalidatesTags: (_result, _error, { shopId }) => [
          ORDERS,
          accountTag(shopId),
        ],
      }),
      cancelOrder: build.mutation<
        OrderDetail,
        {
          readonly id: string;
          readonly shopId: string;
          readonly reason: string;
        }
      >({
        queryFn: ({ id, reason }, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/orders/${id}/cancel`,
              method: 'POST',
              body: { reason },
            },
            isOrderDetail,
            'order cancel',
          ),
        invalidatesTags: (_result, _error, { id, shopId }) => [
          orderTag(id),
          ORDERS,
          accountTag(shopId),
        ],
      }),
    }),
  });

export const {
  useListShopsQuery,
  useGetShopQuery,
  useGetShopAccountQuery,
  useCreateShopMutation,
  useUpdateShopMutation,
  useAssignToShopMutation,
  useEndShopAssignmentMutation,
  useListOrdersQuery,
  useGetOrderQuery,
  useCreateOrderMutation,
  useCancelOrderMutation,
} = shopsApi;
