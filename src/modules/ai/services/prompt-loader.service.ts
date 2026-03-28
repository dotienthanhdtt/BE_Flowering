import { Injectable, Logger } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Service for loading and caching prompt templates from .md files.
 * Supports variable substitution using {{variable}} syntax.
 */
@Injectable()
export class PromptLoaderService {
  private readonly logger = new Logger(PromptLoaderService.name);
  private readonly promptsDir = join(__dirname, '../prompts');
  private cache = new Map<string, string>();

  /**
   * Load a prompt template by name and substitute variables.
   * @param name - The prompt file name without .md extension
   * @param variables - Key-value pairs to substitute in the template
   */
  loadPrompt(name: string, variables: Record<string, string> = {}): string {
    let template = this.cache.get(name);

    if (!template) {
      const jsonPath = join(this.promptsDir, `${name}.json`);
      const mdPath = join(this.promptsDir, `${name}.md`);
      const filePath = existsSync(jsonPath) ? jsonPath : mdPath;
      if (!existsSync(filePath)) {
        this.logger.error(`Prompt file not found: ${filePath}`);
        throw new Error(`Prompt template not found: ${name}`);
      }
      template = readFileSync(filePath, 'utf-8');
      this.cache.set(name, template);
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
