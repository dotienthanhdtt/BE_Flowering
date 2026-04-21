import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Language } from '../../database/entities/language.entity';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { DataSource } from 'typeorm';
import { isValidLevel, LANGUAGE_FRAMEWORKS, FrameworkCode } from '../constants/language-levels';

@ValidatorConstraint({ async: true })
@Injectable()
export class IsValidLevelForLanguageConstraint implements ValidatorConstraintInterface {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async validate(value: unknown, args: ValidationArguments): Promise<boolean> {
    if (typeof value !== 'string') return false;

    const languageIdField = args.constraints[0] as string;
    const dto = args.object as Record<string, unknown>;
    const languageId = dto[languageIdField];

    if (!languageId || typeof languageId !== 'string') return true; // let @IsUUID catch it

    const row = await this.dataSource
      .getRepository(Language)
      .createQueryBuilder('lang')
      .select('lang.level_framework', 'levelFramework')
      .where('lang.id = :id', { id: languageId })
      .getRawOne<{ levelFramework: string | null }>();

    if (!row) return true; // language not found — let other validators handle it

    const framework = row.levelFramework as FrameworkCode | null;
    if (!framework) return true; // frameworkless language (vi/th) — any string accepted

    return isValidLevel(framework, value);
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as Record<string, unknown>;
    const languageIdField = args.constraints[0] as string;
    const _ = dto[languageIdField]; // unused; message is generic until framework known
    void _;
    return `Invalid level '${args.value}' for the selected language. Valid values per framework: CEFR: ${LANGUAGE_FRAMEWORKS.CEFR.join(', ')} | JLPT: ${LANGUAGE_FRAMEWORKS.JLPT.join(', ')} | HSK: ${LANGUAGE_FRAMEWORKS.HSK.join(', ')} | TOPIK: ${LANGUAGE_FRAMEWORKS.TOPIK.join(', ')}`;
  }
}

export function IsValidLevelForLanguage(
  languageIdField: string,
  validationOptions?: ValidationOptions,
) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options: validationOptions,
      constraints: [languageIdField],
      validator: IsValidLevelForLanguageConstraint,
    });
  };
}
