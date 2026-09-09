import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonStore } from './storage';

let tempDir = '';
let filePath = '';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'memo-todo-'));
  filePath = path.join(tempDir, 'state.json');
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('JsonStore', () => {
  it('creates, completes, deletes, and reorders tasks', () => {
    const store = new JsonStore(filePath);
    store.load();

    const first = store.createTask('写获奖感言', new Date(2026, 8, 9, 10, 0));
    const second = store.createTask('整理客户情况', new Date(2026, 8, 9, 10, 1));
    const third = store.createTask('清理客户清单', new Date(2026, 8, 9, 10, 2));

    expect(store.listTasks().map((task) => task.title)).toEqual(['写获奖感言', '整理客户情况', '清理客户清单']);

    store.completeTask(second.id, true, new Date(2026, 8, 9, 10, 3));
    expect(store.listTasks().find((task) => task.id === second.id)?.completed).toBe(true);

    store.reorderTasks([third.id, first.id, second.id], new Date(2026, 8, 9, 10, 4));
    expect(store.listTasks().map((task) => task.id)).toEqual([third.id, first.id, second.id]);

    store.deleteTask(first.id);
    expect(store.listTasks().map((task) => task.id)).toEqual([third.id, second.id]);
  });

  it('persists state to disk', () => {
    const store = new JsonStore(filePath);
    store.load();
    const created = store.createTask('今天 14:00 写周报', new Date(2026, 8, 9, 9, 0));
    store.updateSettings({ alwaysOnTop: true, themeOpacity: 0.9 });

    const nextStore = new JsonStore(filePath);
    nextStore.load();

    expect(nextStore.listTasks()[0].id).toBe(created.id);
    expect(nextStore.listTasks()[0].reminderAt).toBe(new Date(2026, 8, 9, 14, 0).toISOString());
    expect(nextStore.getSettings().alwaysOnTop).toBe(true);
    expect(nextStore.getSettings().themeOpacity).toBe(0.9);
  });

  it('clamps legacy transparent settings so the widget remains visible', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        tasks: [],
        settings: {
          alwaysOnTop: false,
          launchAtLogin: false,
          themeOpacity: 0.42
        }
      }),
      'utf8'
    );

    const store = new JsonStore(filePath);
    store.load();

    expect(store.getSettings().themeOpacity).toBe(0.82);
  });

  it('backs up corrupted json and starts from defaults', () => {
    fs.writeFileSync(filePath, '{bad json', 'utf8');

    const store = new JsonStore(filePath);
    store.load();

    const backup = fs.readdirSync(tempDir).find((name) => name.includes('.corrupt-') && name.endsWith('.bak'));
    expect(backup).toBeTruthy();
    expect(store.listTasks()).toEqual([]);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('finds due reminders only once and ignores completed tasks', () => {
    const store = new JsonStore(filePath);
    store.load();

    const due = store.createTask('2026-09-09 08:00 整理客户情况', new Date(2026, 8, 9, 7, 0));
    const future = store.createTask('2026-09-09 18:00 健身', new Date(2026, 8, 9, 7, 1));
    const completed = store.createTask('2026-09-09 08:30 清理清单', new Date(2026, 8, 9, 7, 2));
    store.completeTask(completed.id, true, new Date(2026, 8, 9, 7, 3));

    expect(store.getDueTasks(new Date(2026, 8, 9, 9, 0)).map((task) => task.id)).toEqual([due.id]);

    store.markReminded(due.id, new Date(2026, 8, 9, 9, 0));
    expect(store.getDueTasks(new Date(2026, 8, 9, 9, 1))).toEqual([]);
    expect(store.getDueTasks(new Date(2026, 8, 9, 18, 1)).map((task) => task.id)).toEqual([future.id]);
  });
});
