import { PersonalizeScenarioDto } from '../dto/personalize-scenario.dto';

export type CompleteResult =
  | {
      kind: 'success';
      scenarios: PersonalizeScenarioDto[];
      generatedNew: boolean;
      quotaRemaining?: number;
    }
  | { kind: 'paywall'; conversationId: string; upsellTo: 'premium_plus' }
  | { kind: 'daily_ceiling' };
