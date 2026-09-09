# Repository Guidelines

## Project Structure & Module Organization

Memo ToDo is a Windows desktop todo widget built with Electron, Vite, React, and TypeScript. Source code lives under `src/`: `src/main/` contains Electron main-process services such as storage, scheduling, and window state; `src/preload/` exposes the typed bridge to the renderer; `src/renderer/` contains the React UI and CSS; `src/shared/` holds cross-process types, API contracts, and parsing utilities. Tests are colocated with implementation as `*.test.ts`. Build outputs are generated in `dist/`, `dist-electron/`, and `release/` and should not be edited manually.

## Build, Test, and Development Commands

Install dependencies with `npm install`.

- `npm run dev`: builds Electron code, starts Vite on `127.0.0.1:5173`, then launches Electron.
- `npm run typecheck`: runs strict TypeScript checks for renderer and Electron configs.
- `npm run test`: starts Vitest in watch mode.
- `npm run test:run`: runs the test suite once for CI-style validation.
- `npm run build`: typechecks, tests, and builds renderer plus Electron output.
- `npm run dist`: creates the Windows portable package in `release/`.
- `npm start`: builds and starts the packaged local Electron entry point.

## Coding Style & Naming Conventions

Use TypeScript with `strict` settings and React JSX. Follow the existing two-space indentation, single quotes, semicolons, and named exports. Keep shared contracts in `src/shared/` before wiring them through preload or renderer code. Use `PascalCase` for React components and interfaces, `camelCase` for functions, variables, and constants, and descriptive union literals such as `todo`, `doing`, or `waiting`.

## Testing Guidelines

Vitest runs in a Node environment and includes `src/**/*.test.ts`. Add focused tests next to the module being changed, especially for storage normalization, reminder parsing, scheduler behavior, and API contract changes. Prefer deterministic dates and temporary paths over real user data. Run `npm run test:run` and `npm run typecheck` before handing off changes.

## Commit & Pull Request Guidelines

The current history uses a short imperative subject, for example `Initial Memo ToDo desktop app`; keep commits concise and scoped. Pull requests should describe the user-facing change, list validation commands run, link related issues when available, and include screenshots or screen recordings for UI changes. Note any persistence or notification behavior changes explicitly.

## Security & Configuration Tips

The app stores local JSON data in Electron `userData` as `memo-todo.json` and currently has no account, sync, or network dependency. Avoid logging task contents unnecessarily, keep preload APIs narrow and typed, and do not commit generated release artifacts.
