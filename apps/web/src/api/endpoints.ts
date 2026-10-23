import { api, apiDownload, apiUpload } from './client';
import type { OrderStatus, Permission, UserRole } from '@pintoria/shared';

// ---------- auth ----------
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  clientId: string | null;
  regionId: string | null;
  pricingView: boolean;
  permissions: Permission[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: SessionUser;
}

export const login = (email: string, password: string) =>
  api<LoginResponse>('POST', '/auth/login', { email, password });
export const logout = (refreshToken: string) =>
  api<{ ok: boolean }>('POST', '/auth/logout', { refreshToken });
export const me = () => api<SessionUser>('GET', '/auth/me');

// ---------- dashboard ----------
export interface DelayedOrder {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  statusEnteredAt: string;
  overlyByHours: number;
  thresholdHours: number;
}

export interface Dashboard {
  countsByStatus: Partial<Record<OrderStatus, number>>;
  recentOrders: {
    id: string;
    orderNumber: string;
    title: string;
    status: OrderStatus;
    statusEnteredAt: string;
    createdAt: string;
  }[];
  delayedOrders: DelayedOrder[];
  quotationsAwaitingDecision?: number;
  posPendingVerification?: number;
  pendingInvites?: number;
  clientCount?: number;
}

export const dashboard = () => api<Dashboard>('GET', '/dashboard');

// ---------- orders ----------
export interface ClientRef {
  id: string;
  name: string;
  code: string;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  statusEnteredAt: string;
  quantity: number | null;
  unit: string | null;
  requestedDeliveryDate: string | null;
  createdAt: string;
  client: ClientRef;
  region: ClientRef;
}

export interface OrderPage {
  total: number;
  page: number;
  pageSize: number;
  rows: OrderRow[];
}

export interface RequirementVersion {
  id: string;
  version: number;
  itemName: string;
  specification: string;
  quantity: number;
  unit: string;
  requestedDeliveryDate: string;
  notes: string | null;
  submittedAt: string;
}

export interface QuotationItem {
  id: string;
  description: string;
  specification: string | null;
  quantity: number;
  unit: string;
  unitRate: number;
  taxRatePct: number;
  amount: number;
}

export interface Quotation {
  id: string;
  version: number;
  quotationRef: string;
  currency: string;
  subTotal: number | null;
  taxAmount: number | null;
  totalAmount: number | null;
  paymentTerms: string | null;
  deliveryTerms: string | null;
  validityDate: string | null;
  status: string;
  items: QuotationItem[];
}

export interface PoCheck {
  key: string;
  checkKey?: string;
  label?: string;
  checkLabel?: string;
  expected: string | null;
  actual: string | null;
  matched: boolean | null;
  remark: string | null;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  poDate: string;
  poItems: { description: string; quantity: number; unit?: string; unitRate?: number }[];
  poTotal: number | null;
  status: string;
  expectedDeliveryDate: string | null;
  uploadedAt: string;
  checks: PoCheck[];
}

export interface StatusLog {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  action: string;
  actorId: string;
  actorRole: string;
  reason: string | null;
  comment: string | null;
  createdAt: string;
}

export interface OrderDetail {
  id: string;
  orderNumber: string;
  title: string;
  status: OrderStatus;
  statusEnteredAt: string;
  itemName: string | null;
  quantity: number | null;
  unit: string | null;
  requestedDeliveryDate: string | null;
  client: ClientRef;
  region: ClientRef;
  createdBy: { id: string; fullName: string; email: string };
  requirementVersions: RequirementVersion[];
  quotations: Quotation[];
  purchaseOrders: PurchaseOrder[];
  statusLogs: StatusLog[];
}

export const listOrders = (query: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) search.set(k, v);
  const suffix = search.toString();
  return api<OrderPage>('GET', `/orders${suffix ? `?${suffix}` : ''}`);
};

export const getOrder = (id: string) => api<OrderDetail>('GET', `/orders/${id}`);

export interface CreateOrderInput {
  title: string;
  itemName: string;
  specification: string;
  quantity: number;
  unit: string;
  requestedDeliveryDate: string;
  notes?: string;
}

export const createOrder = (dto: CreateOrderInput) => api<OrderDetail>('POST', '/orders', dto);

export const postRequirementVersion = (
  orderId: string,
  dto: Omit<CreateOrderInput, 'title'>,
) => api<RequirementVersion>('POST', `/orders/${orderId}/requirement-versions`, dto);

export const postRequirementDecision = (
  orderId: string,
  action: 'approve' | 'return' | 'reject',
  reason?: string,
) =>
  api<{ ok: boolean; status: string }>(
    'POST',
    `/orders/${orderId}/requirement-decision`,
    { action, reason },
  );

export const postQuotationDraft = (orderId: string) =>
  api<Quotation>('POST', `/orders/${orderId}/quotations`, {});

export const putQuotation = (
  quotationId: string,
  dto: {
    items: {
      description: string;
      specification?: string;
      quantity: number;
      unit: string;
      unitRate: number;
      taxRatePct: number;
    }[];
    paymentTerms?: string;
    deliveryTerms?: string;
    validityDate?: string;
  },
) => api<Quotation>('PUT', `/quotations/${quotationId}`, dto);

export const submitQuotation = (quotationId: string) =>
  api<{ ok: boolean; status: string }>('POST', `/quotations/${quotationId}/submit`, {});

export const postQuotationDecision = (
  orderId: string,
  action: 'approve' | 'request_revision' | 'reject',
  reason?: string,
) =>
  api<{ ok: boolean; status: string }>(
    'POST',
    `/orders/${orderId}/quotation-decision`,
    { action, reason },
  );

export interface UploadPoInput {
  poNumber: string;
  poDate: string;
  externalRef?: string;
  poItems: { description: string; quantity: number; unit?: string; unitRate?: number }[];
  poTotal: number;
  taxTotal?: number;
  paymentTerms?: string;
  expectedDeliveryDate?: string;
}

export const uploadPo = (orderId: string, dto: UploadPoInput) =>
  api<PurchaseOrder>('POST', `/orders/${orderId}/purchase-orders`, dto);

export const poDecision = (
  orderId: string,
  poId: string,
  dto: { action: 'confirm' | 'raise_query'; reason?: string; overrideRemark?: string },
) =>
  api<{ ok: boolean; status: string }>(
    'POST',
    `/orders/${orderId}/purchase-orders/${poId}/decision`,
    dto,
  );

export const postTransition = (
  orderId: string,
  dto: { action: string; reason?: string; comment?: string; payload?: Record<string, unknown> },
) => api<{ ok: boolean; status: string }>('POST', `/orders/${orderId}/transitions`, dto);

export interface AuditResponse {
  statusLogs: StatusLog[];
  auditRecords: {
    id: string;
    action: string;
    actor?: { fullName: string; role: string };
    before: unknown;
    after: unknown;
    createdAt: string;
  }[];
}

export const orderAudit = (orderId: string) => api<AuditResponse>('GET', `/orders/${orderId}/audit`);

// ---------- files (checkpoint 2a) ----------
export interface FileRow {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  originalName: string;
  mime: string;
  sizeBytes: number;
  checksum: string | null;
  scanStatus: string;
  createdAt: string;
}

export const listOrderFiles = (orderId: string) =>
  api<{ orderId: string; files: FileRow[] }>('GET', `/files/orders/${orderId}`);

export const uploadOrderFile = (
  orderId: string,
  file: File,
  kind: 'requirement_spec' | 'quotation_document' | 'po_document' | 'reference' | 'other',
) => {
  const form = new FormData();
  form.append('entityType', 'ORDER');
  form.append('entityId', orderId);
  form.append('kind', kind);
  form.append('file', file);
  return apiUpload<FileRow>('files/upload', form);
};

export const downloadOrderFile = (fileId: string, name: string, onFail: (m: string) => void) =>
  apiDownload(`/files/${fileId}/download`, name, onFail);

// ---------- admin ----------
export interface ClientRow {
  id: string;
  name: string;
  code: string;
  status: string;
  industry: string | null;
  paymentTerms: string | null;
  city: string | null;
  businessEmail: string | null;
  regionCount: number;
  userCount: number;
  orderCount: number;
}

export const listClients = (q?: string) =>
  api<ClientRow[]>('GET', `/admin/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`);
export const createClient = (dto: Partial<ClientRow> & { name: string; code: string }) =>
  api<ClientRow>('POST', '/admin/clients', dto);
export const updateClient = (id: string, dto: Partial<ClientRow>) =>
  api<ClientRow>('PUT', `/admin/clients/${id}`, dto);
export const deleteClient = (id: string) => api<{ ok: boolean }>('DELETE', `/admin/clients/${id}`);

export interface RegionRow {
  id: string;
  clientId: string;
  name: string;
  code: string;
  city: string | null;
  managerName: string | null;
  managerEmail: string | null;
  userCount: number;
  orderCount: number;
}

export const listRegions = (clientId: string) =>
  api<RegionRow[]>('GET', `/admin/regions?clientId=${clientId}`);
export const createRegion = (dto: { clientId: string; name: string; code: string; city?: string; managerName?: string; managerEmail?: string }) =>
  api<RegionRow>('POST', '/admin/regions', dto);
export const updateRegion = (id: string, dto: Partial<RegionRow>) =>
  api<RegionRow>('PUT', `/admin/regions/${id}`, dto);
export const deleteRegion = (id: string) => api<{ ok: boolean }>('DELETE', `/admin/regions/${id}`);

export interface UserRow {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  status: string;
  phone: string | null;
  pricingView: boolean;
  clientId: string | null;
  clientName: string | null;
  regionId: string | null;
  regionName: string | null;
  lastLoginAt: string | null;
}

export const listUsers = (query: { clientId?: string; role?: string; q?: string }) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v) search.set(k, v);
  return api<UserRow[]>('GET', `/admin/users${search.toString() ? `?${search}` : ''}`);
};
export const createUser = (dto: {
  email: string;
  fullName: string;
  role: string;
  clientId?: string;
  regionId?: string;
  phone?: string;
  pricingView?: boolean;
}) =>
  api<UserRow & { invitation: { sent: boolean; devLink?: string } }>(
    'POST',
    '/admin/users',
    dto,
  );
export const updateUser = (id: string, dto: Partial<UserRow> & { status?: string }) =>
  api<UserRow>('PUT', `/admin/users/${id}`, dto);
export const resendInvite = (id: string) =>
  api<{ sent: boolean; devLink?: string }>('POST', `/admin/users/${id}/resend-invite`, {});

// ---------- settings ----------
export const getSettings = () => api<Record<string, unknown>>('GET', '/admin/settings');
export const updateSetting = (key: string, value: unknown) =>
  api<Record<string, unknown>>('PUT', '/admin/settings', { key, value });

// ---------- notifications ----------
export interface NotificationRow {
  id: string;
  channel: string;
  templateKey: string;
  status: string;
  subject?: string;
  queuedAt: string;
  order?: { orderNumber: string; title: string };
  recipient?: { email: string; fullName: string; role: string };
}

export const listMyNotifications = (take = 50) =>
  api<NotificationRow[]>('GET', `/notifications?take=${take}`);
export interface Prefs {
  clientId: string;
  emailAlerts: boolean;
  whatsappAlerts: boolean;
  dailyPendingReminder: boolean;
}
export const getPrefs = () => api<Prefs>('GET', '/notifications/prefs');
export const updatePrefs = (dto: Partial<Pick<Prefs, 'emailAlerts' | 'whatsappAlerts' | 'dailyPendingReminder'>>) =>
  api<Prefs>('PUT', '/notifications/prefs', dto);
export const runRemindersNow = () =>
  api<{ digestsSent: number; remindersSent: number }>('POST', '/notifications/reminders/run', {});

/** Order report export — CSV with the same filters as the list view. */
export function exportOrdersCsv(
  filters: { status?: string; search?: string },
  onFail: (message: string) => void,
): void {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.search) qs.set('search', filters.search);
  qs.set('format', 'csv');
  const date = new Date().toISOString().slice(0, 10);
  void apiDownload(`/reports/orders?${qs.toString()}`, `pintoria-orders-${date}.csv`, onFail);
}
