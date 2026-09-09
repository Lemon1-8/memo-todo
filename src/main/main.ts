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
import type { SettingsUpdate, Task, TaskUpdate, WindowBounds } from '../shared/types';

const appUserModelId = 'com.memo.todo.desktop';
const dataFileName = 'memo-todo.json';

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: JsonStore;
let scheduler: ReminderScheduler;
let allowQuit = false;
let boundsTimer: NodeJS.Timeout | undefined;
let hoverPollTimer: NodeJS.Timeout | undefined;
let hoverHideTimer: NodeJS.Timeout | undefined;
let hoverDocked = false;
let hoverRevealed = false;
let hoverFocusPending = false;
let hoverEnteredVisibleWindow = false;
let suppressBoundsSaveUntil = 0;

const hoverPollIntervalMs = 120;
const hoverTriggerWidth = 12;
const hoverHandleVisibleWidth = 6;
const hoverExitPadding = 16;
const hoverHideDelayMs = 700;

interface ShowWidgetOptions {
  focus?: boolean;
  fromHover?: boolean;
}

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
  updateHoverWatcher();

  scheduler = new ReminderScheduler(store, sendTasksChanged, showWidget);
  scheduler.start();
});

app.on('second-instance', () => {
  showWidget();
});

app.on('before-quit', () => {
  allowQuit = true;
  stopHoverWatcher();
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
    backgroundColor: '#f7f4ed',
    hasShadow: true,
    skipTaskbar: true,
    alwaysOnTop: settings.alwaysOnTop,
    resizable: true,
    show: false,
    icon: createAppIcon(),
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
  window.setSkipTaskbar(true);
  window.setIcon(createAppIcon());

  let shownOnce = false;
  const showInitially = () => {
    if (shownOnce || window.isDestroyed()) {
      return;
    }
    shownOnce = true;
    showInitialWidget(window);
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
  window.on('minimize', () => {
    hideWidget();
  });
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
    const task = store.deleteTask(id);
    sendTasksChanged();
    return task;
  });

  ipcMain.handle('tasks:restore', (_event, task: Task) => {
    const restored = store.restoreTask(task);
    sendTasksChanged();
    return restored;
  });

  ipcMain.handle('tasks:archive-completed', () => {
    const tasks = store.archiveCompletedTasks();
    sendTasksChanged();
    return tasks;
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
  tray.on('click', showWidgetFromTray);
  tray.on('double-click', showWidgetFromTray);
  refreshTrayMenu();
}

function refreshTrayMenu(): void {
  if (!tray || !store) {
    return;
  }

  const settings = store.getSettings();
  const window = getMainWindow();
  const isVisible = Boolean(window?.isVisible() && !hoverDocked);

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
      label: '鼠标悬浮唤出',
      type: 'checkbox',
      checked: settings.hoverToShow,
      click: () => updateSettingsFromMain({ hoverToShow: !settings.hoverToShow })
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
    applyAlwaysOnTop(settings.alwaysOnTop);
  }

  if ('launchAtLogin' in patch) {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
      path: process.execPath
    });
  }

  if ('hoverToShow' in patch) {
    const window = getMainWindow();
    if (settings.hoverToShow) {
      updateHoverWatcher();
      if (window && !window.isVisible()) {
        parkWindowForHover(window);
      } else if (window && !hoverDocked) {
        armHoverAutoDock(window);
      }
    } else {
      if (hoverDocked) {
        hoverDocked = false;
        hoverRevealed = false;
        hoverFocusPending = false;
        hoverEnteredVisibleWindow = false;
        window?.setSkipTaskbar(true);
        window?.setAlwaysOnTop(settings.alwaysOnTop);
        window?.hide();
      }
      updateHoverWatcher();
      applyAlwaysOnTop(settings.alwaysOnTop);
    }
  }
}

function showWidgetFromTray(): void {
  showWidget();
}

function showInitialWidget(window: BrowserWindow): void {
  if (store.getSettings().hoverToShow) {
    parkWindowForHover(window);
    refreshTrayMenu();
    return;
  }

  showWidget();
}

function toggleWidget(): void {
  const window = getMainWindow();
  if (window?.isVisible() && !hoverDocked) {
    hideWidget();
  } else {
    showWidget();
  }
}

function showWidget(options: ShowWidgetOptions = {}): void {
  const window = ensureMainWindow();

  clearHoverHideTimer();
  const shouldRevealFromHover = hoverDocked || Boolean(options.fromHover);
  if (shouldRevealFromHover) {
    revealWindowFromHover(window);
  } else {
    rescueWindowPosition();
  }
  hoverDocked = false;
  hoverRevealed = store.getSettings().hoverToShow && !store.getSettings().alwaysOnTop;
  hoverFocusPending = hoverRevealed;
  hoverEnteredVisibleWindow = Boolean(options.fromHover);
  window.setOpacity(1);
  window.setSkipTaskbar(true);
  if (window.isMinimized()) {
    window.restore();
  }
  bringToFrontTemporarily();
  if (options.focus === false) {
    window.showInactive();
  } else {
    window.show();
    window.focus();
  }
  window.moveTop();
  refreshTrayMenu();
}

function hideWidget(): void {
  const window = getMainWindow();
  hoverRevealed = false;
  hoverFocusPending = false;
  hoverEnteredVisibleWindow = false;
  clearHoverHideTimer();
  if (!window) {
    refreshTrayMenu();
    return;
  }

  if (store.getSettings().hoverToShow && !allowQuit) {
    parkWindowForHover(window);
    refreshTrayMenu();
    return;
  }

  hoverDocked = false;
  window.hide();
  refreshTrayMenu();
}

function updateHoverWatcher(): void {
  if (!store?.getSettings().hoverToShow) {
    stopHoverWatcher();
    return;
  }

  if (hoverPollTimer) {
    return;
  }

  hoverPollTimer = setInterval(handleHoverTick, hoverPollIntervalMs);
}

function stopHoverWatcher(): void {
  if (hoverPollTimer) {
    clearInterval(hoverPollTimer);
    hoverPollTimer = undefined;
  }
  hoverRevealed = false;
  hoverFocusPending = false;
  hoverEnteredVisibleWindow = false;
  clearHoverHideTimer();
}

function handleHoverTick(): void {
  const window = getMainWindow();
  if (!window || !store.getSettings().hoverToShow) {
    stopHoverWatcher();
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  if (window.isMinimized()) {
    parkWindowForHover(window);
    return;
  }

  if (hoverDocked) {
    if (isPointInBounds(cursor, getHoverTriggerBounds(window.getBounds() as WindowBounds))) {
      showWidget({ focus: false, fromHover: true });
    }
    return;
  }

  if (!window.isVisible()) {
    if (isPointInBounds(cursor, getHoverTriggerBounds(window.getBounds() as WindowBounds))) {
      showWidget({ focus: false, fromHover: true });
    }
    return;
  }

  if (!hoverRevealed) {
    return;
  }

  if (store.getSettings().alwaysOnTop) {
    clearHoverHideTimer();
    return;
  }

  const windowBounds = window.getBounds() as WindowBounds;
  const activeBounds = inflateBounds(windowBounds, hoverExitPadding);
  if (isPointInBounds(cursor, activeBounds)) {
    hoverEnteredVisibleWindow = true;
    clearHoverHideTimer();
    focusHoverWindowWhenReady(window, cursor, windowBounds);
    return;
  }

  if (!hoverEnteredVisibleWindow) {
    return;
  }

  scheduleHoverHide();
}

function scheduleHoverHide(): void {
  if (hoverHideTimer) {
    return;
  }

  hoverHideTimer = setTimeout(() => {
    hoverHideTimer = undefined;
    const window = getMainWindow();
    if (!window || !window.isVisible() || !hoverRevealed || store.getSettings().alwaysOnTop) {
      return;
    }

    const cursor = screen.getCursorScreenPoint();
    const activeBounds = inflateBounds(window.getBounds() as WindowBounds, hoverExitPadding);
    if (!isPointInBounds(cursor, activeBounds)) {
      hideWidget();
    }
  }, hoverHideDelayMs);
}

function clearHoverHideTimer(): void {
  if (hoverHideTimer) {
    clearTimeout(hoverHideTimer);
    hoverHideTimer = undefined;
  }
}

function parkWindowForHover(window: BrowserWindow): void {
  const parkedBounds = getParkedHoverBounds(window.getBounds() as WindowBounds);
  hoverDocked = true;
  hoverRevealed = false;
  hoverFocusPending = false;
  hoverEnteredVisibleWindow = false;
  setWindowBoundsWithoutSaving(window, parkedBounds);
  window.setOpacity(1);
  window.setSkipTaskbar(true);
  window.setAlwaysOnTop(true);
  if (window.isMinimized()) {
    window.restore();
  }
  window.showInactive();
  window.moveTop();
}

function revealWindowFromHover(window: BrowserWindow): void {
  const currentBounds = window.getBounds() as WindowBounds;
  const dockedBounds = getDockedBounds(currentBounds);
  if (isSameBounds(currentBounds, dockedBounds)) {
    return;
  }

  setWindowBoundsWithoutSaving(window, dockedBounds);
}

function getParkedHoverBounds(bounds: WindowBounds): WindowBounds {
  const dockedBounds = getDockedBounds(bounds);
  const workArea = getBestWorkArea(dockedBounds);
  const dockSide = getDockSide(dockedBounds, workArea);

  return {
    ...dockedBounds,
    x:
      dockSide === 'left'
        ? workArea.x - dockedBounds.width + hoverHandleVisibleWidth
        : workArea.x + workArea.width - hoverHandleVisibleWidth
  };
}

function getHoverTriggerBounds(bounds: WindowBounds): WindowBounds {
  const workArea = getBestWorkArea(bounds);
  const dockSide = getDockSide(bounds, workArea);
  const triggerWidth = Math.max(hoverTriggerWidth, hoverHandleVisibleWidth);
  const isParked =
    bounds.x < workArea.x || bounds.x + bounds.width > workArea.x + workArea.width || hoverDocked;
  const height = isParked ? Math.min(bounds.height, workArea.height) : workArea.height;

  return {
    x: dockSide === 'left' ? workArea.x : workArea.x + workArea.width - triggerWidth,
    y: isParked ? clamp(Math.round(bounds.y), workArea.y, workArea.y + workArea.height - height) : workArea.y,
    width: triggerWidth,
    height
  };
}

function getDockedBounds(bounds: WindowBounds): WindowBounds {
  const workArea = getBestWorkArea(bounds);
  const width = Math.min(Math.max(bounds.width, 320), workArea.width);
  const height = Math.min(Math.max(bounds.height, 360), workArea.height);
  const dockSide = getDockSide({ ...bounds, width, height }, workArea);

  return {
    width,
    height,
    x: dockSide === 'left' ? workArea.x : workArea.x + workArea.width - width,
    y: clamp(Math.round(bounds.y), workArea.y, workArea.y + workArea.height - height)
  };
}

function getDockSide(bounds: WindowBounds, workArea: WindowBounds): 'left' | 'right' {
  if (bounds.x < workArea.x) {
    return 'left';
  }
  if (bounds.x + bounds.width > workArea.x + workArea.width) {
    return 'right';
  }

  const centerX = bounds.x + bounds.width / 2;
  const workAreaCenterX = workArea.x + workArea.width / 2;
  return centerX < workAreaCenterX ? 'left' : 'right';
}

function getBestWorkArea(bounds: WindowBounds): WindowBounds {
  const fallback = screen.getPrimaryDisplay().workArea;
  return getDisplayWorkAreas()
    .map((workArea) => ({ workArea, score: getIntersectionArea(bounds, workArea) }))
    .sort((left, right) => right.score - left.score)[0]?.workArea ?? fallback;
}

function getIntersectionArea(left: WindowBounds, right: WindowBounds): number {
  const width = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const height = Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
  return width * height;
}

function inflateBounds(bounds: WindowBounds, padding: number): WindowBounds {
  return {
    x: bounds.x - padding,
    y: bounds.y - padding,
    width: bounds.width + padding * 2,
    height: bounds.height + padding * 2
  };
}

function isPointInBounds(point: { x: number; y: number }, bounds: WindowBounds): boolean {
  return (
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height
  );
}

function centerAndShowWidget(): void {
  const window = ensureMainWindow();

  hoverDocked = false;
  hoverRevealed = false;
  hoverFocusPending = false;
  hoverEnteredVisibleWindow = false;
  clearHoverHideTimer();
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

  const shouldRemainOnTop = store.getSettings().alwaysOnTop || hoverDocked || hoverRevealed;
  window.setAlwaysOnTop(true);
  if (!shouldRemainOnTop) {
    setTimeout(() => {
      const currentWindow = getMainWindow();
      if (currentWindow && !hoverDocked && !store.getSettings().alwaysOnTop) {
        currentWindow.setAlwaysOnTop(false);
      }
    }, 1600);
  }
}

function applyAlwaysOnTop(enabled: boolean): void {
  const window = getMainWindow();
  if (!window) {
    return;
  }

  if (enabled) {
    clearHoverHideTimer();
  }
  window.setAlwaysOnTop(hoverDocked || hoverRevealed || enabled);
  if (enabled) {
    window.moveTop();
  } else if (store.getSettings().hoverToShow && window.isVisible() && !hoverDocked) {
    armHoverAutoDock(window);
  }
}

function armHoverAutoDock(window: BrowserWindow, enteredWindow = false): void {
  if (!store.getSettings().hoverToShow || store.getSettings().alwaysOnTop) {
    return;
  }

  const cursor = screen.getCursorScreenPoint();
  const bounds = window.getBounds() as WindowBounds;
  hoverRevealed = true;
  hoverFocusPending = true;
  hoverEnteredVisibleWindow = enteredWindow || isPointInBounds(cursor, inflateBounds(bounds, hoverExitPadding));
  clearHoverHideTimer();
}

function focusHoverWindowWhenReady(
  window: BrowserWindow,
  cursor: { x: number; y: number },
  windowBounds: WindowBounds
): void {
  if (!hoverFocusPending || !isPointInBounds(cursor, windowBounds)) {
    return;
  }

  hoverFocusPending = false;
  window.setAlwaysOnTop(true);
  if (!window.isFocused()) {
    window.focus();
  }
  window.moveTop();
}

function sendTasksChanged(): void {
  getMainWindow()?.webContents.send('tasks:changed', store.listTasks());
}

function sendSettingsChanged(): void {
  getMainWindow()?.webContents.send('settings:changed', store.getSettings());
}

function scheduleBoundsSave(): void {
  const window = getMainWindow();
  if (!window || hoverDocked || Date.now() < suppressBoundsSaveUntil) {
    return;
  }

  if (boundsTimer) {
    clearTimeout(boundsTimer);
  }

  boundsTimer = setTimeout(() => {
    const currentWindow = getMainWindow();
    if (!currentWindow || hoverDocked || Date.now() < suppressBoundsSaveUntil) {
      return;
    }
    store.setWindowBounds(currentWindow.getBounds() as WindowBounds);
  }, 300);
}

function setWindowBoundsWithoutSaving(window: BrowserWindow, bounds: WindowBounds): void {
  suppressBoundsSaveUntil = Date.now() + 500;
  if (boundsTimer) {
    clearTimeout(boundsTimer);
    boundsTimer = undefined;
  }
  window.setBounds(bounds, false);
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function createAppIcon(): NativeImage {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.ico')
    : path.join(app.getAppPath(), 'build', 'icon.ico');
  const image = nativeImage.createFromPath(iconPath);
  return image.isEmpty() ? createFallbackIcon() : image;
}

function createTrayIcon(): NativeImage {
  const image = createAppIcon();
  return image.isEmpty() ? image : image.resize({ width: 16, height: 16 });
}

function createFallbackIcon(): NativeImage {
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
