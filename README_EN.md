# AniLink

<div align="center">
<img src="assets/branding/anilink-icon-white.svg" alt="AniLink logo" width="96" />

[中文](README.md) | English
</div>

<div align="center">

**Anime subscriptions, downloads, playback and progress in Obsidian**

[中文文档](README.md) | English

</div>

## Project overview

AniLink is a Windows desktop plugin for [Obsidian](https://obsidian.md/). It brings anime discovery, subtitle-group RSS subscriptions, qBittorrent downloads, local playback, Bilibili danmaku, and Bangumi progress and reviews into one dashboard.

- Browse your anime shelf by season, collection status, title, or recently downloaded updates.
- Search Bangumi and find subtitle-group feeds through Mikan, or provide a custom RSS feed.
- Download episodes with qBittorrent and open local files in your configured player.
- Match Bilibili episode sources from selected uploaders, merge XML danmaku, and optionally align their timing with local audio.
- Update watched progress manually, save ratings and reviews, and push changes through the Bangumi task queue.
- Preview Bangumi, Fanku and rating trends, or open their websites.

Author on Bilibili [北漠海](https://space.bilibili.com/1065768987). See the [changelog](CHANGELOG.md) for releases and the [Chinese documentation](README.md) for detailed configuration.

## Quick start

### Install from GitHub Releases

1. Download `main.js`, `manifest.json` and `styles.css` from [Releases](https://github.com/beimohai/AniLink-Obsidian/releases/latest).
2. Place the three files in `.obsidian/plugins/anilink/` inside your vault.
3. Reload Obsidian and enable AniLink under Community plugins.
4. Open Connection configuration and configure your accounts, downloader and player.

AniLink has not been listed in the community plugin catalog. For manual updates, replace the three release files and keep `data.json`. The audio helper is bundled in `main.js` and extracted when alignment runs.

### Requirements

| Application or account | Purpose |
| --- | --- |
| Windows desktop Obsidian 1.15.0 or later | Plugin runtime |
| qBittorrent with Web UI and RSS enabled | Downloads and subscription rules |
| DanDanPlay, or another configured video player | Local playback |
| Python, NumPy and FFmpeg on PATH | Optional audio alignment |
| Bangumi access token | Collection, progress, rating and review synchronization |
| Bilibili login session | Access to authenticated searches, source audio and danmaku |

Install NumPy with `python -m pip install numpy`. Check that `python --version` and `ffmpeg -version` work in a terminal. DanDanPlay is recommended for video and companion XML danmaku. PotPlayer, mpv and VLC require their own danmaku support and have different automatic-loading behavior.

Other Obsidian plugins, ANI-RSS, AutoBangumi and public danmaku proxy services are optional integrations. The basic workflow uses qBittorrent directly.

### Configure connections

Enter your Bangumi token, qBittorrent executable, Web UI address, username and password, dedicated media directory, and player executable. The usual local Web UI address is `http://127.0.0.1:8080`. Configure its credentials in qBittorrent itself. This interface lets AniLink submit downloads and manage tasks and RSS rules.

Sign in to Bilibili using the QR login window and configure uploader UIDs as needed. A valid login does not guarantee that Bilibili will accept every request. HTTP 412 is a server-side restriction and can still occur.

## Watching workflow

1. Search for an anime and add it to your shelf with a collection status.
2. Choose the correct season, subtitle group, language and release format, then subscribe.
3. Keep qBittorrent running to check RSS and download new releases. AniLink displays locally available unwatched episodes.
4. Select an episode and play it. When alignment is enabled, AniLink matches source audio, calculates a reliable offset, prepares merged XML and starts the player afterwards.
5. After watching, use the manual progress action to mark episodes up to the selected one as watched.
6. Save your rating and review. Bangumi writes run through the background queue. Use Sync and Logs to inspect failed tasks.
7. Depending on your cleanup settings, completing a season or dropping it can remove its dedicated media folder and RSS tasks. Putting a show on hold pauses subscriptions and keeps files.

Cleanup deletes actual files. Configure a dedicated directory and review cleanup settings before use. qBittorrent RSS checks run only while qBittorrent is running. Windows startup and automatic shutdown scheduling require separate setup.

## Storage and synchronization

Complete plugin data lives in `.obsidian/plugins/anilink/data.json` inside the vault. It includes shelf entries, progress, reviews, subscriptions, connection settings, credentials and queued tasks. Copy this file with the plugin folder to move your setup. Configure your synchronization tool to include community plugin settings or this file explicitly.

Older per-vault files under `%LOCALAPPDATA%/AniLink/` migrate automatically on upgrade and remain available for recovery. A small local device identity stays outside the vault so separate computers can identify their edits.

Credentials in `data.json` are unencrypted. Use private synchronization storage and keep this file out of public repositories. Media files remain in the configured download directory. Website cookies are stored by Electron and can require another login on a different machine. Check executable and media paths after moving devices.

The optional `AniLink-sync` folder exchanges field-level shelf and progress changes between devices while excluding credentials and local execution settings. It requires your own file synchronization service. Private reviews are included in shared progress files. Concurrent file synchronization can still produce conflicts, so keep backups. Read [Security and privacy](SECURITY.md) for details.

## Customization and limitations

Plugin settings provide toolbar ordering, default season and sorting, shelf columns, search status actions, website opening mode, default information page, notifications, cleanup and audio alignment options.

Website previews depend on network access, website restrictions and the Obsidian Web viewer. Fanku matching may fall back to search when the correct entry cannot be determined. Bilibili lookup does not cover every uploader collection. Audio alignment supports a consistent offset and can reject edited, cut or time-stretched sources.

The plugin accesses external media files, launches players and local audio tools, and reads the clipboard when the paste button is used. These permissions are needed by those features.

## Build from source

```bash
npm ci
npm run build
npm run lint
npm test
npm run check
npm run package
```

Use Node.js 24 and the committed lockfile. The production build generates `main.js`. Packaging prepares an installation directory under `dist/anilink/`. See [Development](docs/DEVELOPMENT.md) and [Testing](docs/TESTING.md).

## Sponsorship and support

If AniLink helps you manage your watching routine, you can support its maintenance. Thank you!

![WeChat Pay and Alipay payment codes](assets/community/support.png)

## Feedback and community

- [Report a problem or request a feature](https://github.com/beimohai/AniLink-Obsidian/issues)
- [Submit a pull request](https://github.com/beimohai/AniLink-Obsidian/pulls)
- [Author on GitHub](https://github.com/beimohai)
- [Author on Bilibili](https://space.bilibili.com/1065768987)
- QQ group **588526922**

![QQ community group](assets/community/qq-group.jpg)

Include your plugin and Obsidian versions, reproduction steps, expected behavior and actual result. Remove tokens, cookies, account information and private paths from logs before sharing them.

## License

Released under the [MIT License](LICENSE). External applications and services retain their own licenses and terms.
