import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support';

const DEMO_PASSWORD = 'Printoria@2024';

const http = (app: INestApplication) => request(app.getHttpServer());

async function login(app: INestApplication, email: string): Promise<string> {
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD })
    .expect(200);
  return res.body.accessToken;
}

const METHOD = {
  title: 'Diwali campaign shipping cartons',
  itemName: 'Corrugated shipping cartons',
  specification: '3-ply brown, printed logo, handle cut-out',
  quantity: 500,
  unit: 'pcs',
  requestedDeliveryDate: '2026-12-15',
  notes: 'Needed for the festive packaging rollout',
};

const QUOTE_ITEMS = [
  {
    description: 'Corrugated shipping cartons',
    specification: '3-ply brown, printed logo',
    quantity: 500,
    unit: 'pcs',
    unitRate: 60,
    taxRatePct: 18,
  },
];

let app: INestApplication;
let token: Record<string, string> = {};
let firstOrderNumber = 'PRT-10000';

beforeAll(async () => {
  app = await createTestApp();
  token = {};
  for (const [key, email] of Object.entries({
    admin: 'pt.admin@printoria.example',
    sales: 'pt.sales@printoria.example',
    ops: 'pt.ops@printoria.example',
    west: 'regional.west@sunlightfoods.example',
    ho: 'ho@sunlightfoods.example',
    south: 'regional.south@nimbusretail.example',
  })) {
    token[key] = await login(app, email);
  }
});

const authed = (t: string) => {
  const hdr = `Bearer ${t ?? ''}`;
  return {
    get: (url: string) => http(app).get(url).set('Authorization', hdr),
    post: (url: string) => http(app).post(url).set('Authorization', hdr),
    put: (url: string) => http(app).put(url).set('Authorization', hdr),
  };
};

afterAll(async () => {
  await app.close();
});

describe('Settings & audit endpoints', () => {
  it('settings/public requires login', async () => {
    await http(app).get('/api/v1/settings/public').expect(401);
  });

  it('admin reads and updates settings; others are locked out', async () => {
    const list = await authed(token.admin).get('/api/v1/admin/settings').expect(200);
    expect(list.body.cancellation_rules).toEqual(
      expect.objectContaining({ chargesAfterPo: true, regionalMayCancel: true }),
    );

    await authed(token.sales).put('/api/v1/admin/settings').send({
      key: 'delay_threshold_hours',
      value: { default: 1 },
    }).expect(403);

    const put = await authed(token.admin).put('/api/v1/admin/settings').send({
      key: 'delay_threshold_hours',
      value: { default: 36, perStage: {} },
    }).expect(200);
    expect(put.body.delay_threshold_hours.default).toBe(36);

    const unknown = await authed(token.admin).put('/api/v1/admin/settings').send({
      key: 'not_a_setting',
      value: {},
    }).expect(400);
    expect(unknown.body.code).toBe('VALIDATION_ERROR');
  });

  it('global audit list is admin-only', async () => {
    await authed(token.sales).get('/api/v1/audit').expect(403);
  });
});

describe('Order lifecycle (checkpoint 1b)', () => {
  it('runs the full regional → HO → sales → HO → ops pipeline for order PRT-1009', async () => {
    // CREATE (regional, sunlight foods west)
    const created = await authed(token.west).post('/api/v1/orders').send(METHOD).expect(201);
    // global sequential numbering continues from the seed (this suite may run
    // after the admin suite, so assert on the shape, not a hard-coded number)
    expect(created.body.orderNumber).toMatch(/^PRT-\d{4}$/);
    expect(created.body.status).toBe('SUBMITTED');
    firstOrderNumber = created.body.orderNumber as string;
    const orderId = created.body.id;

    // TENANCY — south looks for the west order and finds nothing
    await authed(token.south).get(`/api/v1/orders/${orderId}`).expect(404);
    // printoria staff can see it
    await authed(token.sales).get(`/api/v1/orders/${orderId}`).expect(200);

    // regional cannot decide on its own requirement
    await authed(token.west)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'approve' })
      .expect(403);

    // clarification round MUST carry a reason
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'return' })
      .expect(422);
    expect(
      (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
    ).toBe('SUBMITTED');

    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'return', reason: 'Kraft weight option missing in specs' })
      .expect(200);
    expect(
      (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
    ).toBe('RETURNED_FOR_CLARIFICATION');

    // resubmit with a new requirement version (no `title` in this DTO)
    await authed(token.west)
      .post(`/api/v1/orders/${orderId}/requirement-versions`)
      .send({
        itemName: METHOD.itemName,
        specification: '3-ply brown, printed logo, handle cut-out, kraft 250gsm',
        quantity: METHOD.quantity,
        unit: METHOD.unit,
        requestedDeliveryDate: METHOD.requestedDeliveryDate,
      })
      .expect(201);
    expect(
      (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
    ).toBe('SUBMITTED');

    // approve → quoting
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'approve' })
      .expect(200);

    // regional cancels outside its window (now at QUOTATION_IN_PROGRESS) → 409 INVALID_STATE
    const badCancel = await authed(token.west)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'changed mind' })
      .expect(409);
    expect(badCancel.body.code).toBe('INVALID_STATE');

    // SALES: draft → price → submit
    const draft = await authed(token.sales).post(`/api/v1/orders/${orderId}/quotations`).expect(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.quotationRef).toBe(`QTN-${firstOrderNumber.slice(4)}-v1`);

    // client must never see the draft quotation
    const clientView = await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200);
    expect(clientView.body.quotations).toEqual([]);

    await authed(token.sales).put(`/api/v1/quotations/${draft.body.id}`).send({
      items: QUOTE_ITEMS,
      paymentTerms: 'Net 30 days',
      deliveryTerms: 'Delivered at Head Office warehouse',
      validityDate: '2026-12-24',
    }).expect(200);

    await authed(token.sales).post(`/api/v1/quotations/${draft.body.id}/submit`).expect(201);

    // pricing redaction: regional sees the submitted quotation WITHOUT money
    const redacted = await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200);
    expect(redacted.body.status).toBe('QUOTATION_SUBMITTED');
    expect(redacted.body.quotations).toHaveLength(1);
    expect(redacted.body.quotations[0].subTotal).toBeUndefined();
    expect(redacted.body.quotations[0].items[0].unitRate).toBeUndefined();

    // HO approves the quotation → AWAITING_PO
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/quotation-decision`)
      .send({ action: 'approve' })
      .expect(200);
    expect(
      (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
    ).toBe('AWAITING_PO');

    // PO verification loop
    // regional cannot upload, and can never open the PO checklist
    await authed(token.west)
      .post(`/api/v1/orders/${orderId}/purchase-orders`)
      .send({ poNumber: 'PO-TEST-1', poDate: '2026-11-01', poItems: [], poTotal: 1 })
      .expect(403);

    const po1 = await authed(token.ho).post(`/api/v1/orders/${orderId}/purchase-orders`).send({
      poNumber: 'PO-SF-0901',
      poDate: '2026-11-01',
      externalRef: `QTN-${firstOrderNumber.slice(4)}-v1`,
      poItems: [
        { description: 'Corrugated shipping cartons', quantity: 500, unit: 'pcs', unitRate: 60 },
      ],
      poTotal: 37170, // ~5% too high → mismatch
      taxTotal: 5670,
      paymentTerms: 'Net 30 days',
      expectedDeliveryDate: '2026-12-10',
    }).expect(201);
    expect(po1.body.status).toBe('PENDING_VERIFICATION');
    expect(po1.body.checks).toHaveLength(8);

    const checklist1 = await authed(token.ops)
      .get(`/api/v1/orders/${orderId}/purchase-orders/${po1.body.id}/checklist`)
      .expect(200);
    const totalRow = checklist1.body.checks.find(
      (c: { key: string }) => c.key === 'total_amount',
    );
    expect(totalRow.matched).toBe(false);

    // regional is hard-blocked from the checklist, whatever the role matrix says
    await authed(token.west)
      .get(`/api/v1/orders/${orderId}/purchase-orders/${po1.body.id}/checklist`)
      .expect(403);

    // ops raises a query (48h warn clock resets) → order back to AWAITING_PO
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/purchase-orders/${po1.body.id}/decision`)
      .send({ action: 'raise_query' })
      .expect(422); // reason missing
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/purchase-orders/${po1.body.id}/decision`)
      .send({ action: 'raise_query', reason: 'PO total differs from the approved quote' })
      .expect(200);
    expect(
      (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
    ).toBe('AWAITING_PO');

    // corrected PO — everything matches
    const po2 = await authed(token.ho).post(`/api/v1/orders/${orderId}/purchase-orders`).send({
      poNumber: 'PO-SF-0902',
      poDate: '2026-11-05',
      externalRef: `QTN-${firstOrderNumber.slice(4)}-v1`,
      poItems: [
        { description: 'Corrugated shipping cartons', quantity: 500, unit: 'pcs', unitRate: 60 },
      ],
      poTotal: 35400,
      taxTotal: 5400,
      paymentTerms: 'Net 30 days',
      expectedDeliveryDate: '2026-12-10',
    }).expect(201);
    const checklist2 = await authed(token.ops)
      .get(`/api/v1/orders/${orderId}/purchase-orders/${po2.body.id}/checklist`)
      .expect(200);
    for (const c of checklist2.body.checks as { matched: boolean | null }[]) {
      expect(c.matched).toBe(true);
    }

    // confirming needs no override remark: nothing mismatched
    const confirmed = await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/purchase-orders/${po2.body.id}/decision`)
      .send({ action: 'confirm' })
      .expect(200);
    expect(confirmed.body.status).toBe('ORDER_CONFIRMED');

    // HO cannot cancel once production-readiness began (settings: clientHoUntil PO_RECEIVED)
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'no longer needed' })
      .expect(409);

    // fulfilment ladder
    for (const action of ['start_production', 'start_qc']) {
      await authed(token.ops)
        .post(`/api/v1/orders/${orderId}/transitions`)
        .send({ action })
        .expect(200);
      expect(
        (await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200)).body.status,
      ).toBe(action === 'start_production' ? 'IN_PRODUCTION' : 'QUALITY_CHECK');
    }

    // dispatch REQUIRE transporter + AWB
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'dispatch' })
      .expect(422);
    const dispatched = await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'dispatch', payload: { transporter: 'BlueDart', awb: 'BD-7712345678' } })
      .expect(200);
    expect(dispatched.body.status).toBe('DISPATCHED');

    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'mark_delivered' })
      .expect(200);
    const final = await authed(token.west).get(`/api/v1/orders/${orderId}`).expect(200);
    expect(final.body.status).toBe('DELIVERED_CLOSED');

    // terminal orders accept nothing at all
    const dead = await authed(token.admin)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'late attempt' })
      .expect(409);
    expect(dead.body.code).toBe('INVALID_STATE');
    expect(dead.body.details.allowedActions).toEqual([]);

    // admin audit trail shows the history
    const audit = await authed(token.admin).get(`/api/v1/orders/${orderId}/audit`).expect(200);
    const actions = (audit.body.auditRecords as { action: string }[]).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'status.approve_requirement',
        'status.submit_quotation',
        'status.approve_quotation',
        'status.upload_po',
        'status.confirm_order',
        'status.start_production',
        'status.mark_delivered',
      ]),
    );
    expect(audit.body.auditRecords.length).toBeGreaterThanOrEqual(10);

    // global audit still admin-only, and now populated
    const global = await authed(token.admin).get('/api/v1/audit?size=5').expect(200);
    expect(global.body.total).toBeGreaterThanOrEqual(10);
    expect(global.body.rows.length).toBe(5);
  });

  it('regional cancels its own fresh order — cancellation rules honoured', async () => {
    const created = await authed(token.west).post('/api/v1/orders').send({
      ...METHOD,
      title: 'Surprise store giveaway bags',
    }).expect(201);
    expect(created.body.orderNumber).toBe(`PRT-${Number(firstOrderNumber.slice(4)) + 1}`);
    const orderId = created.body.id;

    // reason is mandatory at 422
    await authed(token.west)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order' })
      .expect(422);

    const cancelled = await authed(token.west)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'Duplicate submission' })
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    // nothing further fires on a cancelled order
    await authed(token.west)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'again' })
      .expect(409);
  });

  it('ops cannot cancel after its settings window (cancel at QUALITY_CHECK then deny at IN_PRODUCTION)', async () => {
    // build a quick pipeline to IN_PRODUCTION
    const created = await authed(token.west).post('/api/v1/orders').send({
      ...METHOD,
      quantity: 200,
      title: 'Menus for the winter event',
    }).expect(201);
    const orderId = created.body.id;
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'approve' })
      .expect(200);
    const draft = await authed(token.sales).post(`/api/v1/orders/${orderId}/quotations`).expect(201);
    await authed(token.sales).put(`/api/v1/quotations/${draft.body.id}`).send({
      items: [{ ...QUOTE_ITEMS[0], quantity: 200, unitRate: 40, taxRatePct: 12 }],
      paymentTerms: 'Net 15 days',
      deliveryTerms: 'Delivered at Head Office warehouse',
      validityDate: '2026-12-31',
    }).expect(200);
    await authed(token.sales).post(`/api/v1/quotations/${draft.body.id}/submit`).expect(201);
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/quotation-decision`)
      .send({ action: 'approve' })
      .expect(200);
    const po = await authed(token.ho).post(`/api/v1/orders/${orderId}/purchase-orders`).send({
      poNumber: 'PO-SF-0910',
      poDate: '2026-11-08',
      // deliberately wrong reference → exactly one verification mismatch
      externalRef: 'QTN-0000-v0',
      poItems: [
        { description: 'Corrugated shipping cartons', quantity: 200, unit: 'pcs', unitRate: 40 },
      ],
      poTotal: 8960,
      taxTotal: 960,
      paymentTerms: 'Net 15 days',
      expectedDeliveryDate: '2026-12-10',
    }).expect(201);
    // confirm with one mismatch requires an override remark (422 without it)
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/purchase-orders/${po.body.id}/decision`)
      .send({ action: 'confirm' })
      .expect(422);
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/purchase-orders/${po.body.id}/decision`)
      .send({
        action: 'confirm',
        overrideRemark: 'Internal PO reference quoting mismatch; verified offline with client',
      })
      .expect(200);
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'start_production' })
      .expect(200);

    // push deeper: at DISPATCHED the ops window (≤ QUALITY_CHECK) is closed
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'start_qc' })
      .expect(200);
    await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'dispatch', payload: { transporter: 'Delhivery', awb: 'DL-9900112233' } })
      .expect(200);

    // ops cannot cancel after its settings window (≤ QUALITY_CHECK, order is DISPATCHED)
    const denied = await authed(token.ops)
      .post(`/api/v1/orders/${orderId}/transitions`)
      .send({ action: 'cancel_order', reason: 'client pulled out' })
      .expect(409);
    expect(denied.body.code).toBe('INVALID_STATE');

    // …while admin can cancel anywhere pre-delivery
    expect(
      (
        await authed(token.admin)
          .post(`/api/v1/orders/${orderId}/transitions`)
          .send({ action: 'cancel_order', reason: 'Client bankruptcy filing — stop production' })
          .expect(200)
      ).body.status,
    ).toBe('CANCELLED');
  });
});
