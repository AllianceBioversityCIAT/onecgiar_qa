import { ConsoleLogger, Logger } from '@nestjs/common';

const LEVELS = ['log', 'warn', 'error', 'debug', 'verbose', 'fatal'] as const;

/**
 * Everything any logger, and `console`, was asked to print during a test.
 * Shared by the NFR-2 log spies (`users-admin-privacy`, and the keyed-write
 * suite `users-admin-idempotency-privacy`): a spy on one logger is not evidence.
 */
export class LogSpy {
  readonly lines: string[] = [];
  private readonly sink = Object.fromEntries(
    LEVELS.map((level) => [
      level,
      (...args: unknown[]) => void this.lines.push(this.text(args)),
    ]),
  );

  private text(args: unknown[]): string {
    return args
      .map((arg) =>
        typeof arg === 'string' ? arg : (JSON.stringify(arg) ?? String(arg)),
      )
      .join(' ');
  }

  /** Call AFTER the app is built: `Test.compile()` installs its own logger. */
  attach(): void {
    // Every `Logger` instance (services, filter, clients, the interceptor) ...
    for (const level of LEVELS) {
      const record = (...args: unknown[]) => {
        this.lines.push(this.text(args));
      };
      vi.spyOn(Logger.prototype, level).mockImplementation(record);
    }
    // ... the static logger (`Logger.log(...)`) and whatever Nest delegates to ...
    Logger.overrideLogger(this.sink as never);
    // ... and `console` (a stray `console.log` would bypass Nest entirely).
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        this.lines.push(this.text(args));
      });
    }
  }

  detach(): void {
    Logger.overrideLogger(new ConsoleLogger());
  }

  /** The JSON lines of one `event` (`users_admin`, `idempotency`) for one request. */
  eventsOf(event: string, requestId: string): Array<Record<string, unknown>> {
    return this.lines
      .filter((l) => l.includes(`"event":"${event}"`))
      .map((l) => JSON.parse(l) as Record<string, unknown>)
      .filter((l) => l.requestId === requestId);
  }

  /** The `users_admin` decision lines of one request. */
  decisionsOf(requestId: string): Array<Record<string, unknown>> {
    return this.eventsOf('users_admin', requestId);
  }
}
