# MyBatis SQL 还原（DBX 插件）

粘贴 MyBatis / MyBatis-Plus 的 DEBUG 日志，自动把 `Parameters:` 行里的参数回填到 `Preparing:` 的 SQL 占位符 `?` 中，得到可直接执行的 SQL。

纯前端插件（无原生 Sidecar、零权限声明），一个 universal 包跨平台安装。

## 功能

- 一次粘贴多条日志，逐条生成可执行 SQL（配对 `Preparing:` / `Parameters:` / `Total:`，行首 `==>` / `<==` 箭头有无均可，整行日志或仅 Preparing/Parameters 部分都能识别）
- 类型感知回填：数字/布尔原样，String/时间加单引号（内部 `'` 转义为 `''`），`null` 输出 `NULL`；兼容短类名 `(String)` 与全类名 `(java.lang.String)`
- 参数替换跳过 SQL 字符串字面量里的 `?`（如 `'a?b'` 不会被误替换）
- 参数值内含逗号、引号也能正确解析
- 每条 SQL 显示 mapper 方法名、时间戳、TRACEID、返回行数（Total）、参数个数，可展开参数明细
- 参数数量与占位符数量不匹配时给出警告，而不是静默出错
- 一键复制回填后的 SQL（走 DBX 剪贴板桥接，自动降级）
- 跟随 DBX 明暗主题

## 开发

```bash
# 单元测试（node 即可，无需构建）
node test/run.mjs

# 本地调试宿主（打开 http://127.0.0.1:5190/）
dbx-plugin dev --path . --port 5190

# 打包（产物在 dist/，universal 跨平台）
dbx-plugin package . --target universal
```

在 DBX 桌面端安装 `dist/*.dbxp` 需要在插件中心开启「允许安装未签名开发包」。`.dbx-dev/` 存本地调试数据，不要提交或打包。完整开发文档（Manifest、Host API、发布流程）见 [DBX 插件开发指南](https://dbxio.com/en/docs/plugin-development)。

## 上架官方商店

当前 `id`（`dev.local.mybatis-sql-fill`）和 `publisher`（`dev-local`）为本地开发占位，上架前改为自己的标识（发布后不可改）。流程：

1. 修改 manifest 的 `id` / `publisher` / `source` / `homepage`，递增版本
2. 推送源码到自己的仓库，打 Tag 发 Release（`.dbxp` + `.artifact.json` 由 `.github/workflows/plugin-release.yml` 自动构建）
3. 首次上架向 `t8y2/dbx-store:main` 提交 `publishers/` + `candidates/` 的 PR（登记自动同步后新版本可自动建 PR）
4. 维护者审核、签名、合并后进入官方目录

插件功能代码只进本仓库；不要把源码或 `.dbxp` 提交到 `t8y2/dbx`。

## 目录结构

```
manifest.json        # 插件身份、权限（空）、workbench 贡献点、中文本地化
ui/index.html        # 工作台入口
ui/app.js            # 解析引擎（纯函数，export 供 Node 测试）+ UI 逻辑
ui/style.css         # 基于 DBX 主题 tokens 的样式（带 fallback）
test/run.mjs         # 解析引擎测试（真实日志样例 + 边界用例）
dbx-plugin.toml      # 打包 include 配置（assets、ui；test/ 不入包）
```
