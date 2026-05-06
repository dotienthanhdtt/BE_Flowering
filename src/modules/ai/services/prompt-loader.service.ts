import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * Service for loading and caching prompt templates from .md and .json files.
 * Supports variable substitution using {{variable}} syntax.
 * All prompt files are eagerly loaded at module init to catch missing files
 * at boot time rather than at first use.
 */
@Injectable()
export class PromptLoaderService implements OnModuleInit {
  private readonly logger = new Logger(PromptLoaderService.name);
  private readonly promptsDir = join(__dirname, '../prompts');
  private cache = new Map<string, string>();

  onModuleInit(): void {
    if (!existsSync(this.promptsDir)) {
      this.logger.warn(`Prompts directory not found: ${this.promptsDir} — skipping eager load`);
      return;
    }

    const files = readdirSync(this.promptsDir).filter(
      (f) => f.endsWith('.md') || f.endsWith('.json'),
    );

    for (const filename of files) {
      const filePath = join(this.promptsDir, filename);
      try {
        const content = readFileSync(filePath, 'utf-8');
        this.cache.set(filename, content);
      } catch (err) {
        this.logger.error(`Failed to load prompt file at boot: ${filePath}`, err);
        throw err;
      }
    }

    this.logger.log(`Prompt cache warm: ${this.cache.size} file(s) loaded`);
  }

  /**
   * Load a prompt template by filename and substitute variables.
   * Cache is pre-warmed at module init; falls back to lazy-read for
   * files added after startup (e.g. hot-reload in dev).
   * @param filename - The prompt file name with extension (e.g. 'correction.md')
   * @param variables - Key-value pairs to substitute in the template
   */
  loadPrompt(filename: string, variables: Record<string, string> = {}): string {
    let template = this.cache.get(filename);

    if (!template) {
      const filePath = join(this.promptsDir, filename);
      if (!existsSync(filePath)) {
        this.logger.error(`Prompt file not found: ${filePath}`);
        throw new Error(`Prompt template not found: ${filename}`);
      }
      template = readFileSync(filePath, 'utf-8');
      this.cache.set(filename, template);
    }

    // Replace {{variable}} placeholders
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }

    return result;
  }

  /**
   * Clear the prompt cache (useful for hot reload in development).
   */
  clearCache(): void {
    this.cache.clear();
    this.logger.log('Prompt cache cleared');
  }
}
