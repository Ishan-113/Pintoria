export const USER_ROLES = [
  'CLIENT_REGIONAL',
  'CLIENT_HEAD_OFFICE',
  'PRINTORIA_SALES',
  'PRINTORIA_OPS',
  'PRINTORIA_ADMIN',
] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ORDER_STATUSES = [
  'SUBMITTED',
  'RETURNED_FOR_CLARIFICATION',
  'REJECTED',
  'QUOTATION_IN_PROGRESS',
  'QUOTATION_SUBMITTED',
  'REVISION_REQUESTED',
  'AWAITING_PO',
  'PO_RECEIVED',
  'ORDER_CONFIRMED',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
  'DISPATCHED',
  'DELIVERED_CLOSED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const QUOTATION_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'REVISION_REQUESTED',
] as const;
export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export const PO_STATUSES = [
  'PENDING_VERIFICATION',
  'VERIFIED',
  'QUERY_RAISED',
  'SUPERSEDED',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

/** Canonical workflow actions, matching the status-log vocabulary used by the API and seed. */
export const ORDER_ACTIONS = [
  'submit_requirement',
  'approve_requirement',
  'return_for_clarification',
  'reject_requirement',
  'submit_quotation',
  'approve_quotation',
  'request_revision',
  'reject_quotation',
  'upload_po',
  'raise_po_query',
  'confirm_order',
  'start_production',
  'start_qc',
  'dispatch',
  'mark_delivered',
  'cancel_order',
] as const;
export type OrderAction = (typeof ORDER_ACTIONS)[number];

export const FILE_KINDS = [
  'REQUIREMENT_ATT',
  'QUOTATION_ATT',
  'QUOTATION_PDF',
  'PO_FILE',
  'DELIVERY_DOCUMENT',
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

export const AUTH_TOKEN_PURPOSES = ['INVITE', 'RESET_PASSWORD'] as const;
export type AuthTokenPurpose = (typeof AUTH_TOKEN_PURPOSES)[number];

export const PERMISSIONS = [
  'order.create',
  'order.view',
  'order.actions',
  'requirement.update',
  'requirement.decide',
  'quotation.manage',
  'quotation.decide',
  'po.upload',
  'po.verify',
  'order.confirm',
  'fulfilment.advance',
  'order.cancel',
  'pricing.view',
  'profile.view',
  'profile.edit',
  'admin.clients',
  'admin.regions',
  'admin.users',
  'admin.settings',
  'audit.view',
  'notification.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

export const NOTIFICATION_CHANNELS = ['EMAIL', 'WHATSAPP'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const CLIENT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];
