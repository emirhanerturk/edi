// View > Keep Mac Awake: while it is on, the Mac doesn't go to sleep on its own.

/** The part of Electron's `powerSaveBlocker` used here (a stand-in in the tests). */
export interface SleepBlocker {
  start(type: 'prevent-app-suspension' | 'prevent-display-sleep'): number;
  stop(id: number): void;
  isStarted(id: number): boolean;
}

/**
 * Holds off idle sleep, so long jobs in the terminals (a Claude Code session, a build) keep running.
 * The display may still turn off, and closing the lid still sleeps a laptop: macOS decides that one.
 * The hold ends with the app.
 */
export class KeepAwake {
  private id: number | null = null;

  constructor(
    private readonly blocker: SleepBlocker,
    enabled: boolean,
  ) {
    this.setEnabled(enabled);
  }

  setEnabled(enabled: boolean): void {
    const held = this.id !== null && this.blocker.isStarted(this.id);
    if (enabled && !held) this.id = this.blocker.start('prevent-app-suspension');
    if (!enabled && this.id !== null) {
      if (held) this.blocker.stop(this.id);
      this.id = null;
    }
  }

  dispose(): void {
    this.setEnabled(false);
  }
}
