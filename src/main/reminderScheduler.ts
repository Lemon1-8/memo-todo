import { Notification } from 'electron';
import { JsonStore } from './storage';

const reminderIntervalMs = 30_000;

export class ReminderScheduler {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly store: JsonStore,
    private readonly notifyTasksChanged: () => void,
    private readonly showApp: () => void
  ) {}

  start(): void {
    this.stop();
    this.tick();
    this.timer = setInterval(() => this.tick(), reminderIntervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  tick(now = new Date()): void {
    const dueTasks = this.store.getDueTasks(now);
    if (dueTasks.length === 0) {
      return;
    }

    for (const task of dueTasks) {
      try {
        if (Notification.isSupported()) {
          const notification = new Notification({
            title: 'Memo ToDo',
            body: task.title,
            silent: false
          });
          notification.on('click', () => this.showApp());
          notification.show();
        }
      } finally {
        this.store.markReminded(task.id, now);
      }
    }

    this.notifyTasksChanged();
  }
}
