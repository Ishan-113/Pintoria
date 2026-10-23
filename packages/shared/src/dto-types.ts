import type { OrderStatus, Permission, UserRole } from './enums';

/** Exact display labels from the prototype / spec. */
export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  SUBMITTED: 'Submitted',
  RETURNED_FOR_CLARIFICATION: 'Returned for Clarification',
  REJECTED: 'Rejected',
  QUOTATION_IN_PROGRESS: 'Quotation in Progress',
  QUOTATION_SUBMITTED: 'Quotation Submitted',
  REVISION_REQUESTED: 'Revision Requested',
  AWAITING_PO: 'Awaiting PO',
  PO_RECEIVED: 'PO Received',
  ORDER_CONFIRMED: 'Order Confirmed',
  IN_PRODUCTION: 'In Production',
  QUALITY_CHECK: 'Quality Check',
  DISPATCHED: 'Dispatched',
  DELIVERED_CLOSED: 'Delivered & Closed',
  CANCELLED: 'Cancelled',
};

export const ROLE_LABELS: Record<UserRole, string> = {
  CLIENT_REGIONAL: 'Regional Office',
  CLIENT_HEAD_OFFICE: 'Head Office',
  PRINTORIA_SALES: 'Printoria Sales',
  PRINTORIA_OPS: 'Printoria Operations',
  PRINTORIA_ADMIN: 'Printoria Admin',
};

export const ROLE_LABEL_SHORT: Record<UserRole, string> = {
  CLIENT_REGIONAL: 'Regional',
  CLIENT_HEAD_OFFICE: 'Head Office',
  PRINTORIA_SALES: 'Sales',
  PRINTORIA_OPS: 'Operations',
  PRINTORIA_ADMIN: 'Admin',
};

/** Money/price-shaped keys stripped from any response, export, log payload or
 *  notification payload when the recipient lacks `pricing.view` or is a
 *  CLIENT_REGIONAL user (who can never hold it). */
export const PRICING_KEYS = new Set<string>([
  'rate',
  'unit_rate',
  'unitRate',
  'sub_total',
  'subTotal',
  'subtotal',
  'tax_amount',
  'taxAmount',
  'tax_total',
  'taxTotal',
  'total_amount',
  'totalAmount',
  'amount',
  'price',
  'pricing',
]);

/** Commercial fields (business profile) that regional users must never receive. */
export const COMMERCIAL_KEYS = new Set<string>([
  'payment_terms',
  'paymentTerms',
  'gstin',
  'pan_no',
  'pan',
  'cin',
]);

export interface SessionUserDto {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clientId: string | null;
  regionId: string | null;
  pricingView: boolean;
  permissions: Permission[];
}

export interface LoginResponseDto {
  accessToken: string;
  refreshToken: string;
  user: SessionUserDto;
}
