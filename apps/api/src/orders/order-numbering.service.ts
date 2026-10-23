import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Global sequential order numbers (PRT-1009, PRT-1010, ...).
 * The increment happens inside the caller's transaction so two concurrent
 * creations can never receive the same number.
 */
@Injectable()
export class OrderNumberingService {
  async next(tx: Prisma.TransactionClient, prefix = 'PRT'): Promise<string> {
    try {
      const seq = await tx.orderNumberSequence.update({
        where: { name: 'order_number' },
        data: { lastValue: { increment: 1 } },
      });
      return `${prefix}-${seq.lastValue}`;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        const seq = await tx.orderNumberSequence.create({ data: { name: 'order_number', lastValue: 1001 } });
        return `${prefix}-${seq.lastValue}`;
      }
      throw err;
    }
  }
}
