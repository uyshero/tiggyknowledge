# 桌面客户端

桌面客户端是套在现有 Host 与 Web 界面外的 Electron 壳。渲染进程保持浏览器安全模型（`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`），由主进程负责启动和停止本机 Host。

## 安装与运行

从 [下载页](/download) 安装对应系统的构建：

- macOS：`TiggyKnowledge-<version>-mac-<arch>.dmg`
- Windows：`TiggyKnowledge-Setup-<version>-win-x64.exe`

当前构建未配置 Developer ID / 公证，也未配置 Windows 代码签名：

- macOS 会提示无法验证开发者。
- Windows SmartScreen 可能提示未知发布者。

请只使用 GitHub Release 中的文件，并核对同目录下的 `SHA256SUMS.txt`。

## 本机服务

默认 Host 端口是 `3210`。智能体连接器默认也使用：

```text
http://127.0.0.1:3210
```

如需更换端口，启动前设置环境变量 `TIGGYKNOWLEDGE_DESKTOP_PORT`。接入智能体时请保持端口稳定。

桌面客户端同时只允许一个实例。再次启动会激活已有窗口。macOS 关闭窗口后，从程序坞点回来会重建窗口，但不会重启 Host。

原生菜单提供新窗口、刷新、缩放、全屏和开发者工具。

## 数据位置

运行时数据写在 Electron 的 `userData` 目录，而不是安装包旁边。

Host API 与智能体接入继续使用同一套 HTTP 约定：`/api/tiggyknowledge/*`。

## 更新检查

打包后的客户端会在启动后检查最新的公开 GitHub Release。仅当 Release 标签是更新的稳定语义化版本时才会提示。

也可以使用「帮助 → 检查更新…」。这一阶段会打开可信的 GitHub Release 页面，不会在后台静默安装软件。

## 从源码运行

开发调试请在仓库根目录执行：

```sh
pnpm desktop:dev
```

这会先构建 Host 与 Web UI，再启动 Electron。产品 Web 界面本身不是本站；本站只负责介绍、下载和文档。
