import { Entity, PrimaryColumn, ManyToOne, JoinColumn, Unique } from 'typeorm';
import { KolBundle } from './kol-bundle.entity';
import { Scenario } from './scenario.entity';

@Entity('kol_bundle_scenarios')
@Unique(['scenarioId'])
export class KolBundleScenario {
  @PrimaryColumn('uuid', { name: 'bundle_id' })
  bundleId!: string;

  @PrimaryColumn('uuid', { name: 'scenario_id' })
  scenarioId!: string;

  @ManyToOne(() => KolBundle, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bundle_id' })
  bundle!: KolBundle;

  @ManyToOne(() => Scenario, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'scenario_id' })
  scenario!: Scenario;
}
