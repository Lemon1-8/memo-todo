export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Task {
  id: string;
  title: string;
  completed: boolean;
  createdAt: string;
  updatedAt: string;
  order: number;
  reminderAt?: string;
  remindedAt?: string;
}

export interface Settings {
  windowBounds?: WindowBounds;
  alwaysOnTop: boolean;
  launchAtLogin: boolean;
  themeOpacity: number;
}

export interface AppState {
  version: 1;
  tasks: Task[];
  settings: Settings;
}

export type TaskUpdate = Partial<Pick<Task, 'title' | 'reminderAt' | 'remindedAt'>>;
export type SettingsUpdate = Partial<Settings>;

export function createDefaultSettings(): Settings {
  return {
    alwaysOnTop: false,
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
