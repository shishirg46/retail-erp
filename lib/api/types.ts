// Shared client-side wire shapes (D22.5).
//
// Money arrives as rupees (number): the backend converts at the boundary (D11)
// and the UI only renders values it received. Product/Customer/Sale payload
// types are imported directly from the backend modules with `import type`
// (erased at compile time) so there is no hand-maintained DTO copy (plan §15).

// The `{ data, paging }` envelope (D12) that every list endpoint returns once
// any pagination/filter parameter is present.
export interface PagingMeta {
  next: string | null;
  hasMore: boolean;
}

export interface Paginated<T> {
  data: T[];
  paging: PagingMeta;
}
