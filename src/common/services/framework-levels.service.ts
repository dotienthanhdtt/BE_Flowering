import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FrameworkLevel } from '@/database/entities/framework-level.entity';

export interface FrameworkLevelDescriptor {
  code: string;
  description: string;
}

@Injectable()
export class FrameworkLevelsService implements OnModuleInit {
  private readonly logger = new Logger(FrameworkLevelsService.name);
  private byFramework = new Map<string, FrameworkLevelDescriptor[]>();
  private byKey = new Map<string, string>(); // `${framework}:${level}` -> description

  constructor(
    @InjectRepository(FrameworkLevel)
    private readonly repo: Repository<FrameworkLevel>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.repo.find({ order: { frameworkCode: 'ASC', orderIndex: 'ASC' } });
    const byFramework = new Map<string, FrameworkLevelDescriptor[]>();
    const byKey = new Map<string, string>();
    for (const row of rows) {
      const list = byFramework.get(row.frameworkCode) ?? [];
      list.push({ code: row.levelCode, description: row.description });
      byFramework.set(row.frameworkCode, list);
      byKey.set(`${row.frameworkCode}:${row.levelCode}`, row.description);
    }
    this.byFramework = byFramework;
    this.byKey = byKey;
    this.logger.log(`Loaded ${rows.length} framework_levels rows`);
  }

  getLevels(framework: string | null | undefined): FrameworkLevelDescriptor[] {
    if (!framework) return [];
    return this.byFramework.get(framework) ?? [];
  }

  getDescription(framework: string | null | undefined, level: string | null | undefined): string {
    if (!framework || !level) return '';
    return this.byKey.get(`${framework}:${level}`) ?? '';
  }
}
