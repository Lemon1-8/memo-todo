import { contextBridge, ipcRenderer } from 'electron';
import type { MemoTodoApi } from '../shared/api';
import type { Settings, SettingsUpdate, Task, TaskUpdate } from '../shared/types';

const api: MemoTodoApi = {
  listTasks: () => ipcRenderer.invoke('tasks:list') as Promise<Task[]>,
  createTask: (input: string) => ipcRenderer.invoke('tasks:create', input) as Promise<Task>,
  updateTask: (id: string, patch: TaskUpdate) => ipcRenderer.invoke('tasks:update', id, patch) as Promise<Task>,
  completeTask: (id: string, completed: boolean) =>
    ipcRenderer.invoke('tasks:complete', id, completed) as Promise<Task>,
  deleteTask: (id: string) => ipcRenderer.invoke('tasks:delete', id) as Promise<Task>,
  restoreTask: (task: Task) => ipcRenderer.invoke('tasks:restore', task) as Promise<Task>,
  archiveCompletedTasks: () => ipcRenderer.invoke('tasks:archive-completed') as Promise<Task[]>,
  reorderTasks: (orderedIds: string[]) => ipcRenderer.invoke('tasks:reorder', orderedIds) as Promise<Task[]>,
  getSettings: () => ipcRenderer.invoke('settings:get') as Promise<Settings>,
  updateSettings: (patch: SettingsUpdate) => ipcRenderer.invoke('settings:update', patch) as Promise<Settings>,
  showApp: () => ipcRenderer.invoke('app:show') as Promise<void>,
  hideApp: () => ipcRenderer.invoke('app:hide') as Promise<void>,
  onTasksChanged: (callback: (tasks: Task[]) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, tasks: Task[]) => callback(tasks);
    ipcRenderer.on('tasks:changed', listener);
    return () => ipcRenderer.removeListener('tasks:changed', listener);
  },
  onSettingsChanged: (callback: (settings: Settings) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: Settings) => callback(settings);
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.removeListener('settings:changed', listener);
  }
};

contextBridge.exposeInMainWorld('memoTodo', api);
