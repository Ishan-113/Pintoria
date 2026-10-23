import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';

@ApiTags('system')
@Controller('health')
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** Render/Docker health probe; 503 when the database is unreachable. */
  @Public()
  @Get()
  async check(): Promise<{ status: string; db: string; uptime: number }> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Database is unreachable.');
    }
    return { status: 'ok', db: 'ok', uptime: Math.round(process.uptime()) };
  }
}
