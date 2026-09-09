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

  it('defaults and updates task status and priority', () => {
    const store = new JsonStore(filePath);
    store.load();

    const task = store.createTask('整理客户情况', new Date(2026, 8, 9, 10, 0));
    expect(task.status).toBe('todo');
    expect(task.completed).toBe(false);
    expect(task.priority).toBe('normal');

    const updated = store.updateTask(task.id, { priority: 'high' }, new Date(2026, 8, 9, 10, 1));
    expect(updated.priority).toBe('high');

    const doing = store.updateTask(task.id, { status: 'doing' }, new Date(2026, 8, 9, 10, 2));
    expect(doing.status).toBe('doing');
    expect(doing.completed).toBe(false);

    const done = store.updateTask(task.id, { status: 'done' }, new Date(2026, 8, 9, 10, 3));
    expect(done.status).toBe('done');
    expect(done.completed).toBe(true);

    const reopened = store.completeTask(task.id, false, new Date(2026, 8, 9, 10, 4));
    expect(reopened.status).toBe('todo');
    expect(reopened.completed).toBe(false);

    store.updateTask(task.id, { priority: undefined }, new Date(2026, 8, 9, 10, 5));
    expect(store.listTasks()[0].priority).toBe('normal');
  });

  it('archives completed tasks and restores archived tasks', () => {
    const store = new JsonStore(filePath);
    store.load();

    const active = store.createTask('写周报', new Date(2026, 8, 9, 10, 0));
    const completed = store.createTask('整理客户情况', new Date(2026, 8, 9, 10, 1));
    store.completeTask(completed.id, true, new Date(2026, 8, 9, 10, 2));

    store.archiveCompletedTasks(new Date(2026, 8, 9, 10, 3));

    expect(store.listTasks().find((task) => task.id === active.id)?.archivedAt).toBeUndefined();
    expect(store.listTasks().find((task) => task.id === completed.id)?.archivedAt).toBe(
      new Date(2026, 8, 9, 10, 3).toISOString()
    );

    store.updateTask(completed.id, { archivedAt: '' }, new Date(2026, 8, 9, 10, 4));
    expect(store.listTasks().find((task) => task.id === completed.id)?.archivedAt).toBeUndefined();
  });

  it('returns deleted task snapshots and restores them', () => {
    const store = new JsonStore(filePath);
    store.load();

    const first = store.createTask('写周报', new Date(2026, 8, 9, 10, 0));
    const second = store.createTask('整理客户情况', new Date(2026, 8, 9, 10, 1));
    const deleted = store.deleteTask(first.id);

    expect(deleted).toMatchObject({
      id: first.id,
      title: '写周报',
      priority: 'normal'
    });
    expect(store.listTasks().map((task) => task.id)).toEqual([second.id]);

    const restored = store.restoreTask(deleted, new Date(2026, 8, 9, 10, 2));
    expect(restored.id).toBe(first.id);
    expect(store.listTasks().map((task) => task.id)).toEqual([first.id, second.id]);
  });

  it('persists state to disk', () => {
    const store = new JsonStore(filePath);
    store.load();
    const created = store.createTask('今天 14:00 写周报', new Date(2026, 8, 9, 9, 0));
    store.updateSettings({ alwaysOnTop: true, hoverToShow: true, themeOpacity: 0.9 });

    const nextStore = new JsonStore(filePath);
    nextStore.load();

    expect(nextStore.listTasks()[0].id).toBe(created.id);
    expect(nextStore.listTasks()[0].reminderAt).toBe(new Date(2026, 8, 9, 14, 0).toISOString());
    expect(nextStore.getSettings().alwaysOnTop).toBe(true);
    expect(nextStore.getSettings().hoverToShow).toBe(true);
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

    expect(store.getSettings().hoverToShow).toBe(true);
    expect(store.getSettings().themeOpacity).toBe(0.82);
  });

  it('normalizes legacy tasks with missing status, missing priority, and invalid archive dates', () => {
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        tasks: [
          {
            id: 'legacy-1',
            title: '旧任务',
            completed: false,
            createdAt: new Date(2026, 8, 9, 10, 0).toISOString(),
            updatedAt: new Date(2026, 8, 9, 10, 0).toISOString(),
            order: 0,
            archivedAt: 'bad-date'
          },
          {
            id: 'legacy-2',
            title: '旧完成任务',
            completed: true,
            createdAt: new Date(2026, 8, 9, 10, 1).toISOString(),
            updatedAt: new Date(2026, 8, 9, 10, 1).toISOString(),
            order: 1,
            priority: 'high'
          }
        ],
        settings: {
          alwaysOnTop: false,
          launchAtLogin: false,
          themeOpacity: 0.92
        }
      }),
      'utf8'
    );

    const store = new JsonStore(filePath);
    store.load();

    expect(store.listTasks()[0]).toMatchObject({
      id: 'legacy-1',
      status: 'todo',
      completed: false,
      priority: 'normal'
    });
    expect(store.listTasks()[0].archivedAt).toBeUndefined();
    expect(store.listTasks()[1]).toMatchObject({
      id: 'legacy-2',
      status: 'done',
      completed: true,
      priority: 'high'
    });
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

  it('resets reminders when reminder time changes and ignores archived tasks', () => {
    const store = new JsonStore(filePath);
    store.load();

    const task = store.createTask('2026-09-09 08:00 整理客户情况', new Date(2026, 8, 9, 7, 0));
    store.markReminded(task.id, new Date(2026, 8, 9, 8, 0));

    store.updateTask(
      task.id,
      { reminderAt: new Date(2026, 8, 9, 10, 0).toISOString() },
      new Date(2026, 8, 9, 8, 1)
    );
    expect(store.listTasks()[0].remindedAt).toBeUndefined();
    expect(store.getDueTasks(new Date(2026, 8, 9, 10, 1)).map((candidate) => candidate.id)).toEqual([task.id]);

    store.updateTask(task.id, { archivedAt: new Date(2026, 8, 9, 10, 2).toISOString() }, new Date(2026, 8, 9, 10, 2));
    expect(store.getDueTasks(new Date(2026, 8, 9, 10, 3))).toEqual([]);

    store.updateTask(task.id, { reminderAt: '' }, new Date(2026, 8, 9, 10, 4));
    expect(store.listTasks()[0].reminderAt).toBeUndefined();
    expect(store.listTasks()[0].remindedAt).toBeUndefined();
  });
});
