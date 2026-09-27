import type {
  CreateProductRequest,
  Product,
  UpdateProductRequest,
} from '@fieldops/types';

import { API_V1, baseApi } from '../../../services/api/baseApi';
import { fetchChecked } from '../../../services/api/fetchChecked';
import { isProduct, isProductList } from './contracts';

const LIST = { type: 'Product', id: 'LIST' } as const;

/** The organization's products (online: staff screens and the order forms). */
export const catalogApi = baseApi
  .enhanceEndpoints({ addTagTypes: ['Product'] })
  .injectEndpoints({
    endpoints: build => ({
      listProducts: build.query<Product[], { readonly all?: boolean } | void>({
        queryFn: (arg, _api, _extra, send) =>
          fetchChecked(
            send,
            {
              url: `${API_V1}/products`,
              params: { status: arg?.all === true ? 'ALL' : 'ACTIVE' },
            },
            isProductList,
            'product list',
          ),
        providesTags: [LIST],
      }),
      createProduct: build.mutation<Product, CreateProductRequest>({
        queryFn: (body, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/products`, method: 'POST', body },
            isProduct,
            'product create',
          ),
        invalidatesTags: [LIST],
      }),
      updateProduct: build.mutation<
        Product,
        { readonly id: string; readonly changes: UpdateProductRequest }
      >({
        queryFn: ({ id, changes }, _api, _extra, send) =>
          fetchChecked(
            send,
            { url: `${API_V1}/products/${id}`, method: 'PATCH', body: changes },
            isProduct,
            'product update',
          ),
        invalidatesTags: [LIST],
      }),
    }),
  });

export const {
  useListProductsQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
} = catalogApi;
