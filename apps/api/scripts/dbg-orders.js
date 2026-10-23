/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.order
  .findMany({
    where: { deletedAt: null },
    select: { orderNumber: true, status: true, statusEnteredAt: true, clientId: true },
  })
  .then((rows) => {
    for (const r of rows) {
      const h = Math.round((Date.now() - r.statusEnteredAt.getTime()) / 3600000);
      console.log(r.orderNumber, r.status, `${h}h`);
    }
  })
  .catch((e) => console.error(e))
  .finally(() => p.$disconnect());
