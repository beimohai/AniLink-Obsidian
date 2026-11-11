# AniLink

<div align="center">

**接住每一次更新**

[下载插件](https://github.com/beimohai/AniLink-Obsidian/releases/latest) · [使用流程](docs/WORKFLOW.md) · [更新日志](CHANGELOG.md) · [反馈问题](https://github.com/beimohai/AniLink-Obsidian/issues)

</div>

中文 | [English](README.en.md)

## 项目简介

AniLink 是一款面向 Windows 桌面端的 [Obsidian](https://obsidian.md/) 追番整合插件。将番剧检索、字幕组 RSS、本地下载、弹幕、播放、观看进度和 Bangumi 评价集中在一个页面，无需为每部番剧创建笔记。

- **统一书架**：季度、追番状态、标题筛选与最近更新排序，展示本地可观看的分集。
- **订阅与下载**：在插件中查找蜜柑字幕组，选择语言、编码及字幕版本，交给 qBittorrent 管理 RSS 与下载。
- **弹幕与播放**：从配置的 Bilibili UP 主匹配分集，获取并合并 XML 弹幕；可先校准时间偏移再启动播放器。
- **进度与评价**：手动“看到这里”，维护 Bangumi 收藏状态、评分和短评，后台队列推送修改。
- **番剧信息**：切换 Bangumi、番库、评分趋势预览，也可以打开对应网页。

作者：[北漠海](https://space.bilibili.com/1065768987) · 当前版本 **1.0.3** · 更新日期 **2026-11-12**

插件仍在持续完善，网络服务、浏览器预览和播放器兼容性可能因环境而异。欢迎提供最小复现步骤，勿在公开反馈中上传 Token、Cookie 或完整私人日志。

## 快速入门

### 安装插件

目前尚未进入 Obsidian 社区插件目录，请从 [GitHub Releases](https://github.com/beimohai/AniLink-Obsidian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`，放入库的 `.obsidian/plugins/anilink/`，重新加载 Obsidian 后启用 AniLink。

1.0.1 起音频校准脚本内置于 `main.js`，首次校准时写入插件目录，不再需要单独下载 Python 脚本。更新时替换上述三个文件，保留个人配置与媒体文件。请勿把源码压缩包当作可直接安装的插件。

### 安装哪些外部软件

| 软件或账号 | 用途 | 是否必需 |
| --- | --- | --- |
| Windows 桌面版 Obsidian ≥ 1.15.0 | 运行插件 | 必需 |
| [qBittorrent](https://www.qbittorrent.org/) | 下载、RSS 规则与任务管理 | 下载功能必需 |
| [弹弹play](https://www.dandanplay.com/) | 本地视频及同名 XML 弹幕播放 | 推荐；也可配置其他播放器 |
| Python、NumPy、FFmpeg | 本地音频时间偏移校准 | 开启音频校准时必需 |
| Bangumi 账号及 Access Token | 同步收藏、进度和评价 | 远端同步必需 |
| Bilibili 登录会话 | 来源检索、弹幕及音轨访问 | 相关访问可能需要登录 |

不需要其他 Obsidian 社区插件，不依赖作者电脑的路径。ANI-RSS、AutoBangumi、公共弹幕聚合 API 和参考源码目录不是基础流程依赖。PotPlayer、mpv、VLC 可作为视频播放器，但弹幕扩展需自行配置，不能保证与弹弹play相同的自动载入效果。

音频校准环境：安装 Python 后执行 `python -m pip install numpy`，将 FFmpeg 加入 PATH。确认 `python --version` 与 `ffmpeg -version` 可在终端运行。插件不会自动安装这些软件。

### 连接配置

从右上角打开“连接配置”，按本机填写并保存；关闭窗口不保存修改。

1. **Bangumi**：获取个人 Access Token，粘贴到输入框。有效期与权限由 Bangumi 决定，不要分享令牌。
2. **qBittorrent**：填写程序路径和下载目录；在 qBittorrent 设置中开启 Web UI 与 RSS，手动设置用户名和密码。默认地址 `http://127.0.0.1:8080`，须与软件监听端口一致。Web UI 是插件提交下载、查询任务和管理 RSS 的控制接口，不是必须手动打开的下载页面。这里使用账号密码登录，不支持 API 密钥替代。
3. **播放器**：选择播放器可执行文件。建议使用弹弹play，视频目录需要允许生成同名 XML 文件。
4. **Bilibili**：扫码登录，检查用户名、UID 与登录状态；按需修改限定搜索的 UP 主 UID。登录过期后需要重新登录。

建议为 AniLink 使用独立媒体目录，不要将个人文档或多个番剧混放在同一个番剧目录内。自动清理会实际删除媒体文件。

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

“开机检查、下载完成退出、空闲退出”需要另行配置系统启动或调度，插件默认安装不会创建 Windows 启动项。不要把插件中的下载策略选项理解为已经安装系统调度服务。其他下载器尚无等价适配。

## 自定义与数据管理

- 在插件设置中调整顶部按钮顺序、默认季度与排序、搜索状态按钮、网页打开方式及番剧信息默认页面。
- 连接地址、程序路径、媒体目录与 UP 主来源按设备配置；音频校准和自动清理按观看习惯调整。
- 完整状态保存在库内 `.obsidian/plugins/anilink/data.json`，包括书架、进度、评价、订阅、连接凭据与待同步队列。旧版 `%LOCALAPPDATA%/AniLink/` 数据在首次升级时自动迁入，旧文件保留供恢复。复制插件目录会带上完整数据。凭据没有加密，请只同步到自己的私人空间。
- 可选跨设备共享文件包含书架、进度、评分及短评，不包含本机路径和连接凭据；私密短评仍属于共享内容。插件不提供云传输或端到端加密，需使用自己的同步空间。移动或复制库时保留插件的 data.json。系统目录只新增设备标识文件，用于区分多设备修改。
- 视频及 XML 位于指定媒体目录；网页登录由 Electron 会话保存。备份和清理共享数据时请阅读 [隐私与安全](SECURITY.md)。

## 常见问题与边界

**下载成功却出现连接错误？** 下载接口与后续状态检查是不同请求。先检查 qBittorrent 是否仍运行、Web UI 端口和认证是否正确；保留发生时间与脱敏日志，不能只凭连接失败判定下载失败。

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

_开源让世界更美好。_
