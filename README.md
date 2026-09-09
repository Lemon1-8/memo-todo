# Memo ToDo

一个个人使用的 Windows 桌面待办小组件，使用 Electron、Vite、React 和 TypeScript 构建。

## 功能

- 半透明深色待办小窗口
- 托盘显示、隐藏和退出
- 置顶开关
- 开机启动开关
- 本地 JSON 保存任务和设置
- 一次性提醒，支持 Windows 通知
- 中文快捷输入提醒时间

## 快捷输入

在底部输入框回车即可新增任务。

支持这些提醒格式：

```text
今天 14:00 写周报
明天 09:30 整理客户
2026-09-10 18:00 健身
```

## 开发

```bash
npm install
npm run dev
```

## 验证

```bash
npm run typecheck
npm run test:run
npm run build
```

## 打包 Windows Portable

```bash
npm run dist
```

打包产物会生成在 `release/`，该目录不会提交到 Git。

## 数据位置

应用数据保存在 Electron 的 `userData` 目录下，文件名为 `memo-todo.json`。当前版本不包含账号、云同步或联网依赖。

## License

UNLICENSED。当前项目主要用于个人使用。
