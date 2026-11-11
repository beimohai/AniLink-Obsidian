# AniLink

在 Obsidian 中管理追番、RSS下载、B站弹幕、本地播放和 Bangumi 进度评价。

版本 **1.0.0**，更新日期 **2026-11-11**。

## 环境与依赖

- Windows桌面版Obsidian 1.15.0或更高版本。
- qBittorrent，启用Web UI与RSS，手动设置账号密码。
- 弹弹play支持视频与同名XML弹幕。PotPlayer、mpv、VLC可打开视频，其弹幕扩展需另行配置，尚未验证自动载入兼容。
- 音频校准需要Python、NumPy及FFmpeg可从PATH调用，安装NumPy使用 `python -m pip install numpy`。
- Bangumi进度写入需要Access Token，B站获取弹幕需要可用网页会话。

不依赖其他Obsidian社区插件。参考源码目录、ANI-RSS以及公共弹幕聚合服务均非基础流程依赖。

## 安装与连接

将发行包中的main.js、manifest.json、styles.css、align-audio.py放到库的`.obsidian/plugins/anilink`，在社区插件中启用。

打开连接配置，填写Bangumi Token、qBittorrent程序路径、Web UI地址（默认http://127.0.0.1:8080）、账号密码、独立下载目录及播放器程序路径。目录和程序可通过选择按钮填写。登录bilibili并保存UP主UID。路径应按本机填写，无需建立作者的目录。

qBittorrent关闭时，手动下载会尝试启动本机程序并等待API。RSS规则保存在qBittorrent，只有它运行时才能检查并下载。Windows开机和自动退出调度尚未作为默认功能安装。

## 使用

搜索番剧并加入在看，选择字幕组订阅。下载完成后选择分集播放，开启音频校准时，插件逐来源核对偏移、合并XML后再启动播放器。看完点看到这里，进度进入Bangumi同步队列。

最后一集看到这里、弃番会清理番剧独立目录和RSS，搁置暂停订阅并保留文件。请确认下载目录及清理设置。

## 范围与限制

B站搜索受来源、登录和风控影响，尚未遍历全部UP主合集。音频校准支持可信的一致偏移，分段删减时间轴尚未实现。校准失败会报告错误。番库关联失败时可能退回站内检索。浏览器预览依赖网络与Obsidian Web viewer能力。

首次使用请检查下载目录、状态同步、清理规则与播放器弹幕载入。日志只在本机生成，反馈前移除账号与路径等私人信息。

## 隐私与协议

Token及连接配置保存在本机，网页登录Cookie由Electron会话保存。视频内容无需上传，校准在本机处理。日志和凭据不属于发行包。

本项目采用MIT协议。外部服务与软件遵循各自协议。

## 支持与反馈

插件设置中提供赞助与支持及问题反馈面板，作者主页为[北漠海](https://space.bilibili.com/1065768987)。
