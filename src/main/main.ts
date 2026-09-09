import path from 'node:path';
import {
  BrowserWindow,
  Menu,
  NativeImage,
  Tray,
  app,
  ipcMain,
  nativeImage,
  screen
} from 'electron';
import { ReminderScheduler } from './reminderScheduler';
import { JsonStore } from './storage';
import { ensureVisibleBounds, isSameBounds } from './windowBounds';
import type { SettingsUpdate, TaskUpdate, WindowBounds } from '../shared/types';

const appUserModelId = 'com.memo.todo';
const dataFileName = 'memo-todo.json';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: JsonStore;
let scheduler: ReminderScheduler;
let allowQuit = false;
let boundsTimer: NodeJS.Timeout | undefined;

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
}

app.setAppUserModelId(appUserModelId);

app.whenReady().then(() => {
  store = new JsonStore(path.join(app.getPath('userData'), dataFileName));
  store.load();

  createMainWindow();
  registerIpcHandlers();
  createTray();

  scheduler = new ReminderScheduler(store, sendTasksChanged, showWidget);
  scheduler.start();
});

app.on('second-instance', () => {
  showWidget();
});

app.on('before-quit', () => {
  allowQuit = true;
  scheduler?.stop();
  store?.save();
});

app.on('window-all-closed', () => {
  if (allowQuit) {
    app.quit();
  }
});

function createMainWindow(): BrowserWindow {
  const settings = store.getSettings();
  const fallbackBounds = getDefaultBounds();
  const bounds = ensureVisibleBounds(settings.windowBounds ?? fallbackBounds, getDisplayWorkAreas(), fallbackBounds);
  if (settings.windowBounds && !isSameBounds(settings.windowBounds, bounds)) {
    store.setWindowBounds(bounds);
  }

  const window = new BrowserWindow({
    ...bounds,
    minWidth: 320,
    minHeight: 360,
    frame: false,
    transparent: false,
    backgroundColor: '#12181b',
    hasShadow: true,
    skipTaskbar: false,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: true,
    show: false,
    title: 'Memo ToDo',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  window.setMenuBarVisibility(false);

  let shownOnce = false;
  const showInitially = () => {
    if (shownOnce || window.isDestroyed()) {
      return;
    }
    shownOnce = true;
    showWidget();
  };

  window.once('ready-to-show', showInitially);
  window.webContents.once('did-finish-load', showInitially);
  setTimeout(showInitially, 2500);

  window.on('close', (event) => {
    if (!allowQuit) {
      event.preventDefault();
      hideWidget();
      refreshTrayMenu();
    }
  });

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    refreshTrayMenu();
  });

  window.on('hide', refreshTrayMenu);
  window.on('show', refreshTrayMenu);
  window.on('moved', scheduleBoundsSave);
  window.on('resized', scheduleBoundsSave);

  if (process.env.VITE_DEV_SERVER_URL) {
    window.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    window.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  return window;
}

function registerIpcHandlers(): void {
  ipcMain.handle('tasks:list', () => store.listTasks());

  ipcMain.handle('tasks:create', (_event, input: string) => {
    const task = store.createTask(input);
    sendTasksChanged();
    return task;
  });

  ipcMain.handle('tasks:update', (_event, id: string, patch: TaskUpdate) => {
    const task = store.updateTask(id, patch);
    sendTasksChanged();
    return task;
  });

  ipcMain.handle('tasks:complete', (_event, id: string, completed: boolean) => {
    const task = store.completeTask(id, completed);
    sendTasksChanged();
    return task;
  });

  ipcMain.handle('tasks:delete', (_event, id: string) => {
    store.deleteTask(id);
    sendTasksChanged();
  });

  ipcMain.handle('tasks:reorder', (_event, orderedIds: string[]) => {
    const tasks = store.reorderTasks(orderedIds);
    sendTasksChanged();
    return tasks;
  });

  ipcMain.handle('settings:get', () => store.getSettings());

  ipcMain.handle('settings:update', (_event, patch: SettingsUpdate) => {
    const settings = store.updateSettings(patch);
    applySettings(patch, settings);
    sendSettingsChanged();
    refreshTrayMenu();
    return settings;
  });

  ipcMain.handle('app:show', () => {
    showWidget();
  });

  ipcMain.handle('app:hide', () => {
    hideWidget();
  });
}

function createTray(): void {
  tray = new Tray(createTrayIcon());
  tray.setToolTip('Memo ToDo');
  tray.on('click', toggleWidget);
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  if (!tray || !store) {
    return;
  }

  const settings = store.getSettings();
  const window = getMainWindow();
  const isVisible = Boolean(window?.isVisible());

  const menu = Menu.buildFromTemplate([
    {
      label: isVisible ? '隐藏' : '显示',
      click: toggleWidget
    },
    {
      label: '显示到屏幕中央',
      click: centerAndShowWidget
    },
    {
      label: '置顶',
      type: 'checkbox',
      checked: settings.alwaysOnTop,
      click: () => updateSettingsFromMain({ alwaysOnTop: !settings.alwaysOnTop })
    },
    {
      label: '开机启动',
      type: 'checkbox',
      checked: settings.launchAtLogin,
      click: () => updateSettingsFromMain({ launchAtLogin: !settings.launchAtLogin })
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        allowQuit = true;
        app.quit();
      }
    }
  ]);

  tray.setContextMenu(menu);
}

function updateSettingsFromMain(patch: SettingsUpdate): void {
  const settings = store.updateSettings(patch);
  applySettings(patch, settings);
  sendSettingsChanged();
  refreshTrayMenu();
}

function applySettings(patch: SettingsUpdate, settings = store.getSettings()): void {
  if ('alwaysOnTop' in patch) {
    getMainWindow()?.setAlwaysOnTop(settings.alwaysOnTop);
  }

  if ('launchAtLogin' in patch) {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      path: process.execPath
    });
  }
}

function toggleWidget(): void {
  const window = getMainWindow();
  if (window?.isVisible()) {
    hideWidget();
  } else {
    showWidget();
  }
}

function showWidget(): void {
  const window = ensureMainWindow();

  rescueWindowPosition();
  window.setOpacity(1);
  window.setSkipTaskbar(false);
  if (window.isMinimized()) {
    window.restore();
  }
  bringToFrontTemporarily();
  window.show();
  window.focus();
  window.moveTop();
  refreshTrayMenu();
}

function hideWidget(): void {
  const window = getMainWindow();
  if (!window) {
    refreshTrayMenu();
    return;
  }

  window.hide();
  refreshTrayMenu();
}

function centerAndShowWidget(): void {
  const window = ensureMainWindow();

  const bounds = centerBoundsInPrimaryDisplay(window.getBounds() as WindowBounds);
  window.setBounds(bounds, false);
  store.setWindowBounds(bounds);
  showWidget();
}

function rescueWindowPosition(): void {
  const window = getMainWindow();
  if (!window) {
    return;
  }

  const fallbackBounds = getDefaultBounds();
  const currentBounds = window.getBounds() as WindowBounds;
  const visibleBounds = ensureVisibleBounds(currentBounds, getDisplayWorkAreas(), fallbackBounds);
  if (!isSameBounds(currentBounds, visibleBounds)) {
    window.setBounds(visibleBounds, false);
    store.setWindowBounds(visibleBounds);
  }
}

function bringToFrontTemporarily(): void {
  const window = getMainWindow();
  if (!window) {
    return;
  }

  const shouldRemainOnTop = store.getSettings().alwaysOnTop;
  window.setAlwaysOnTop(true);
  if (!shouldRemainOnTop) {
    setTimeout(() => {
      const currentWindow = getMainWindow();
      if (currentWindow) {
        currentWindow.setAlwaysOnTop(false);
      }
    }, 1600);
  }
}

function sendTasksChanged(): void {
  getMainWindow()?.webContents.send('tasks:changed', store.listTasks());
}

function sendSettingsChanged(): void {
  getMainWindow()?.webContents.send('settings:changed', store.getSettings());
}

function scheduleBoundsSave(): void {
  const window = getMainWindow();
  if (!window) {
    return;
  }

  if (boundsTimer) {
    clearTimeout(boundsTimer);
  }

  boundsTimer = setTimeout(() => {
    const currentWindow = getMainWindow();
    if (!currentWindow) {
      return;
    }
    store.setWindowBounds(currentWindow.getBounds() as WindowBounds);
  }, 300);
}

function getMainWindow(): BrowserWindow | null {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  return mainWindow;
}

function ensureMainWindow(): BrowserWindow {
  return getMainWindow() ?? createMainWindow();
}

function getDefaultBounds(): WindowBounds {
  const width = 380;
  const height = 520;
  return centerBoundsInPrimaryDisplay({ x: 0, y: 0, width, height });
}

function getDisplayWorkAreas(): WindowBounds[] {
  return screen.getAllDisplays().map((display) => display.workArea);
}

function centerBoundsInPrimaryDisplay(bounds: WindowBounds): WindowBounds {
  const workArea = screen.getPrimaryDisplay().workArea;
  const width = Math.min(Math.max(bounds.width, 380), workArea.width);
  const height = Math.min(Math.max(bounds.height, 520), workArea.height);

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2)
  };
}

function createTrayIcon(): NativeImage {
  const svg = `
    <svg width="64" height="64" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <rect width="64" height="64" rx="14" fill="#20282b"/>
      <path d="M18 21h28M18 32h28M18 43h19" stroke="#f4fbfa" stroke-width="5" stroke-linecap="round"/>
      <circle cx="12" cy="21" r="3.5" fill="#5fd3c6"/>
      <circle cx="12" cy="32" r="3.5" fill="#f2b84b"/>
      <circle cx="12" cy="43" r="3.5" fill="#ff6b6b"/>
    </svg>
  `;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
    .resize({ width: 16, height: 16 });
}
