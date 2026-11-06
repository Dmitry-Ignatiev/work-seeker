export class AiBudgetExceededError extends Error {
  constructor(
    readonly used: number,
    readonly limit: number,
  ) {
    super(`Daily AI budget reached (${used.toLocaleString()} of ${limit.toLocaleString()} tokens). Try again tomorrow.`);
    this.name = 'AiBudgetExceededError';
  }
}

export class AiConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiConfigError';
  }
}
