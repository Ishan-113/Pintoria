/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
(async () => {
  const prefs = await p.clientNotificationPrefs.findMany();
  console.log('prefs:', JSON.stringify(prefs.map((x) => [x.clientId.slice(0, 8), x.emailAlerts, x.whatsappAlerts, x.dailyPendingReminder])));
  const users = await p.user.findMany({
    where: { role: 'CLIENT_HEAD_OFFICE' },
    select: { email: true, status: true, deletedAt: true, clientId: true },
  });
  console.log('HO users:', JSON.stringify(users.map((u) => [u.email, u.status, u.deletedAt !== null])));
  const orders = await p.order.findMany({ where: { deletedAt: null }, select: { orderNumber: true, status: true } });
  console.log('open-ish:', JSON.stringify(orders));
  const set = await p.setting.findUnique({ where: { key: 'notifications' } });
  console.log('notif settings:', JSON.stringify(set && set.value));
})().catch((e) => console.error(e)).finally(() => p.$disconnect());
