import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './support';

const DEMO_PASSWORD = 'Printoria@2024';

const http = (app: INestApplication) => request(app.getHttpServer());

async function login(app: INestApplication, email: string, password = DEMO_PASSWORD) {
  const res = await http(app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect((r) => {
      if (r.status !== 200) throw new Error(`login(${email}) â†’ ${r.status} ${JSON.stringify(r.body)}`);
    });
  return res.body.accessToken as string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The email send is best-effort and completes just after the workflow tx commits. */
async function waitUntilEmailsSent(
  t: string,
  orderId: string,
  match: (n: { templateKey: string; channel: string; recipientId: string; status: string }) => boolean,
): Promise<
  { recipientId: string; templateKey: string; channel: string; status: string; toAddress: string | null }[]
> {
  const deadline = Date.now() + 3000;
  let rows: { recipientId: string; templateKey: string; channel: string; status: string; toAddress: string | null }[] = [];
  while (Date.now() < deadline) {
    await sleep(300);
    const feed = await authed(t).get(`/api/v1/notifications?orderId=${orderId}`).expect(200);
    rows = feed.body;
    if (rows.some((n) => match(n) && n.status === 'SENT')) return rows;
  }
  return rows;
}

let app: INestApplication;
let token: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  token = {
    admin: await login(app, 'pt.admin@printoria.example'),
    sales: await login(app, 'pt.sales@printoria.example'),
    ops: await login(app, 'pt.ops@printoria.example'),
    west: await login(app, 'regional.west@sunlightfoods.example'),
    ho: await login(app, 'ho@sunlightfoods.example'),
  };
});

const authed = (t: string | undefined) => {
  const hdr = `Bearer ${t ?? ''}`;
  return {
    get: (url: string) => http(app).get(url).set('Authorization', hdr),
    post: (url: string) => http(app).post(url).set('Authorization', hdr),
    put: (url: string) => http(app).put(url).set('Authorization', hdr),
    delete: (url: string) => http(app).delete(url).set('Authorization', hdr),
  };
};

afterAll(async () => {
  await app.close();
});

describe('Admin CRUD (checkpoint 1c)', () => {
  it('locks everyone but Printoria admin out of the admin back office', async () => {
    await authed(token.sales).get('/api/v1/admin/clients').expect(403);
    await authed(token.west).get('/api/v1/admin/clients').expect(403);
    await authed(token.ho).get('/api/v1/admin/users').expect(403);
  });

  it('manages clients end-to-end (list, create, duplicate code 409, update, guarded delete)', async () => {
    const list = await authed(token.admin).get('/api/v1/admin/clients').expect(200);
    expect(list.body.length).toBe(2);
    const sunlight = list.body.find((c: { code: string }) => c.code === 'SUNLIGHT');
    expect(sunlight.regionCount).toBeGreaterThanOrEqual(2);
    expect(sunlight.orderCount).toBeGreaterThanOrEqual(6);

    await authed(token.admin).post('/api/v1/admin/clients').send({
      name: 'Vertex Stationery World',
      code: 'VERTEX',
      industry: 'Office supplies',
      city: 'Pune',
    }).expect(201);

    const dupe = await authed(token.admin).post('/api/v1/admin/clients').send({
      name: 'Another Vertex',
      code: 'VERTEX',
    }).expect(409);
    expect(dupe.body.code).toBe('CONFLICT');

    const refreshed = await authed(token.admin).get('/api/v1/admin/clients?q=vertex').expect(200);
    expect(refreshed.body).toHaveLength(1);
    const vertex = refreshed.body[0];
    expect(vertex.industry).toBe('Office supplies');

    await authed(token.admin).put(`/api/v1/admin/clients/${vertex.id}`).send({
      paymentTerms: 'Net 45 days',
    }).expect(200);

    // seeded client still carries orders â€” deletion must be refused
    await authed(token.admin)
      .delete(`/api/v1/admin/clients/${sunlight.id}`)
      .expect(409);

    // fresh client without orders can be deleted
    const temp = await authed(token.admin).post('/api/v1/admin/clients').send({
      name: 'Temp Disposable Co',
      code: 'TEMP',
    }).expect(201);
    await authed(token.admin).delete(`/api/v1/admin/clients/${temp.body.id}`).expect(200);
    const afterDelete = await authed(token.admin).get('/api/v1/admin/clients?q=TEMP').expect(200);
    expect(afterDelete.body).toHaveLength(0);
  });

  it('manages regions under a client (create, duplicate, update, delete)', async () => {
    const clients = await authed(token.admin).get('/api/v1/admin/clients?q=vertex').expect(200);
    const vertex = clients.body[0];

    const created = await authed(token.admin).post('/api/v1/admin/regions').send({
      clientId: vertex.id,
      name: 'North India',
      code: 'NRD',
      city: 'Lucknow',
    }).expect(201);

    await authed(token.admin).post('/api/v1/admin/regions').send({
      clientId: vertex.id,
      name: 'North again',
      code: 'NRD',
    }).expect(409);

    await authed(token.admin).put(`/api/v1/admin/regions/${created.body.id}`).send({
      managerName: 'Kavita Rao',
      managerEmail: 'kavita.rao@vertex.example',
    }).expect(200);

    await authed(token.admin).delete(`/api/v1/admin/regions/${created.body.id}`).expect(200);
  });

  it('invites, accepts, suspends and re-invites users through the admin flow', async () => {
    const clients = await authed(token.admin).get('/api/v1/admin/clients?q=vertex').expect(200);
    const vertex = clients.body[0];
    const regions = await authed(token.admin).get(`/api/v1/admin/regions?clientId=${vertex.id}`).expect(200);
    // recreate the deleted region so a regional user can be attached
    const region = regions.body.length > 0
      ? regions.body[0] as { id: string }
      : ((await authed(token.admin).post('/api/v1/admin/regions').send({
          clientId: vertex.id,
          name: 'North India',
          code: 'NRD',
        }).expect(201)).body as { id: string });

    // regional user without region â†’ 400
    await authed(token.admin).post('/api/v1/admin/users').send({
      email: 'orphan@vertex.example',
      fullName: 'Orphan Regional',
      role: 'CLIENT_REGIONAL',
      clientId: vertex.id,
    }).expect(400);

    // hard rule: regional can never be granted pricing view
    const leaky = await authed(token.admin).post('/api/v1/admin/users').send({
      email: 'reg.north@vertex.example',
      fullName: 'Reena North',
      role: 'CLIENT_REGIONAL',
      clientId: vertex.id,
      regionId: region.id,
      pricingView: true,
    }).expect(201);
    expect(leaky.body.pricingView).toBe(false);
    expect(leaky.body.status).toBe('PENDING');
    expect(leaky.body.invitation.devLink).toContain('/accept-invite?token=');

    // duplicate email â†’ 409
    await authed(token.admin).post('/api/v1/admin/users').send({
      email: 'reg.north@vertex.example',
      fullName: 'Reena Again',
      role: 'CLIENT_REGIONAL',
      clientId: vertex.id,
      regionId: region.id,
    }).expect(409);

    // a second user stays pending (dashboard test depends on this)
    const pendingUser = await authed(token.admin).post('/api/v1/admin/users').send({
      email: 'reg.south@vertex.example',
      fullName: 'Sameer South',
      role: 'CLIENT_REGIONAL',
      clientId: vertex.id,
      regionId: region.id,
    }).expect(201);

    // accept the first invitation, prove login works
    const inviteToken = /token=([A-Za-z0-9_-]+)/.exec(leaky.body.invitation.devLink)![1];
    await authed(undefined).get(`/api/v1/auth/invite/${inviteToken}`).expect(200);
    await authed(undefined).post('/api/v1/auth/accept-invite').send({
      token: inviteToken,
      password: 'Vertex@Accept2026',
    }).expect(200);
    await login(app, 'reg.north@vertex.example', 'Vertex@Accept2026');

    // suspend â†’ login blocked with a friendly message
    await authed(token.admin).put(`/api/v1/admin/users/${leaky.body.id}`).send({
      status: 'SUSPENDED',
    }).expect(200);
    await http(app)
      .post('/api/v1/auth/login')
      .send({ email: 'reg.north@vertex.example', password: 'Vertex@Accept2026' })
      .expect(403);

    // hard rule enforcement on update too
    await authed(token.admin)
      .put(`/api/v1/admin/users/${leaky.body.id}`)
      .send({ pricingView: true })
      .expect(403);

    // resend invite for the still-pending user
    const resend = await authed(token.admin)
      .post(`/api/v1/admin/users/${pendingUser.body.id}/resend-invite`)
      .expect(200);
    expect(resend.body.sent).toBe(true);

    // an ACTIVE user cannot be re-invited
    await authed(token.admin)
      .post(`/api/v1/admin/users/${leaky.body.id}/resend-invite`)
      .expect(400);
  });
});

describe('Role-aware dashboards (checkpoint 1c)', () => {
  it('west regional sees my-region counts, recent orders and delayed orders', async () => {
    const dash = await authed(token.west).get('/api/v1/dashboard').expect(200);
    expect(typeof dash.body.countsByStatus).toBe('object');
    expect(Array.isArray(dash.body.recentOrders)).toBe(true);
    expect(dash.body.recentOrders.length).toBeLessThanOrEqual(5);
    // the seeded demo orders sat in DV stages for days â†’ delays must fire
    expect(dash.body.delayedOrders.length).toBeGreaterThan(0);
    for (const d of dash.body.delayedOrders) {
      expect(d).toEqual(
        expect.objectContaining({
          orderNumber: expect.any(String),
          overlyByHours: expect.any(Number),
          thresholdHours: expect.any(Number),
        }),
      );
    }
  });

  it('sales and ops see their own queue counters', async () => {
    const sales = await authed(token.sales).get('/api/v1/dashboard').expect(200);
    expect(sales.body.quotationsAwaitingDecision).toBeGreaterThanOrEqual(0);

    const ops = await authed(token.ops).get('/api/v1/dashboard').expect(200);
    expect(ops.body.posPendingVerification).toBeGreaterThanOrEqual(0);
  });

  it('admin sees system stats including pending invitations', async () => {
    const dash = await authed(token.admin).get('/api/v1/dashboard').expect(200);
    expect(dash.body.pendingInvites).toBeGreaterThanOrEqual(1);
    expect(dash.body.clientCount).toBeGreaterThanOrEqual(2);
  });
});

describe('Notifications (checkpoint 1c)', () => {
  it('head office reads and updates client alert prefs; regional cannot', async () => {
    const prefs = await authed(token.ho).get('/api/v1/notifications/prefs').expect(200);
    expect(prefs.body.emailAlerts).toBe(true);
    expect(prefs.body.whatsappAlerts).toBe(true);

    await authed(token.west).put('/api/v1/notifications/prefs').send({
      emailAlerts: false,
    }).expect(403);

    await authed(token.ho).put('/api/v1/notifications/prefs').send({
      whatsappAlerts: false,
      dailyPendingReminder: false,
    }).expect(200);
    const after = await authed(token.ho).get('/api/v1/notifications/prefs').expect(200);
    expect(after.body.whatsappAlerts).toBe(false);
    expect(after.body.dailyPendingReminder).toBe(false);
  });

  it('workflow transitions fan out notification log rows with sent emails', async () => {
    // restore/keep whatsapp on so the parked-channel rows get created, and keep
    // the daily digest enabled for whoever runs right after this suite
    await authed(token.ho).put('/api/v1/notifications/prefs').send({
      emailAlerts: true,
      whatsappAlerts: true,
      dailyPendingReminder: true,
    }).expect(200);

    const created = await authed(token.west).post('/api/v1/orders').send({
      title: 'Notification testing cartons',
      itemName: 'Corrugated shipping cartons',
      specification: '3-ply brown',
      quantity: 120,
      unit: 'pcs',
      requestedDeliveryDate: '2027-02-01',
    }).expect(201);
    const orderId = created.body.id as string;
    const creatorId = (await authed(token.west).get('/api/v1/auth/me').expect(200)).body.id as string;

    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'approve' })
      .expect(200);

    const feed = await waitUntilEmailsSent(token.admin, orderId, (n) => n.recipientId === creatorId);
    const approvedRows = (feed as {
      recipientId: string;
      templateKey: string;
      channel: string;
      status: string;
      toAddress: string | null;
    }[]).filter((n) => n.templateKey === 'requirement.approved' && n.channel === 'email');
    expect(approvedRows.length).toBeGreaterThanOrEqual(1);
    for (const row of approvedRows) {
      expect(row.channel).toBe('email');
      expect(row.status).toBe('SENT');
      expect(row.toAddress).toBeTruthy();
    }
    expect(approvedRows.some((n) => n.recipientId === creatorId)).toBe(true);

    // whatsapp restored on → a parked whatsapp row per recipient (channel deferred)
    expect(feed.some((n: { channel: string }) => n.channel === 'whatsapp')).toBe(true);

    // my feed: the regional creator sees the notification addressed to them
    const mine = await authed(token.west).get('/api/v1/notifications').expect(200);
    expect(
      (mine.body as { templateKey: string }[]).some((n) => n.templateKey === 'requirement.approved'),
    ).toBe(true);
  });

  it('critical alerts bypass muted email prefs', async () => {
    // mute email for sunlight foods
    await authed(token.ho).put('/api/v1/notifications/prefs').send({ emailAlerts: false }).expect(200);

    const created = await authed(token.west).post('/api/v1/orders').send({
      title: 'Critical bypass cartons',
      itemName: 'Kraft mailers',
      specification: 'Plain kraft 4x6',
      quantity: 900,
      unit: 'pcs',
      requestedDeliveryDate: '2027-03-01',
    }).expect(201);
    const orderId = created.body.id as string;
    const creatorId = (await authed(token.west).get('/api/v1/auth/me').expect(200)).body.id as string;

    // return_for_clarification is CRITICAL â†’ must still send an email
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'return', reason: 'Color codes missing from artwork brief' })
      .expect(200);

    const emailed = (await waitUntilEmailsSent(token.admin, orderId, (n) => n.recipientId === creatorId)).filter(
      (n) => n.channel === 'email' && n.recipientId === creatorId,
    );
    expect(emailed.length).toBeGreaterThanOrEqual(1);
    for (const row of emailed) {
      expect(row.templateKey).toBe('requirement.returned');
      expect(row.status).toBe('SENT');
    }

    // restore prefs for the record
    await authed(token.ho).put('/api/v1/notifications/prefs').send({ emailAlerts: true }).expect(200);
  });
});
