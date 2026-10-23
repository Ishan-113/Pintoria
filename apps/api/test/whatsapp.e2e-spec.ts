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
  title: 'WhatsApp opt-in mock gateway cartons',
  itemName: 'Corrugated shipping cartons',
  specification: '3-ply brown, printed logo',
  quantity: 500,
  unit: 'pcs',
  requestedDeliveryDate: '2026-12-15',
};

let app: INestApplication;
let token: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  token = {};
  for (const [key, email] of Object.entries({
    west: 'regional.west@sunlightfoods.example',
    ho: 'ho@sunlightfoods.example',
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
  // leave the seeded alert prefs as we found them — other suites (admin) may
  // run before or after this one, so order-must-not-matter
  await authed(token.ho)
    .put('/api/v1/notifications/prefs')
    .send({ whatsappAlerts: true })
    .catch(() => undefined);
  await app.close();
});

/** WhatsApp feed rows for the regional creator, newest first. */
async function waFeed(t: string): Promise<
  { orderId: string | null; templateKey: string; status: string; toPhone: string | null; lastError: string | null }[]
> {
  const res = await authed(t).get('/api/v1/notifications?take=100').expect(200);
  const rows = res.body as {
    channel: string;
    orderId: string | null;
    templateKey: string;
    status: string;
    toPhone: string | null;
    lastError: string | null;
    queuedAt: string;
  }[];
  return rows
    .filter((r) => r.channel === 'whatsapp')
    .map(({ orderId, templateKey, status, toPhone, lastError }) => ({ orderId, templateKey, status, toPhone, lastError }));
}

describe('WhatsApp mock gateway (checkpoint 2c)', () => {
  it('flips the fan-out rows to SENT when the client opts in and recipients have phones', async () => {
    // HO turns WhatsApp alerts on for Sunlight Foods
    await authed(token.ho).put('/api/v1/notifications/prefs').send({ whatsappAlerts: true }).expect(200);

    // regional submits → HO approves → the regional creator should hear about it
    const created = await authed(token.west).post('/api/v1/orders').send(METHOD).expect(201);
    const orderId = created.body.id;
    expect(created.body.status).toBe('SUBMITTED');

    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'approve' })
      .expect(200);

    const rows = await waFeed(token.west);
    // scope to THIS order — earlier suites may already have whatsapp rows with
    // the same template key in the shared feed
    const approved = rows.find((r) => r.orderId === orderId && r.templateKey === 'requirement.approved');
    expect(approved).toBeTruthy();
    expect(approved?.status).toBe('SENT');
    expect(approved?.toPhone).toBe('+91 90040 55661');
  });

  it('sends nothing when the client turns WhatsApp alerts back off', async () => {
    await authed(token.ho).put('/api/v1/notifications/prefs').send({ whatsappAlerts: false }).expect(200);

    const created = await authed(token.west).post('/api/v1/orders').send(METHOD).expect(201);
    const orderId = created.body.id;

    // a second order goes to RETURNED — recipients (regional + HO) get email only
    await authed(token.ho)
      .post(`/api/v1/orders/${orderId}/requirement-decision`)
      .send({ action: 'return', reason: 'Spec still missing the kraft gsm' })
      .expect(200);

    const rows = await waFeed(token.west);
    expect(rows.some((r) => r.orderId === orderId && r.templateKey === 'requirement.returned')).toBe(false);
  });
});
