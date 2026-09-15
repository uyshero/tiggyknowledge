# 发布新版

桌面版由 GitHub Actions 根据 `v*` 标签自动构建并发布。发布前请确认当前位于
`main` 分支、工作区没有未提交的改动，并且本地分支已经同步到远端。

## 发布命令

把下面的 `0.1.0` 改成要发布的新版本号，然后在仓库根目录逐行执行：

```sh
VERSION=0.1.0

git switch main
git pull --ff-only origin main
git status --short

pnpm version:set "$VERSION"
pnpm version:check "$VERSION"
pnpm typecheck
pnpm exec vitest run apps/desktop/tests packages/client/runtime/tests packages/host/webserver/tests

git add package.json apps/cli/package.json apps/desktop/package.json
git commit -m "chore: release v$VERSION"
git tag -a "v$VERSION" -m "v$VERSION"
git push origin main --follow-tags
```

推送标签后，[Release desktop](https://github.com/uyshero/tiggyknowledge/actions/workflows/release-desktop.yml)
工作流会自动：

1. 校验标签与项目版本是否一致。
2. 执行类型检查和稳定测试集。
3. 构建 Windows x64 NSIS 安装包。
4. 构建 macOS Universal DMG 和 ZIP。
5. 生成 `SHA256SUMS.txt` 并上传到对应的 GitHub Release。

发布完成后，到 [Releases](https://github.com/uyshero/tiggyknowledge/releases)
确认安装包和校验文件都已上传。已安装的桌面客户端会在启动后检查这个最新版本，
用户也可以通过“帮助 → 检查更新…”手动检查。

## 只修改版本但暂不发布

```sh
pnpm version:set 0.1.0
pnpm version:check 0.1.0
```

这两个命令只同步和检查根项目、CLI 与桌面客户端的版本，不会提交、打标签或推送。

## 发布失败时

- 构建失败：修复后提交到 `main`，删除远端和本地的失败标签，再重新打同名标签；或者更稳妥地发布一个新的补丁版本。
- 标签已推送但 Release 缺少附件：先在 Actions 页面查看失败步骤，不要重复创建同名标签。
- 正式对外分发前，应配置 macOS Developer ID/公证和 Windows 代码签名；HTTPS 域名证书不能替代应用代码签名证书。
