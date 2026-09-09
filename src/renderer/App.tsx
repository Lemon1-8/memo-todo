import {
  Archive,
  ArchiveRestore,
  Bell,
  BellOff,
  Check,
  ChevronDown,
  Edit3,
  EyeOff,
  Flag,
  Pin,
  PinOff,
  Plus,
  RotateCcw,
  Search,
  Settings as SettingsIcon,
  Trash2,
  X
} from 'lucide-react';
import { FormEvent, KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { Settings, Task, TaskPriority, TaskStatus } from '../shared/types';
import appIconUrl from './assets/app-icon.png';

type StatusFilter = 'open' | 'all' | 'archived' | TaskStatus;
type PriorityFilter = 'all' | TaskPriority;

interface SelectOption<T extends string> {
  value: T;
  label: string;
}

interface DeletedTaskNotice {
  task: Task;
}

const deleteUndoMs = 8_000;

const statusFilterOptions: Array<SelectOption<StatusFilter>> = [
  { value: 'open', label: '未完成' },
  { value: 'todo', label: '待办' },
  { value: 'doing', label: '进行中' },
  { value: 'waiting', label: '等待' },
  { value: 'done', label: '已完成' },
  { value: 'all', label: '全部' },
  { value: 'archived', label: '归档' }
];

const taskStatusOptions: Array<SelectOption<TaskStatus>> = [
  { value: 'todo', label: '待办' },
  { value: 'doing', label: '进行中' },
  { value: 'waiting', label: '等待' },
  { value: 'done', label: '已完成' }
];

const priorityOptions: Array<SelectOption<PriorityFilter>> = [
  { value: 'all', label: '全部优先级' },
  { value: 'high', label: '高优先级' },
  { value: 'normal', label: '普通优先级' },
  { value: 'low', label: '低优先级' }
];

const priorityLabels: Record<TaskPriority, string> = {
  high: '高',
  normal: '普通',
  low: '低'
};

const statusLabels: Record<TaskStatus, string> = {
  todo: '待办',
  doing: '进行中',
  waiting: '等待',
  done: '已完成'
};

const nextPriority: Record<TaskPriority, TaskPriority> = {
  normal: 'high',
  high: 'low',
  low: 'normal'
};

const priorityRank: Record<TaskPriority, number> = {
  high: 0,
  normal: 1,
  low: 2
};

const statusRank: Record<TaskStatus, number> = {
  doing: 0,
  todo: 1,
  waiting: 2,
  done: 3
};

export function App(): JSX.Element {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [input, setInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('open');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [reminderEditingId, setReminderEditingId] = useState<string | null>(null);
  const [draftReminder, setDraftReminder] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [undoDelete, setUndoDelete] = useState<DeletedTaskNotice | null>(null);
  const undoTimerRef = useRef<number | null>(null);

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

  useEffect(() => {
    return () => clearUndoTimer();
  }, []);

  const sortedTasks = useMemo(() => sortTasksForDisplay(tasks), [tasks]);
  const unarchivedTasks = sortedTasks.filter((task) => !task.archivedAt);
  const openTasks = unarchivedTasks.filter((task) => task.status !== 'done');
  const completedTasks = unarchivedTasks.filter((task) => task.status === 'done');
  const archivedTasks = sortedTasks.filter((task) => task.archivedAt);
  const normalizedSearch = searchQuery.trim().toLocaleLowerCase();
  const statusTasks = getStatusTasks(statusFilter, unarchivedTasks, openTasks, completedTasks, archivedTasks);
  const visibleTasks = statusTasks
    .filter((task) => matchesSearch(task, normalizedSearch))
    .filter((task) => priorityFilter === 'all' || task.priority === priorityFilter);
  const hasFilters = Boolean(normalizedSearch) || priorityFilter !== 'all';

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
      setStatusFilter('open');
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function toggleTask(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.completeTask(task.id, task.status !== 'done');
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function deleteTask(task: Task): Promise<void> {
    try {
      setError(null);
      const deleted = await window.memoTodo.deleteTask(task.id);
      showUndoDelete(deleted);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function restoreDeletedTask(): Promise<void> {
    if (!undoDelete) {
      return;
    }

    const { task } = undoDelete;
    try {
      setError(null);
      await window.memoTodo.restoreTask(task);
      clearUndoTimer();
      setUndoDelete(null);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function archiveCompletedTasks(): Promise<void> {
    if (completedTasks.length === 0) {
      return;
    }

    try {
      setError(null);
      await window.memoTodo.archiveCompletedTasks();
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function beginEdit(task: Task): void {
    setEditingId(task.id);
    setDraftTitle(task.title);
    setReminderEditingId(null);
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

  function beginReminderEdit(task: Task): void {
    setReminderEditingId(task.id);
    setDraftReminder(task.reminderAt ? formatDateTimeInput(task.reminderAt) : createDefaultReminderInput());
    setEditingId(null);
  }

  async function commitReminder(task: Task): Promise<void> {
    const value = draftReminder.trim();
    if (!value) {
      await clearReminder(task);
      return;
    }

    const reminderAt = parseDateTimeLocalInput(value);
    if (!reminderAt) {
      setError('提醒时间无效');
      return;
    }

    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, { reminderAt: reminderAt.toISOString() });
      setReminderEditingId(null);
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function clearReminder(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, { reminderAt: '' });
      setReminderEditingId(null);
      setDraftReminder('');
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  function handleReminderSubmit(event: FormEvent<HTMLFormElement>, task: Task): void {
    event.preventDefault();
    void commitReminder(task);
  }

  function handleReminderKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Escape') {
      setReminderEditingId(null);
    }
  }

  async function cyclePriority(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, { priority: nextPriority[task.priority] });
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function updateTaskStatus(task: Task, status: TaskStatus): Promise<void> {
    if (task.status === status) {
      return;
    }

    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, { status });
    } catch (cause) {
      setError(toMessage(cause));
    }
  }

  async function toggleArchive(task: Task): Promise<void> {
    try {
      setError(null);
      await window.memoTodo.updateTask(task.id, {
        archivedAt: task.archivedAt ? '' : new Date().toISOString()
      });
    } catch (cause) {
      setError(toMessage(cause));
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

  function showUndoDelete(task: Task): void {
    clearUndoTimer();
    setUndoDelete({ task });
    undoTimerRef.current = window.setTimeout(() => {
      setUndoDelete(null);
      undoTimerRef.current = null;
    }, deleteUndoMs);
  }

  function clearUndoTimer(): void {
    if (undoTimerRef.current !== null) {
      window.clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
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
            <img src={appIconUrl} alt="" />
          </span>
          <div>
            <h1>Memo ToDo</h1>
            <p>
              {openTasks.length} 项未完成 · {completedTasks.length} 项完成
            </p>
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
          <label className="switch-row">
            <span>鼠标悬浮唤出</span>
            <input
              type="checkbox"
              checked={settings.hoverToShow}
              onChange={(event) => void updateSettings({ hoverToShow: event.currentTarget.checked })}
            />
          </label>
        </section>
      ) : null}

      <section className="task-toolbar" aria-label="任务筛选">
        <label className="search-field">
          <Search size={14} />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder="搜索"
            aria-label="搜索任务"
          />
          {searchQuery ? (
            <button className="clear-search" type="button" title="清空搜索" onClick={() => setSearchQuery('')}>
              <X size={13} />
            </button>
          ) : null}
        </label>

        <div className="filter-row">
          <DropdownSelect
            className="filter-select"
            value={statusFilter}
            aria-label="状态筛选"
            options={statusFilterOptions}
            onChange={setStatusFilter}
          />

          <DropdownSelect
            className="filter-select priority-filter-select"
            value={priorityFilter}
            aria-label="优先级筛选"
            options={priorityOptions}
            onChange={setPriorityFilter}
          />

          <button
            className="toolbar-button"
            type="button"
            title="归档已完成"
            disabled={completedTasks.length === 0}
            onClick={() => void archiveCompletedTasks()}
          >
            <Archive size={14} />
            <span>归档</span>
          </button>
        </div>
      </section>

      <section className="task-list" aria-label="任务列表">
        {visibleTasks.length === 0 ? (
          <div className="empty-state">
            <Check size={26} />
            <span>{getEmptyMessage(statusFilter, hasFilters, tasks.length)}</span>
          </div>
        ) : (
          visibleTasks.map((task) => (
            <article
              className={getTaskRowClass(task, reminderEditingId === task.id)}
              key={task.id}
              title={getTaskHoverText(task)}
            >
              <button
                className="check-button"
                type="button"
                title={task.status === 'done' ? '标记为待办' : '完成'}
                onClick={() => void toggleTask(task)}
              >
                {task.status === 'done' ? <Check size={16} strokeWidth={3} /> : null}
              </button>

              <div className="task-main">
                {editingId === task.id ? (
                  <input
                    className="edit-input"
                    autoFocus
                    value={draftTitle}
                    title={task.title}
                    onChange={(event) => setDraftTitle(event.currentTarget.value)}
                    onKeyDown={(event) => handleEditKey(event, task)}
                    onBlur={() => void commitEdit(task)}
                  />
                ) : (
                  <button
                    className="task-title"
                    type="button"
                    title={getTaskHoverText(task)}
                    onDoubleClick={() => beginEdit(task)}
                  >
                    {task.title}
                  </button>
                )}

                <div className="task-meta">
                  <DropdownSelect
                    className="task-status-select"
                    buttonClassName={`status-button status-${task.status}`}
                    value={task.status}
                    aria-label={`任务状态：${statusLabels[task.status]}`}
                    title={`状态：${statusLabels[task.status]}`}
                    options={taskStatusOptions}
                    optionClassName={(value) => `status-option status-${value}`}
                    onChange={(status) => void updateTaskStatus(task, status)}
                  />
                  <span className={`priority-badge priority-${task.priority}`}>
                    <Flag size={11} />
                    {priorityLabels[task.priority]}
                  </span>
                  {task.reminderAt ? (
                    <span className="task-reminder">
                      <Bell size={12} />
                      {formatReminder(task.reminderAt)}
                    </span>
                  ) : null}
                  {task.archivedAt ? <span className="archive-badge">已归档</span> : null}
                </div>

              </div>

              <div className="task-actions">
                <button className="tiny-button" type="button" title="编辑" onClick={() => beginEdit(task)}>
                  <Edit3 size={14} />
                </button>
                <button
                  className={reminderEditingId === task.id ? 'tiny-button is-active' : 'tiny-button'}
                  type="button"
                  title={task.reminderAt ? '编辑提醒' : '设置提醒'}
                  onClick={() => beginReminderEdit(task)}
                >
                  <Bell size={14} />
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  title="清除提醒"
                  disabled={!task.reminderAt}
                  onClick={() => void clearReminder(task)}
                >
                  <BellOff size={14} />
                </button>
                <button
                  className={`tiny-button priority-action priority-${task.priority}`}
                  type="button"
                  title={`优先级：${priorityLabels[task.priority]}`}
                  onClick={() => void cyclePriority(task)}
                >
                  <Flag size={14} />
                </button>
                <button
                  className="tiny-button"
                  type="button"
                  title={task.archivedAt ? '恢复归档' : '归档'}
                  onClick={() => void toggleArchive(task)}
                >
                  {task.archivedAt ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                </button>
                <button className="tiny-button danger" type="button" title="删除" onClick={() => void deleteTask(task)}>
                  <Trash2 size={14} />
                </button>
              </div>

              {reminderEditingId === task.id ? (
                <form className="reminder-editor" onSubmit={(event) => handleReminderSubmit(event, task)}>
                  <input
                    type="datetime-local"
                    value={draftReminder}
                    aria-label="提醒时间"
                    onChange={(event) => setDraftReminder(event.currentTarget.value)}
                    onKeyDown={handleReminderKey}
                  />
                  <button className="reminder-save" type="submit" title="保存提醒">
                    <Check size={13} />
                    <span>保存</span>
                  </button>
                  {task.reminderAt ? (
                    <button className="tiny-button" type="button" title="清除提醒" onClick={() => void clearReminder(task)}>
                      <BellOff size={13} />
                    </button>
                  ) : null}
                  <button className="tiny-button" type="button" title="取消" onClick={() => setReminderEditingId(null)}>
                    <X size={13} />
                  </button>
                </form>
              ) : null}
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

      {undoDelete ? (
        <div className="notice-line">
          <span>已删除：{undoDelete.task.title}</span>
          <button type="button" title="撤销删除" onClick={() => void restoreDeletedTask()}>
            <RotateCcw size={14} />
            撤销
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

interface DropdownSelectProps<T extends string> {
  className?: string;
  buttonClassName?: string;
  title?: string;
  value: T;
  options: Array<SelectOption<T>>;
  'aria-label': string;
  optionClassName?: (value: T) => string;
  onChange: (value: T) => void;
}

function DropdownSelect<T extends string>({
  className,
  buttonClassName,
  title,
  value,
  options,
  optionClassName,
  onChange,
  'aria-label': ariaLabel
}: DropdownSelectProps<T>): JSX.Element {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  function handleBlur(event: React.FocusEvent<HTMLDivElement>): void {
    const nextFocus = event.relatedTarget;
    if (!nextFocus || !event.currentTarget.contains(nextFocus as Node)) {
      setOpen(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className={['dropdown-select', className].filter(Boolean).join(' ')} onBlur={handleBlur} onKeyDown={handleKeyDown}>
      <button
        className={['select-button', buttonClassName].filter(Boolean).join(' ')}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title ?? selected?.label}
        onClick={() => setOpen((current) => !current)}
      >
        <span>{selected?.label}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((option) => (
            <button
              className={[
                'select-option',
                option.value === value ? 'is-selected' : '',
                optionClassName?.(option.value) ?? ''
              ]
                .filter(Boolean)
                .join(' ')}
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              <span>{option.label}</span>
              {option.value === value ? <Check size={13} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function getStatusTasks(
  statusFilter: StatusFilter,
  unarchivedTasks: Task[],
  openTasks: Task[],
  completedTasks: Task[],
  archivedTasks: Task[]
): Task[] {
  if (statusFilter === 'all') {
    return [...openTasks, ...completedTasks];
  }
  if (statusFilter === 'archived') {
    return archivedTasks;
  }
  if (statusFilter === 'open') {
    return openTasks;
  }
  return unarchivedTasks.filter((task) => task.status === statusFilter);
}

function sortTasksForDisplay(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (left, right) =>
      priorityRank[left.priority] - priorityRank[right.priority] ||
      statusRank[left.status] - statusRank[right.status] ||
      left.order - right.order ||
      left.createdAt.localeCompare(right.createdAt)
  );
}

function matchesSearch(task: Task, normalizedSearch: string): boolean {
  if (!normalizedSearch) {
    return true;
  }
  return task.title.toLocaleLowerCase().includes(normalizedSearch);
}

function getTaskRowClass(task: Task, hasReminderEditor: boolean): string {
  return [
    'task-row',
    task.status === 'done' ? 'is-completed' : '',
    task.archivedAt ? 'is-archived' : '',
    hasReminderEditor ? 'has-reminder-editor' : '',
    `status-${task.status}`,
    `priority-${task.priority}`
  ]
    .filter(Boolean)
    .join(' ');
}

function getEmptyMessage(statusFilter: StatusFilter, hasFilters: boolean, taskCount: number): string {
  if (hasFilters && taskCount > 0) {
    return '没有匹配任务';
  }
  if (statusFilter === 'todo') {
    return '没有待办任务';
  }
  if (statusFilter === 'doing') {
    return '没有进行中的任务';
  }
  if (statusFilter === 'waiting') {
    return '没有等待中的任务';
  }
  if (statusFilter === 'done') {
    return '没有已完成任务';
  }
  if (statusFilter === 'archived') {
    return '没有归档任务';
  }
  if (statusFilter === 'all') {
    return '没有任务';
  }
  return '没有未完成任务';
}

function getTaskHoverText(task: Task): string {
  return [
    task.title,
    `状态：${statusLabels[task.status]}`,
    `优先级：${priorityLabels[task.priority]}`,
    task.reminderAt ? `提醒：${formatReminder(task.reminderAt)}` : '',
    task.archivedAt ? '归档：是' : ''
  ]
    .filter(Boolean)
    .join('\n');
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

function formatDateTimeInput(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return formatDateTimeLocal(date);
}

function parseDateTimeLocalInput(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return null;
  }

  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const date = new Date(year, monthIndex, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== monthIndex ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date;
}

function createDefaultReminderInput(): string {
  const date = new Date();
  date.setHours(date.getHours() + 1, 0, 0, 0);
  return formatDateTimeLocal(date);
}

function formatDateTimeLocal(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
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
