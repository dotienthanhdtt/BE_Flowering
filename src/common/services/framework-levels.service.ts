import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FrameworkLevel } from '@/database/entities/framework-level.entity';

export interface FrameworkLevelDescriptor {
  code: string;
  description: string;
}

interface LanguageEntry {
  frameworkCode: string;
  levels: FrameworkLevelDescriptor[];
}

@Injectable()
export class FrameworkLevelsService implements OnModuleInit {
  private readonly logger = new Logger(FrameworkLevelsService.name);
  private byLanguage = new Map<string, LanguageEntry>();
  private byKey = new Map<string, string>(); // `${languageId}:${levelCode}` -> description

  constructor(
    @InjectRepository(FrameworkLevel)
    private readonly repo: Repository<FrameworkLevel>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const rows = await this.repo.find({ order: { languageId: 'ASC', orderIndex: 'ASC' } });
    const byLanguage = new Map<string, LanguageEntry>();
    const byKey = new Map<string, string>();
    for (const row of rows) {
      let entry = byLanguage.get(row.languageId);
      if (!entry) {
        entry = { frameworkCode: row.frameworkCode, levels: [] };
        byLanguage.set(row.languageId, entry);
      }
      entry.levels.push({ code: row.levelCode, description: row.description });
      byKey.set(`${row.languageId}:${row.levelCode}`, row.description);
    }
    this.byLanguage = byLanguage;
    this.byKey = byKey;
    this.logger.log(`Loaded ${rows.length} framework_levels rows for ${byLanguage.size} languages`);
  }

  getLevels(languageId: string | null | undefined): FrameworkLevelDescriptor[] {
    if (!languageId) return [];
    return this.byLanguage.get(languageId)?.levels ?? [];
  }

  getDescription(languageId: string | null | undefined, level: string | null | undefined): string {
    if (!languageId || !level) return '';
    return this.byKey.get(`${languageId}:${level}`) ?? '';
  }

  getFrameworkCode(languageId: string | null | undefined): string | null {
    if (!languageId) return null;
    return this.byLanguage.get(languageId)?.frameworkCode ?? null;
  }
}
