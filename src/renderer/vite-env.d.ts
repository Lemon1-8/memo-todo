import type { MemoTodoApi } from '../shared/api';

declare global {
  interface Window {
    memoTodo: MemoTodoApi;
  }
}

export {};
