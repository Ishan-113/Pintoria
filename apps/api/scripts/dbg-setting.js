/* eslint-disable no-console */
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.setting
  .findUnique({ where: { key: 'delay_threshold_hours' } })
  .then((row) => {
    console.log('setting row:', JSON.stringify(row));
    const value = row && row.value;
    console.log('default:', value && value.default, 'perStage:', value && JSON.stringify(value.perStage));
  })
  .catch((e) => console.error(e))
  .finally(() => p.$disconnect());
