import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { AuthService } from '../src/auth/auth.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './support';

const DEMO_PASSWORD = 'Printoria@2024';

let app: INestApplication;
let mail: MailService;
let auth: AuthService;
let prisma: PrismaService;

beforeAll(async () => {
  app = await createTestApp();
  mail = app.get(MailService);
  auth = app.get(AuthService);
  prisma = app.get(PrismaService);
});

afterAll(async () => {
  await app.close();
});

describe('Auth flow (checkpoint 1a)', () => {
  it('GET /health is public and reports the DB up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.db).toBe('ok');
  });

  it('rejects unauthenticated access to /auth/me', async () => {
    await request(app.getHttpServer()).get('/api/v1/auth/me').expect(401);
  });

  it('logs in a head-office user with pricing and decision permissions', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ho@sunlightfoods.example', password: DEMO_PASSWORD })
      .expect(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.user.role).toBe('CLIENT_HEAD_OFFICE');
    expect(res.body.user.permissions).toContain('pricing.view');
    expect(res.body.user.permissions).toContain('requirement.decide');
    expect(res.body.user.permissions).toContain('po.upload');
  });

  it('denies a wrong password', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pt.sales@printoria.example', password: 'WrongPassword1' })
      .expect(401);
  });

  it('shows /auth/me with effective permissions', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'regional.west@sunlightfoods.example', password: DEMO_PASSWORD })
      .expect(200);
    expect(login.body.user.role).toBe('CLIENT_REGIONAL');
    expect(login.body.user.permissions).toContain('order.create');
    expect(login.body.user.permissions).not.toContain('pricing.view');
    expect(login.body.user.permissions).not.toContain('profile.edit');

    const me = await request(app.getHttpServer())
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    expect(me.body.email).toBe('regional.west@sunlightfoods.example');
    expect(me.body.permissions).not.toContain('pricing.view');
  });

  it('locks an account after repeated failed logins (429)', async () => {
    const email = 'ho@nimbusretail.example';
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password: 'WrongPassword1' })
        .expect(401);
    }
    const blocked = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email, password: DEMO_PASSWORD })
      .expect(429);
    expect(blocked.body.code).toBe('RATE_LIMITED');
  });

  it('rotates refresh tokens; reusing an old refresh token revokes the family', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'pt.sales@printoria.example', password: DEMO_PASSWORD })
      .expect(200);
    const r1 = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(r1.body.accessToken).toBeTruthy();
    expect(r1.body.refreshToken).not.toBe(login.body.refreshToken);

    // old refresh remembered as rotated → kill everything
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: r1.body.refreshToken })
      .expect(401);
  });

  it('logout revokes the refresh token', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'regional.south@nimbusretail.example', password: DEMO_PASSWORD })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401);
  });

  it('forgot-password answers 202 for any email and mails a working reset link', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@sunlightfoods.example' })
      .expect(202);

    await request(app.getHttpServer())
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'regional.north@sunlightfoods.example' })
      .expect(202);

    const captured = mail.dev.lastMail();
    expect(captured).toBeTruthy();
    expect(captured?.to).toBe('regional.north@sunlightfoods.example');
    const match = /reset-password\?token=([A-Za-z0-9_-]+)/.exec(
      captured?.text ?? '',
    );
    expect(match).toBeTruthy();
    const token = match![1];

    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: 'weak' })
      .expect(400);

    const newPassword = 'Fresh&Strong2026';
    await request(app.getHttpServer())
      .post('/api/v1/auth/reset-password')
      .send({ token, password: newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'regional.north@sunlightfoods.example', password: newPassword })
      .expect(200);
  });

  it('runs the invitation flow end-to-end: info → accept → login', async () => {
    const invited = await prisma.user.findFirstOrThrow({
      where: { email: 'ho2.pending@nimbusretail.example' },
    });
    const admin = await prisma.user.findFirstOrThrow({
      where: { email: 'pt.admin@printoria.example' },
    });

    const invite = await auth.createInvitation(invited.id, admin.id);
    expect(invite.sent).toBe(true);
    const rawToken = /accept-invite\?token=([A-Za-z0-9_-]+)/.exec(invite.devLink ?? '')![1];

    const info = await request(app.getHttpServer())
      .get(`/api/v1/auth/invite/${rawToken}`)
      .expect(200);
    expect(info.body.email).toBe('ho2.pending@nimbusretail.example');
    expect(info.body.clientName).toContain('Nimbus');

    const newPassword = 'Invited@2026x';
    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: rawToken, password: newPassword })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/auth/accept-invite')
      .send({ token: rawToken, password: newPassword })
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: 'ho2.pending@nimbusretail.example', password: newPassword })
      .expect(200);
  });
});
