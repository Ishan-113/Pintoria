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

let app: INestApplication;
const token: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  for (const [key, email] of Object.entries({
    admin: 'pt.admin@printoria.example',
    ho: 'ho@sunlightfoods.example',
    sales: 'pt.sales@printoria.example',
  })) {
    token[key] = await login(app, email);
  }
});

const authed = (t: string) => ({
  get: (url: string) => http(app).get(url).set('Authorization', `Bearer ${t ?? ''}`),
  post: (url: string) => http(app).post(url).set('Authorization', `Bearer ${t ?? ''}`),
});

afterAll(async () => {
  await app.close();
});

describe('Pg-boss reminders (checkpoint 2b)', () => {
  it('non-admins cannot trigger the reminder run', async () => {
    await authed(token.sales).post('/api/v1/notifications/reminders/run').expect(403);
    await authed(token.ho).post('/api/v1/notifications/reminders/run').expect(403);
    await http(app).post('/api/v1/notifications/reminders/run').expect(401);
  });

  it('admin run sends digests to HO + staff and overdue nudges, then honours the ~daily dedupe', async () => {
    const first = await authed(token.admin).post('/api/v1/notifications/reminders/run').expect(200);
    // seeded test data guarantees at least one HO digest and >0 overdue orders
    expect(first.body.digestsSent).toBeGreaterThan(0);
    expect(first.body.remindersSent).toBeGreaterThan(0);

    // sunlight's HO had a seeded open queue, so it was digested
    const feed = await authed(token.ho).get('/api/v1/notifications?take=100').expect(200);
    const rows = feed.body as { templateKey: string; status: string }[];
    expect(rows.filter((r) => r.templateKey === 'daily_digest' && r.status === 'SENT').length).toBeGreaterThan(0);

    const second = await authed(token.admin).post('/api/v1/notifications/reminders/run').expect(200);
    // nudges dedupe inside the ~20h window; digests always fire again
    expect(second.body.remindersSent).toBe(0);
    expect(second.body.digestsSent).toBeGreaterThan(0);
  });

  it('the notifications feed stays a plain array for every user', async () => {
    const feed = await authed(token.admin).get('/api/v1/notifications?take=10').expect(200);
    expect(feed.body).toBeInstanceOf(Array);
  });
});
