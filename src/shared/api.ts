import type { Settings, SettingsUpdate, Task, TaskUpdate } from './types';

export interface MemoTodoApi {
  listTasks: () => Promise<Task[]>;
  createTask: (input: string) => Promise<Task>;
  updateTask: (id: string, patch: TaskUpdate) => Promise<Task>;
  completeTask: (id: string, completed: boolean) => Promise<Task>;
  deleteTask: (id: string) => Promise<Task>;
  restoreTask: (task: Task) => Promise<Task>;
  archiveCompletedTasks: () => Promise<Task[]>;
  reorderTasks: (orderedIds: string[]) => Promise<Task[]>;
  getSettings: () => Promise<Settings>;
  updateSettings: (patch: SettingsUpdate) => Promise<Settings>;
  showApp: () => Promise<void>;
  hideApp: () => Promise<void>;
  onTasksChanged: (callback: (tasks: Task[]) => void) => () => void;
  onSettingsChanged: (callback: (settings: Settings) => void) => () => void;
}
