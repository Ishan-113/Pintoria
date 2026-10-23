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
  title: 'Studio spec pack uploads',
  itemName: 'Diwali gift box',
  specification: '4c printed rigid box, 220 gsm',
  quantity: 200,
  unit: 'pcs',
  requestedDeliveryDate: '2026-12-20',
};

let app: INestApplication;
const token: Record<string, string> = {};

beforeAll(async () => {
  app = await createTestApp();
  for (const [key, email] of Object.entries({
    admin: 'pt.admin@printoria.example',
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
  };
};

afterAll(async () => {
  await app.close();
});

let orderId = '';

describe('File uploads (checkpoint 2a)', () => {
  it('regional uploads a requirement spec and gets it back with checksum and CLEAN scan', async () => {
    const created = await authed(token.west).post('/api/v1/orders').send(METHOD).expect(201);
    orderId = created.body.id as string;

    const up = await authed(token.west)
      .post('/api/v1/files/upload')
      .field('entityType', 'ORDER')
      .field('entityId', orderId)
      .field('kind', 'requirement_spec')
      .attach('file', Buffer.from('spec sheet content v1'), 'spec-sheet.pdf')
      .expect(201);
    expect(up.body.kind).toBe('requirement_spec');
    expect(up.body.originalName).toBe('spec-sheet.pdf');
    expect(up.body.scanStatus).toBe('CLEAN');
    expect(up.body.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(up.body.sizeBytes).toBeGreaterThan(0);
  });

  it('the same order lists the file; download round-trips the exact bytes', async () => {
    const list = await authed(token.west).get(`/api/v1/files/orders/${orderId}`).expect(200);
    expect(list.body.files).toHaveLength(1);
    const fileId = list.body.files[0].id as string;

    const dl = await authed(token.west).get(`/api/v1/files/${fileId}/download`).expect(200);
    expect(dl.body.toString()).toBe('spec sheet content v1');
  });

  it('cross-tenant download is a 404 (south cannot touch a west file)', async () => {
    const list = await authed(token.west).get(`/api/v1/files/orders/${orderId}`).expect(200);
    const fileId = list.body.files[0].id as string;
    const res = await authed(token.south).get(`/api/v1/files/${fileId}/download`).expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('uploads reject unlisted extensions with 415', async () => {
    await authed(token.west)
      .post('/api/v1/files/upload')
      .field('entityType', 'ORDER')
      .field('entityId', orderId)
      .field('kind', 'reference')
      // .exe is not on the allowlist
      .attach('file', Buffer.from('%EXE fake'), 'drop.exe')
      .expect(415);
  });

  it('PO documents uploaded by HO are invisible to regional users', async () => {
    // advance order to a state where PO paperwork matters — cheaper: HO attaches
    // a po_document against the order directly; regional must never read it
    const up = await authed(token.ho)
      .post('/api/v1/files/upload')
      .field('entityType', 'ORDER')
      .field('entityId', orderId)
      .field('kind', 'po_document')
      .attach('file', Buffer.from('signed PO scan'), 'po-scan.pdf')
      .expect(201);
    const poFileId = up.body.id as string;

    // HO sees both documents
    const listHo = await authed(token.ho).get(`/api/v1/files/orders/${orderId}`).expect(200);
    expect(listHo.body.files.map((f: { kind: string }) => f.kind)).toEqual(
      expect.arrayContaining(['po_document', 'requirement_spec']),
    );
    // regional list hides it, download is a hard 403
    const listRegional = await authed(token.west).get(`/api/v1/files/orders/${orderId}`).expect(200);
    expect(listRegional.body.files.map((f: { kind: string }) => f.kind)).toEqual(['requirement_spec']);
    await authed(token.west).get(`/api/v1/files/${poFileId}/download`).expect(403);
  });

  it('upload without a file part is a clean 400, not a crash', async () => {
    const res = await authed(token.west)
      .post('/api/v1/files/upload')
      .field('entityType', 'ORDER')
      .field('entityId', orderId)
      .field('kind', 'reference')
      .expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('upload against another client’s order is a silent 404', async () => {
    const res = await authed(token.south)
      .post('/api/v1/files/upload')
      .field('entityType', 'ORDER')
      .field('entityId', orderId)
      .field('kind', 'reference')
      .attach('file', Buffer.from('nope'), 'nope.pdf')
      .expect(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});
