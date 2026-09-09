import {
  Bell,
  Check,
  ChevronDown,
  ChevronUp,
  EyeOff,
  Pin,
  PinOff,
  Plus,
  Settings as SettingsIcon,
  Trash2,
  X
} from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useMemo, useState } from 'react';
import type { Settings, Task } from '../shared/types';

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [input, setInput] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.memoTodo.listTasks().then(setTasks);
    void window.memoTodo.getSettings().then(setSettings);

    const stopTasks = window.memoTodo.onTasksChanged(setTasks);
    const stopSettings = window.memoTodo.onSettingsChanged(setSettings);
    return () => {
      stopTasks();
      stopSettings();
    };
  }, []);

  const orderedTasks = useMemo(() => [...tasks].sort((a, b) => a.order - b.order), [tasks]);
  const activeTasks = orderedTasks.filter((task) => !task.completed);
  const completedTasks = orderedTasks.filter((task) => task.completed);
  const visibleTasks = [...activeTasks, ...completedTasks];

  async function addTask(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const value = input.trim();
    if (!value) {
      return;
    }

    try {
      setError(null);
      await window.memoTodo.createTask(value);
      setInput('');
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function toggleTask(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.completeTask(task.id, !task.completed);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function deleteTask(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.deleteTask(task.id);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function moveTask(task: Task, direction: -1 | 1): Promise<void> {
    const group = task.completed ? completedTasks : activeTasks;
    const fromIndex = group.findIndex((candidate) => candidate.id === task.id);
    const toIndex = fromIndex + direction;
    if (fromIndex < 0 || toIndex < 0 || toIndex >= group.length) {
      return;
    }

    const nextGroup = [...group];
    const [moved] = nextGroup.splice(fromIndex, 1);
    nextGroup.splice(toIndex, 0, moved);
    const nextVisible = task.completed ? [...activeTasks, ...nextGroup] : [...nextGroup, ...completedTasks];

    try {
      setError(null);
      await window.memoTodo.reorderTasks(nextVisible.map((candidate) => candidate.id));
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function beginEdit(task: Task): void {
    setEditingId(task.id);
    setDraftTitle(task.title);
  }

  async function commitEdit(task: Task): Promise<void> {
    const title = draftTitle.trim();
    if (!title || title === task.title) {
      setEditingId(null);
      return;
    }

    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, { title });
      setEditingId(null);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function handleEditKey(event: KeyboardEvent<HTMLInputElement>, task: Task): void {
    if (event.key === 'Enter') {
      void commitEdit(task);
    }
    if (event.key === 'Escape') {
      setEditingId(null);
    }
  }

  async function updateSettings(patch: Partial<Settings>): Promise<void> {
    try {
      setError(null);
      const next = await window.memoTodo.updateSettings(patch);
      setSettings(next);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  const shellStyle = {
    '--panel-opacity': String(settings?.themeOpacity ?? 0.92)
  } as React.CSSProperties;

  return (
    <main className="app-shell" style={shellStyle}>
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            <Check size={15} strokeWidth={3} />
          </span>
          <div>
            <h1>Memo ToDo</h1>
            <p>{activeTasks.length} 项待办</p>
          </div>
        </div>
        <div className="title-actions">
          <button
            className="icon-button"
            type="button"
            title={settings?.alwaysOnTop ? '取消置顶' : '置顶'}
            onClick={() => void updateSettings({ alwaysOnTop: !settings?.alwaysOnTop })}
          >
            {settings?.alwaysOnTop ? <Pin size={17} /> : <PinOff size={17} />}
          </button>
          <button
            className="icon-button"
            type="button"
            title="设置"
            onClick={() => setSettingsOpen((value) => !value)}
          >
            <SettingsIcon size={17} />
          </button>
          <button className="icon-button" type="button" title="隐藏" onClick={() => void window.memoTodo.hideApp()}>
            <EyeOff size={17} />
          </button>
        </div>
      </header>

      {settingsOpen && settings ? (
        <section className="settings-panel">
          <label className="switch-row">
            <span>开机启动</span>
            <input
              type="checkbox"
              checked={settings.launchAtLogin}
              onChange={(event) => void updateSettings({ launchAtLogin: event.currentTarget.checked })}
            />
          </label>
          <label className="range-row">
            <span>透明度</span>
            <input
              type="range"
              min="0.82"
              max="0.98"
              step="0.02"
              value={settings.themeOpacity}
              onChange={(event) => void updateSettings({ themeOpacity: Number(event.currentTarget.value) })}
            />
          </label>
        </section>
      ) : null}

      <section className="task-list" aria-label="任务列表">
        {visibleTasks.length === 0 ? (
          <div className="empty-state">
            <Check size={26} />
            <span>今天没有待办</span>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <article className={`task-row ${task.completed ? 'is-completed' : ''}`} key={task.id}>
              <button className="check-button" type="button" title="完成" onClick={() => void toggleTask(task)}>
                {task.completed ? <Check size={16} strokeWidth={3} /> : null}
              </button>

              <div className="task-main">
                {editingId === task.id ? (
                  <input
                    className="edit-input"
                    autoFocus
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.currentTarget.value)}
                    onKeyDown={(event) => handleEditKey(event, task)}
                    onBlur={() => void commitEdit(task)}
                  />
                ) : (
                  <button className="task-title" type="button" title="编辑" onDoubleClick={() => beginEdit(task)}>
                    {task.title}
                  </button>
                )}
                {task.reminderAt ? (
                  <span className="task-reminder">
                    <Bell size={12} />
                    {formatReminder(task.reminderAt)}
                  </span>
                ) : null}
              </div>

              <div className="task-actions">
                <button
                  className="tiny-button"
                  type="button"
                  title="上移"
                  disabled={isFirstInGroup(task, activeTasks, completedTasks)}
                  onClick={() => void moveTask(task, -1)}
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  title="下移"
                  disabled={isLastInGroup(task, activeTasks, completedTasks)}
                  onClick={() => void moveTask(task, 1)}
                >
                  <ChevronDown size={14} />
                </button>
                <button className="tiny-button danger" type="button" title="删除" onClick={() => void deleteTask(task)}>
                  <Trash2 size={14} />
                </button>
              </div>
            </article>
          ))
        )}
      </section>

      {error ? (
        <div className="error-line">
          <span>{error}</span>
          <button type="button" title="关闭" onClick={() => setError(null)}>
            <X size={14} />
          </button>
        </div>
      ) : null}

      <form className="quick-add" onSubmit={(event) => void addTask(event)}>
        <Plus size={18} />
        <input
          value={input}
          onChange={(event) => setInput(event.currentTarget.value)}
          placeholder="新待办"
          aria-label="新待办"
        />
      </form>
    </main>
  );
}

function isFirstInGroup(task: Task, activeTasks: Task[], completedTasks: Task[]): boolean {
  const group = task.completed ? completedTasks : activeTasks;
  return group[0]?.id === task.id;
}

function isLastInGroup(task: Task, activeTasks: Task[], completedTasks: Task[]): boolean {
  const group = task.completed ? completedTasks : activeTasks;
  return group[group.length - 1]?.id === task.id;
}

function formatReminder(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDelta = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (dayDelta === 0) {
    return `今天 ${time}`;
  }
  if (dayDelta === 1) {
    return `明天 ${time}`;
  }
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

function pad(value: number): string {
  return value.toString().padStart(2, '0');
}

function toMessage(cause: unknown): string {
  if (cause instanceof Error) {
    return cause.message;
  }
  return '操作失败';
}
