export interface ParsedTaskInput {
  title: string;
  reminderAt?: string;
}

const timePattern = '([01]?\\d|2[0-3])\\s*[：:]\\s*([0-5]\\d)';
const todayPattern = new RegExp(`^今天\\s+${timePattern}\\s+(.+)$`);
const tomorrowPattern = new RegExp(`^明天\\s+${timePattern}\\s+(.+)$`);
const datePattern = new RegExp(`^(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})\\s+${timePattern}\\s+(.+)$`);

export function parseTaskInput(input: string, now = new Date()): ParsedTaskInput {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) {
    return { title: '' };
  }

  const today = value.match(todayPattern);
  if (today) {
    return withReminder(today[3], makeLocalDate(now.getFullYear(), now.getMonth(), now.getDate(), today[1], today[2]));
  }

  const tomorrow = value.match(tomorrowPattern);
  if (tomorrow) {
    const base = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return withReminder(tomorrow[3], makeLocalDate(base.getFullYear(), base.getMonth(), base.getDate(), tomorrow[1], tomorrow[2]));
  }

  const dated = value.match(datePattern);
  if (dated) {
    const year = Number(dated[1]);
    const monthIndex = Number(dated[2]) - 1;
    const day = Number(dated[3]);
    const date = makeLocalDate(year, monthIndex, day, dated[4], dated[5]);
    if (date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day) {
      return withReminder(dated[6], date);
    }
  }

  return { title: value };
}

function makeLocalDate(year: number, monthIndex: number, day: number, hour: string, minute: string): Date {
  return new Date(year, monthIndex, day, Number(hour), Number(minute), 0, 0);
}

function withReminder(title: string, date: Date): ParsedTaskInput {
  const normalizedTitle = title.trim();
  if (!normalizedTitle) {
    return { title };
  }

  return {
    title: normalizedTitle,
    reminderAt: date.toISOString()
  };
}
