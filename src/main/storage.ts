import fs from 'node:fs';
import path from 'node:path';
import { parseTaskInput } from '../shared/reminders';
import {
  AppState,
  Settings,
  SettingsUpdate,
  Task,
  TaskPriority,
  TaskStatus,
  TaskUpdate,
  WindowBounds,
  createDefaultSettings,
  createDefaultState
} from '../shared/types';

export class JsonStore {
  private state: AppState = createDefaultState();

  constructor(private readonly filePath: string) {}

  load(): AppState {
    ensureParentDirectory(this.filePath);

    if (!fs.existsSync(this.filePath)) {
      this.state = createDefaultState();
      this.save();
      return this.getState();
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<AppState>;
      this.state = normalizeState(parsed);
    } catch {
      this.backupCorruptedFile();
      this.state = createDefaultState();
      this.save();
    }

    return this.getState();
  }

  save(): void {
    ensureParentDirectory(this.filePath);
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  getState(): AppState {
    return clone(this.state);
  }

  listTasks(): Task[] {
    return clone(sortTasks(this.state.tasks));
  }

  createTask(input: string, now = new Date()): Task {
    const parsed = parseTaskInput(input, now);
    const title = parsed.title.trim();
    if (!title) {
      throw new Error('任务标题不能为空');
    }

    const timestamp = now.toISOString();
    const task: Task = {
      id: createId(),
      title,
      status: 'todo',
      completed: false,
      createdAt: timestamp,
      updatedAt: timestamp,
      order: nextOrder(this.state.tasks),
      priority: 'normal',
      reminderAt: parsed.reminderAt
    };

    this.state.tasks.push(task);
    this.save();
    return clone(task);
  }

  updateTask(id: string, patch: TaskUpdate, now = new Date()): Task {
    const task = this.findTask(id);
    if (patch.title !== undefined) {
      const title = patch.title.trim();
      if (!title) {
        throw new Error('任务标题不能为空');
      }
      task.title = title;
    }
    if ('reminderAt' in patch) {
      task.reminderAt = patch.reminderAt || undefined;
      task.remindedAt = undefined;
    }
    if ('remindedAt' in patch) {
      task.remindedAt = patch.remindedAt || undefined;
    }
    if ('priority' in patch) {
      task.priority = normalizePriority(patch.priority);
    }
    if ('status' in patch) {
      task.status = normalizeStatus(patch.status, task.completed);
      task.completed = task.status === 'done';
    }
    if ('archivedAt' in patch) {
      task.archivedAt = patch.archivedAt ? safeOptionalIso(patch.archivedAt) : undefined;
    }
    task.updatedAt = now.toISOString();
    this.save();
    return clone(task);
  }

  completeTask(id: string, completed: boolean, now = new Date()): Task {
    const task = this.findTask(id);
    task.completed = completed;
    task.status = completed ? 'done' : 'todo';
    task.updatedAt = now.toISOString();
    this.save();
    return clone(task);
  }

  deleteTask(id: string): Task {
    const task = this.findTask(id);
    const deleted = clone(task);
    this.state.tasks = this.state.tasks.filter((candidate) => candidate.id !== id);
    this.reindexTasks();
    this.save();
    return deleted;
  }

  restoreTask(task: Task, now = new Date()): Task {
    if (this.state.tasks.some((candidate) => candidate.id === task.id)) {
      throw new Error('任务已存在');
    }

    const timestamp = now.toISOString();
    const restored = normalizeTask(task, nextOrder(this.state.tasks));
    restored.updatedAt = timestamp;
    this.state.tasks.push(restored);
    this.state.tasks = sortTasks(this.state.tasks);
    this.reindexTasks(now);
    this.save();
    return clone(this.findTask(restored.id));
  }

  archiveCompletedTasks(now = new Date()): Task[] {
    const timestamp = now.toISOString();
    for (const task of this.state.tasks) {
      if (task.status === 'done' && !task.archivedAt) {
        task.archivedAt = timestamp;
        task.updatedAt = timestamp;
      }
    }
    this.save();
    return this.listTasks();
  }

  reorderTasks(orderedIds: string[], now = new Date()): Task[] {
    const byId = new Map(this.state.tasks.map((task) => [task.id, task]));
    const seen = new Set<string>();
    const ordered: Task[] = [];

    for (const id of orderedIds) {
      const task = byId.get(id);
      if (task && !seen.has(id)) {
        ordered.push(task);
        seen.add(id);
      }
    }

    const remaining = sortTasks(this.state.tasks).filter((task) => !seen.has(task.id));
    this.state.tasks = [...ordered, ...remaining];
    this.reindexTasks(now);
    this.save();
    return this.listTasks();
  }

  getDueTasks(now = new Date()): Task[] {
    const dueTime = now.getTime();
    return this.state.tasks
      .filter((task) => task.status !== 'done' && !task.archivedAt && task.reminderAt && !task.remindedAt)
      .filter((task) => new Date(task.reminderAt as string).getTime() <= dueTime)
      .map((task) => clone(task));
  }

  markReminded(id: string, now = new Date()): Task {
    const task = this.findTask(id);
    task.remindedAt = now.toISOString();
    task.updatedAt = now.toISOString();
    this.save();
    return clone(task);
  }

  getSettings(): Settings {
    return clone(this.state.settings);
  }

  updateSettings(patch: SettingsUpdate): Settings {
    this.state.settings = normalizeSettings({
      ...this.state.settings,
      ...patch
    });
    this.save();
    return this.getSettings();
  }

  setWindowBounds(bounds: WindowBounds): Settings {
    return this.updateSettings({ windowBounds: normalizeBounds(bounds) });
  }

  private findTask(id: string): Task {
    const task = this.state.tasks.find((candidate) => candidate.id === id);
    if (!task) {
      throw new Error('任务不存在');
    }
    return task;
  }

  private reindexTasks(now = new Date()): void {
    const timestamp = now.toISOString();
    this.state.tasks.forEach((task, index) => {
      task.order = index;
      task.updatedAt = timestamp;
    });
  }

  private backupCorruptedFile(): void {
    if (!fs.existsSync(this.filePath)) {
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(this.filePath, `${this.filePath}.corrupt-${stamp}.bak`);
  }
}

function normalizeState(raw: Partial<AppState>): AppState {
  const state = createDefaultState();
  const tasks = Array.isArray(raw.tasks) ? (raw.tasks as unknown[]) : [];
  state.tasks = tasks
    .filter(isTaskLike)
    .map((task, index) => normalizeTask(task, index));
  state.tasks = sortTasks(state.tasks).map((task, index) => ({ ...task, order: index }));
  state.settings = normalizeSettings(raw.settings);
  return state;
}

function isTaskLike(task: unknown): task is Partial<Task> {
  if (!task || typeof task !== 'object') {
    return false;
  }

  const candidate = task as Partial<Task>;
  return typeof candidate.id === 'string' && typeof candidate.title === 'string';
}

function normalizeTask(task: Partial<Task>, fallbackOrder: number): Task {
  const status = normalizeStatus(task.status, Boolean(task.completed));
  return {
    id: String(task.id),
    title: typeof task.title === 'string' && task.title.trim() ? task.title.trim() : '未命名任务',
    status,
    completed: status === 'done',
    createdAt: safeIso(task.createdAt),
    updatedAt: safeIso(task.updatedAt),
    order: typeof task.order === 'number' && Number.isFinite(task.order) ? task.order : fallbackOrder,
    priority: normalizePriority(task.priority),
    reminderAt: safeOptionalIso(task.reminderAt),
    remindedAt: safeOptionalIso(task.remindedAt),
    archivedAt: safeOptionalIso(task.archivedAt)
  };
}

function normalizePriority(value: unknown): TaskPriority {
  if (value === 'low' || value === 'normal' || value === 'high') {
    return value;
  }
  return 'normal';
}

function normalizeStatus(value: unknown, completedFallback = false): TaskStatus {
  if (value === 'todo' || value === 'doing' || value === 'waiting' || value === 'done') {
    return value;
  }
  return completedFallback ? 'done' : 'todo';
}

function normalizeSettings(raw: unknown): Settings {
  const defaults = createDefaultSettings();
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const settings = raw as Partial<Settings>;
  return {
    windowBounds: settings.windowBounds ? normalizeBounds(settings.windowBounds) : undefined,
    alwaysOnTop: Boolean(settings.alwaysOnTop),
    hoverToShow: settings.hoverToShow === undefined ? defaults.hoverToShow : Boolean(settings.hoverToShow),
    launchAtLogin: Boolean(settings.launchAtLogin),
    themeOpacity: clamp(Number(settings.themeOpacity), 0.82, 0.98, defaults.themeOpacity)
  };
}

function normalizeBounds(bounds: WindowBounds): WindowBounds {
  return {
    x: Math.round(Number(bounds.x) || 0),
    y: Math.round(Number(bounds.y) || 0),
    width: Math.max(320, Math.round(Number(bounds.width) || 380)),
    height: Math.max(360, Math.round(Number(bounds.height) || 520))
  };
}

function safeIso(value: unknown): string {
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  return new Date().toISOString();
}

function safeOptionalIso(value: unknown): string | undefined {
  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return value;
  }
  return undefined;
}

function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((left, right) => left.order - right.order || left.createdAt.localeCompare(right.createdAt));
}

function nextOrder(tasks: Task[]): number {
  return tasks.reduce((max, task) => Math.max(max, task.order), -1) + 1;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function ensureParentDirectory(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, value));
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
