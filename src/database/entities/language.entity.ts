import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('languages')
export class Language {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 10, unique: true })
  code!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ type: 'varchar', length: 100, name: 'native_name', nullable: true })
  nativeName?: string;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'is_native_available', default: true })
  isNativeAvailable!: boolean;

  @Column({ type: 'boolean', name: 'is_learning_available', default: true })
  isLearningAvailable!: boolean;

  @Column({ type: 'text', name: 'flag_url', nullable: true })
  flagUrl?: string;
}
