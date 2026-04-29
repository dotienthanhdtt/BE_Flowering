import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Language } from '../../database/entities/language.entity';
import { FrameworkLevel } from '../../database/entities/framework-level.entity';
import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
  registerDecorator,
  ValidationOptions,
} from 'class-validator';
import { DataSource } from 'typeorm';

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

    const lang = await this.dataSource
      .getRepository(Language)
      .createQueryBuilder('lang')
      .select('lang.level_framework', 'levelFramework')
      .where('lang.id = :id', { id: languageId })
      .getRawOne<{ levelFramework: string | null }>();

    if (!lang || !lang.levelFramework) return true; // unknown lang or frameworkless — let DB / other validators handle

    const exists = await this.dataSource.getRepository(FrameworkLevel).findOne({
      where: { frameworkCode: lang.levelFramework, levelCode: value },
    });
    return !!exists;
  }

  defaultMessage(args: ValidationArguments): string {
    return `Invalid level '${args.value}' for the selected language`;
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
