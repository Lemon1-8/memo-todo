import { describe, expect, it } from 'vitest';
import { parseTaskInput } from './reminders';

describe('parseTaskInput', () => {
  const now = new Date(2026, 8, 9, 10, 20);

  it('parses today reminders', () => {
    expect(parseTaskInput('今天 14:00 写周报', now)).toEqual({
      title: '写周报',
      reminderAt: new Date(2026, 8, 9, 14, 0).toISOString()
    });
  });

  it('parses tomorrow reminders with Chinese colon', () => {
    expect(parseTaskInput('明天 09：30 整理客户', now)).toEqual({
      title: '整理客户',
      reminderAt: new Date(2026, 8, 10, 9, 30).toISOString()
    });
  });

  it('parses absolute date reminders', () => {
    expect(parseTaskInput('2026-09-10 18:00 健身', now)).toEqual({
      title: '健身',
      reminderAt: new Date(2026, 8, 10, 18, 0).toISOString()
    });
  });

  it('keeps regular tasks unchanged', () => {
    expect(parseTaskInput('整理这几天客户情况', now)).toEqual({
      title: '整理这几天客户情况'
    });
  });

  it('rejects invalid dates as regular text', () => {
    expect(parseTaskInput('2026-02-31 18:00 检查', now)).toEqual({
      title: '2026-02-31 18:00 检查'
    });
  });
});
