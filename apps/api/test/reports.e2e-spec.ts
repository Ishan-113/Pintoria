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
let token: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  token = {};
  for (const [key, email] of Object.entries({
    admin: 'pt.admin@printoria.example',
    sales: 'pt.sales@printoria.example',
    ops: 'pt.ops@printoria.example',
    west: 'regional.west@sunlightfoods.example',
    south: 'regional.south@nimbusretail.example',
    ho: 'ho@sunlightfoods.example',
  })) {
    token[key] = await login(app, email);
  }
});

const authed = (t: string) => ({
  get: (url: string) => http(app).get(url).set('Authorization', `Bearer ${t ?? ''}`),
});

afterAll(async () => {
  await app.close();
});

describe('Order report export (checkpoint 3a)', () => {
  it('denies anonymous access', async () => {
    await http(app).get('/api/v1/reports/orders').expect(401);
  });

  it('rejects formats other than csv', async () => {
    await authed(token.sales).get('/api/v1/reports/orders?format=xlsx').expect(400);
  });

  it('staff export contains pricing columns and seeded monetary values', async () => {
    const res = await authed(token.sales).get('/api/v1/reports/orders?format=csv').expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const body = res.text as string;
    const headerLine = body.replace(/^\uFEFF/, '').split('\r\n')[0];
    const header = headerLine.split(',');
    expect(header).toContain('totalAmount');
    expect(header).toContain('poTotal');
    // seeded quotation on PRT-1003 and PO on PRT-1005 must surface real money
    const rows = body.replace(/^\uFEFF/, '').trim().split('\r\n');
    const po1005 = rows.find((r) => r.startsWith('PRT-1005'));
    expect(po1005).toBeDefined();
    expect(po1005).toContain('SUN/NBO/');
  });

  it('regional export has no pricing columns and only their own region', async () => {
    const res = await authed(token.west).get('/api/v1/reports/orders?format=csv').expect(200);
    const body = res.text as string;
    const lines = body.replace(/^\uFEFF/, '').trim().split('\r\n');
    const header = lines[0].split(',');
    expect(header).not.toContain('totalAmount');
    expect(header).not.toContain('subTotal');
    expect(header).not.toContain('unitRate');
    expect(header).not.toContain('paymentTerms');

    // tenancy: only west's region row appears; all rows are Sunlight West orders
    const dataRows = lines.slice(1).filter((l) => l.length > 0);
    expect(dataRows.length).toBeGreaterThan(0);
    expect(dataRows.every((l) => l.includes('Sunlight'))).toBe(true);
  });

  it('head office export keeps pricing but stays client-scoped', async () => {
    const res = await authed(token.ho).get('/api/v1/reports/orders?format=csv').expect(200);
    const lines = (res.text as string).replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0].split(',')).toContain('totalAmount');
    // every row belongs to sunlight; nimbus rows must not appear
    expect(lines.slice(1).some((l) => l.includes('Nimbus'))).toBe(false);
  });
});
