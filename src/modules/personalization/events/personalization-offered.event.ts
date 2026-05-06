export class PersonalizationOfferedEvent {
  constructor(
    public readonly userId: string,
    public readonly scenarioId: string,
  ) {}
}
