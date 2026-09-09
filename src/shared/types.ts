export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TaskPriority = 'low' | 'normal' | 'high';
export type TaskStatus = 'todo' | 'doing' | 'waiting' | 'done';

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  order: number;
  priority: TaskPriority;
  reminderAt?: string;
  remindedAt?: string;
  archivedAt?: string;
}

export interface Settings {
  windowBounds?: WindowBounds;
  alwaysOnTop: boolean;
  hoverToShow: boolean;
  launchAtLogin: boolean;
  themeOpacity: number;
}

export interface AppState {
  version: 1;
  tasks: Task[];
  settings: Settings;
}

export type TaskUpdate = Partial<
  Pick<Task, 'title' | 'status' | 'priority' | 'reminderAt' | 'remindedAt' | 'archivedAt'>
>;
export type SettingsUpdate = Partial<Settings>;

export function createDefaultSettings(): Settings {
  return {
    alwaysOnTop: false,
    hoverToShow: true,
    launchAtLogin: false,
    themeOpacity: 0.92
  };
}

export function createDefaultState(): AppState {
  return {
    version: 1,
    tasks: [],
    settings: createDefaultSettings()
  };
}
