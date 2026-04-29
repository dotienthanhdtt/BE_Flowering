import { Entity, PrimaryColumn, Column } from 'typeorm';

@Entity('framework_levels')
export class FrameworkLevel {
  @PrimaryColumn({ type: 'varchar', length: 16, name: 'framework_code' })
  frameworkCode!: string;

  @PrimaryColumn({ type: 'varchar', length: 16, name: 'level_code' })
  levelCode!: string;

  @Column({ type: 'text' })
  description!: string;

  @Column({ type: 'int', name: 'order_index' })
  orderIndex!: number;
}
