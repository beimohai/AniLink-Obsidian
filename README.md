# AniLink

<div align="center">

<img src="assets/branding/anilink-icon-white.svg" alt="AniLink 图标" width="96" />

中文 | [English](README_EN.md)

[下载插件](https://github.com/beimohai/AniLink-Obsidian/releases/latest) · [使用流程](docs/WORKFLOW.md) · [更新日志](CHANGELOG.md) · [反馈问题](https://github.com/beimohai/AniLink-Obsidian/issues)

</div>

## 项目简介

AniLink 是一款面向 Windows 桌面端的 [Obsidian](https://obsidian.md/) 追番整合插件。将番剧检索、字幕组 RSS、本地下载、弹幕、播放、观看进度和 Bangumi 评价集中在一个页面。

- **统一书架**：季度、追番状态、标题筛选与最近更新排序，展示本地可观看的分集。
- **订阅与下载**：在插件中查找蜜柑字幕组，选择语言、编码及字幕版本，交给 qBittorrent 管理 RSS 与下载。
- **弹幕与播放**：从配置的 Bilibili UP 主匹配分集，获取并合并 XML 弹幕；可先校准时间偏移再启动播放器。
- **进度与评价**：手动“看到这里”，维护 Bangumi 收藏状态、评分和短评，后台队列推送修改。
- **番剧信息**：切换 Bangumi、番库、评分趋势预览，也可以打开对应网页。

作者：[北漠海](https://space.bilibili.com/1065768987) · 当前版本 **1.0.6** · 更新日期 **2026-11-14**

## 当前功能与设置

- 通用设置提供操作日志范围、保留时间和默认番剧选择。
- Bangumi 支持收藏、进度、评分、短评推送与拉取，以及定时同步和冲突选择。网页镜像只切换网页域名，API 使用官方服务。
- qBittorrent 保存每部番剧的 RSS 规则，可配置登录检查和下载完成后的空闲退出。
- 字幕组选择提供独立的自定义搜索。自定义 RSS 提供保存目录、开始状态、重复间隔和资源更新策略。
- 资源更新策略支持保留当前规则、仅下载最新修订版，以及仅替换未看集。已看集不会自动补下载，多集种子保留保护。
- 本地管理提供媒体库路径、三档自动清理和删除种子开关。远程库通过 rclone 访问，可选 Kodi、Jellyfin、Emby 播放控制。
- bilibili 支持账号资料展示、官方番剧弹幕优先、UP 主来源和屏蔽规则同步。

### 使用资源更新策略

在订阅区域打开“自定义 RSS”，选择“资源更新策略”。修订号从资源标题的 v2、v3 等编号识别。插件运行时每十分钟检查一次已启用该策略的订阅。自动替换只处理能唯一映射的未看分集，关联其他分集的种子会保留。Obsidian 关闭期间仅运行 qBittorrent 自身规则。

插件仍在持续完善，网络服务、浏览器预览和播放器兼容性可能因环境而异。欢迎提供最小复现步骤，勿在公开反馈中上传 Token、Cookie 或完整私人日志。

## 快速入门

### 安装插件

目前尚未进入 Obsidian 社区插件目录，请从 [GitHub Releases](https://github.com/beimohai/AniLink-Obsidian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放入库的 `.obsidian/plugins/anilink/`，重新加载 Obsidian 后启用 AniLink。

1.0.1 起音频校准脚本内置于 `main.js`，首次校准时写入插件目录。使用 Windows 登录启动和自动退出功能时，还需将安装包中的 `download-scheduler.ps1`、`install-scheduler.ps1` 放入同一插件目录。更新时保留个人配置与媒体文件。

### 依赖安装与连接配置

从 Obsidian 设置中打开 AniLink，按需配置所用服务。设置修改后自动保存。AniLink 不需要其他 Obsidian 社区插件。

| 功能 | 依赖与安装 | 连接配置中的操作 |
| --- | --- | --- |
| 基础运行 | Windows 桌面版 [Obsidian](https://obsidian.md/) ≥ 1.15.0。安装并启用 AniLink。 | 无。 |
| 书架、搜索与评价同步 | [Bangumi](https://bgm.tv/) 账号和 Access Token。通过“获取 Token”打开授权页后复制令牌。 | 将令牌粘贴到 **Bangumi → Access Token**。令牌属于私密凭据，不应分享或提交到仓库。插件的搜索、分集和收藏同步使用官方带令牌 v0 API。 |
| RSS 下载 | [qBittorrent](https://www.qbittorrent.org/) Windows 版。安装后在“工具 → 选项 → Web UI”启用 Web UI，并自行设定端口、用户名和密码；RSS 功能保持启用。 | 填写 Web UI 地址、程序路径、用户名、密码和下载目录。默认地址为 `http://127.0.0.1:8080`。普通“刷新”不会连接、探测或启动 qBittorrent；只有明确的订阅、下载、清理和“检查连接”操作才会使用它。 |
| 本地播放 | 推荐安装 [弹弹play](https://www.dandanplay.com/)；PotPlayer、mpv、VLC 也可以作为播放器，但 XML 弹幕加载取决于各自扩展。 | 在 **播放器 → 程序路径** 选择可执行文件。视频目录必须允许创建同名 XML 文件。 |
| 弹幕偏移纠正 | 安装 [Python](https://www.python.org/downloads/windows/) 并勾选加入 PATH；安装 [FFmpeg](https://ffmpeg.org/download.html) 后将其 `bin` 目录加入 PATH。 | 在 **播放器 → 弹幕偏移纠正** 点击“检查依赖”。NumPy 缺失时可点击“安装 NumPy”，插件将执行 `python -m pip install --user numpy`；FFmpeg 是系统级软件，插件只检查，不会静默安装。该功能仅在播放时抓取弹幕时执行，可随时关闭。 |
| Bilibili 弹幕来源 | Bilibili 登录会话；部分搜索、音轨或弹幕访问可能要求登录并受服务端风控影响。 | 在 **bilibili** 区登录，并按需填写限定的 UP 主 UID。登录过期后重新登录。 |
| SMB / Windows 共享 | 无需额外协议配置；使用 `\服务器\共享` 或映射盘。 | 在 **媒体存储与路径映射** 选择 SMB，填写下载器路径前缀和 UNC/盘符形式的本机路径。 |
| NFS | 先用 Windows 或 NAS 客户端将 NFS 导出挂载为盘符/目录。 | 选择 NFS，填写挂载后的本机路径；不能直接填写 NFS URL。 |
| WebDAV、SFTP、FTP/FTPS | 用 Windows 客户端、同步工具或 [rclone](https://rclone.org/) 将远端挂载或同步为本机目录。 | 选择对应协议，填写下载器路径前缀和本机挂载点，并点击“检查本机路径”。AniLink 不保存远端账号、密码或 URL。 |
| rclone | 安装 rclone，先在终端完成 `rclone config`，再用 `rclone mount remote: X:` 或同步命令创建本机目录。 | 选择 rclone，填写本机挂载点。挂载在 Obsidian 启动后断开时，检查会明确提示路径不可访问。 |

Bangumi 设置中的“使用镜像网站”同时切换网页至 `bangumi.lat`、API 至 `api.bangumi.lat`，关闭时使用官方域名。镜像列表由 [bangumi.wiki](https://bangumi.wiki/api/v1/mirrors) 提供，镜像服务会接收同步所需的访问令牌和数据。

建议为 AniLink 使用独立媒体目录，不要将个人文档或多个番剧混放在同一番剧目录内。自动清理会实际删除媒体文件。

## 追番全流程

1. **添加番剧**：搜索中文名、日文名或 Bangumi ID，选择“在看”等状态加入书架。已有书架条目直接打开；Bangumi、番库按钮用于网页访问。
2. **选择版本**：进入字幕组查找，选择正确季度与字幕组，查看语言、编码和字幕形式；需要时填写自定义 RSS。自动下载会按已看进度跳过前面的集数。
3. **等待更新**：qBittorrent 运行期间按 RSS 设置检查更新并下载，插件轮询下载情况。本地已下载的未看分集显示待看提示；官方播出日期不代表字幕资源已经可用。
4. **播放分集**：选择本地分集并播放。插件尝试匹配限定 UP 主的相应集数，获取弹幕；启用校准时逐来源比较音轨、调整时间后合并 XML，再启动播放器。首次处理耗时受网络、来源数量和文件长度影响，不能保证即时完成。
5. **确认进度**：看完后点击“看到这里”，此前普通分集一并标为看过。仅打开视频不会自动标记看完，避免半途退出造成误标。
6. **同步评价**：选择追番状态、评分与短评并保存，修改进入 Bangumi 后台同步队列。在“同步”查看任务与日志，需要时导出脱敏日志反馈。
7. **收尾清理**：按当前清理设置，最后一集标记完成或弃番可清理该番独立目录、RSS 与关联任务；搁置暂停订阅并保留文件。需要收藏视频时先关闭自动清理。

### 下载器运行方式

RSS 规则保存在 qBittorrent，只有下载器运行时才会检查与下载。Obsidian 关闭后插件自身不会继续轮询。手动下载可在已配置程序路径时尝试启动下载器。

qBittorrent 设置提供 Windows 登录启动开关，以及检查订阅、下载完成退出和空闲退出设置。启用登录启动时插件创建 Windows 启动项，运行时由随插件分发的 PowerShell 调度脚本执行。Obsidian 关闭后已配置的启动项仍可运行。

### 官方弹幕与删减时间

“播放器与弹幕”中的“启用官方番剧弹幕”会将正版弹幕与 UP 主来源合并。“启用港澳台弹幕”单独控制区域来源，访问取决于当前网络出口和账号权限。支持《异世界舅舅》与官方名称《奇幻世界舅舅》的对应。播放准备期间显示处理状态，Windows 本地播放器启动后会尝试移至主屏并置前。

官方弹幕采用 [AniClip](https://github.com/bili-vd-bak/aniclip) 的删减时间数据，核对集数与来源 CID 后，对有时长的视频删减片段分段延后弹幕。画面替换条目保持原时间。该对齐以本地视频保留被删片段为前提，已有同名 XML 在替换前备份。数据覆盖范围和准确度由上游决定，原数据由汇总酱整理并按 CC BY-NC-SA 4.0 许可提供。

## 自定义与数据管理

- 在插件设置中调整顶部按钮顺序、默认季度与排序、搜索状态按钮、网页打开方式及番剧信息默认页面。
- 连接地址、程序路径、媒体目录与 UP 主来源按设备配置；音频校准和自动清理按观看习惯调整。
- 完整状态保存在库内 `.obsidian/plugins/anilink/data.json`，包括书架、进度、评价、订阅、连接凭据与待同步队列。旧版 `%LOCALAPPDATA%/AniLink/` 数据在首次升级时自动迁入，旧文件保留供恢复。复制插件目录会带上完整数据。凭据没有加密，请只同步到自己的私人空间。
- 可选跨设备共享文件包含书架、进度、评分及短评，不包含本机路径和连接凭据；私密短评仍属于共享内容。插件不提供云传输或端到端加密，需使用自己的同步空间。移动或复制库时保留插件的 data.json。系统目录只新增设备标识文件，用于区分多设备修改。
- 视频及 XML 位于指定媒体目录；网页登录由 Electron 会话保存。备份和清理共享数据时请阅读 [隐私与安全](SECURITY.md)。

## 常见问题与边界


**刷新会启动或检查下载器吗？** 不会。刷新只扫描已记录媒体文件的本地可访问性、执行 Bangumi 同步及元数据工作，不会访问 qBittorrent Web UI、RSS 或规则。下载器相关操作由明确的订阅、下载、清理或“检查连接”触发。

**网页预览打不开？** 预览依赖 Obsidian Web viewer、站点嵌入限制、登录会话和网络。可切换默认浏览器打开；番库无法确定条目时可能退回检索页，不保证所有译名与续季均能唯一关联。

**B站返回 412？** 这是服务端风控，登录会话不保证解除。减少请求、稍后重试或重新测试登录状态；插件不保证每个来源始终可访问。限定 UP 主检索也不等于已经遍历其全部合集与分 P。

**偏移是否一定能校准？** 当前处理音轨间的一致时间偏移，不支持所有剪辑、分段删减或变速版本。结果不可信时会报错，不应把错误偏移写入弹幕。可在设置中关闭校准。

**为何需要系统权限？** 插件直接读取外部媒体目录、生成 XML、按设置删除媒体，通过子进程启动播放器与音频校准程序；粘贴按钮在点击时读取剪贴板。这些是桌面功能所需，不代表 Obsidian 的安全审查已豁免。不要加载来源不明的 RSS 或配置。

## 开发与构建

```bash
npm ci
npm run build
npm run lint
npm test
npm run check
npm run package
```

使用 Node.js 24 与已提交的锁文件。`src/` 为界面及整合源码，`core.js` 为核心逻辑，`scripts/align-audio.py` 为独立音频校准实现。构建生成根目录 `main.js`；本地安装包生成在 `dist/anilink/`。更多内容见 [开发说明](docs/DEVELOPMENT.md) 与 [测试说明](docs/TESTING.md)。

## 赞助与支持

如果这个插件帮你省下了管理追番的时间，欢迎支持后续维护，谢谢！

![微信与支付宝收款码](assets/community/support.png)

## 反馈与交流

- [反馈问题与功能建议](https://github.com/beimohai/AniLink-Obsidian/issues)
- [提交 Pull Request](https://github.com/beimohai/AniLink-Obsidian/pulls)
- [作者 GitHub](https://github.com/beimohai)
- [作者 Bilibili](https://space.bilibili.com/1065768987)
- QQ 交流群：**588526922**

![QQ 交流群](assets/community/qq-group.jpg)

反馈时请附插件版本、Obsidian 版本、操作步骤、期望与实际结果。日志先删除 Token、Cookie、账号及私人路径；不要上传本地配置文件或视频。

## 开源协议与致谢

本项目采用 [MIT License](LICENSE)。Obsidian、Bangumi、蜜柑、番库、Bilibili、qBittorrent、弹弹play及其他外部服务或软件遵循各自协议。AniLink 是整合工具，不代表这些项目官方，不提供视频资源的版权授权。

_世界因开源更精彩_
