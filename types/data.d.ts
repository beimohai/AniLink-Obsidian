/** Data stored by AniLink; these declarations have no runtime side effects. */
declare namespace AniLinkData {
  interface Settings {
    qbUrl: string; qbUser: string; qbPassword: string; qbExe: string; qbProfile?: string;
    bgmToken: string; bgmSyncMinutes: number; bgmSyncStartup: boolean; bgmSyncExit: boolean;
    bgmAutoComplete: boolean; bgmConflictPolicy: string; bgmMirror: boolean;
    bgmMirrorApi?: boolean; bgmMirrorWeb?: boolean; bgmMirrorData?: boolean;
    playerExe: string; playerUrl: string; playerToken: string; rcloneExe?: string;
    downloadRoot: string; libraryRoot: string; multiLibraryEnabled: boolean; extraLibraryRoots: string[];
    cleanupMode: string; cleanupAfterWatch?: boolean; downloadMode: string; idleMinutes: number; wakeMinutes?: number;
    remoteRoot: string; localRoot: string; storageMode: string; storageLabel: string;
    pollSeconds: number; rssRefreshMinutes: number; rssMinutes?: number; autoRefresh: boolean;
    dateFormat: string; browserMode: string; openFirstShow: boolean; cardDensity: string; showOriginalName: boolean;
    logScope: string; logRetention: string; shelfQuarterDefault: string; shelfSort: string;
    shelfColumns: string; lastShelfQuarter?: string; searchStatuses: number[];
    informationPanel: boolean; informationPage: string; toolbarOrder?: string[];
    downloaderOnStartup: boolean; clearCompletedTasks: boolean; deleteTorrentWithFiles: boolean;
    startupNotifications: boolean; playbackNotifications: boolean; progressNotifications: boolean;
    downloadNotifications: boolean; refreshNotifications: boolean; syncNotifications: boolean;
    rssUpgradeUnwatched: boolean; rssDefaultQuality?: string; rssDefaultLanguage?: string; rssDefaultExclude?: string;
    remoteEnabled: boolean; remoteProtocol: string; remoteAddress?: string; remoteUser?: string;
    remotePassword?: string; remoteDirectory?: string;
    networkPlayer: string; networkPlayerUrl?: string; networkPlayerToken?: string;
    networkPlayerSession?: string; networkPlayerRoot?: string;
    calibrateDanmaku: boolean; calibrationStatus?: DependencyStatus;
    biliOfficialFirst: boolean; biliRegional: boolean; biliCutAlignment: boolean;
    biliFilterRules: FilterRule[]; biliFilterRevision?: number; biliUploaders: string;
    previousQbProxy?: Record<string, string | number | boolean>;
    defaultBackend?: string; aniUrl?: string; aniKey?: string; abUrl?: string; abToken?: string;
    deviceSync?: boolean; demo?: boolean; metadataHours?: number;
  }
  interface DependencyStatus { python: boolean; numpy: boolean; ffmpeg: boolean; pythonCommand?: string }
  interface FilterRule { id?: string; type?: string; filter: string; enabled?: boolean }
  interface ReleaseTags { language: string; quality: string; codec: string; subtitle: string; legacyTitles?: string[] }
  interface Subscription {
    feed: string; keyword: string; group: string; quality: string; language: string; exclude: string;
    start: number; end: number; enabled: boolean; savePath: string; backend?: string;
    numbering?: string; profile?: ReleaseTags; customized?: boolean; revisionPolicy?: string;
    appliedRevisionPolicy?: string; search?: SourceSearch; [key: string]: unknown;
  }
  interface SourceSearch { language?: string | string[]; quality?: string | string[]; codec?: string | string[]; subtitle?: string | string[] }
  interface MediaFile {
    hash: string; index: number; name: string; path: string; progress: number;
    taskTitle?: string; completedAt?: number; episodeId?: number | null; localExists?: boolean;
    remotePath?: string; danmakuPath?: string; [key: string]: unknown;
  }
  interface Episode {
    id: number; sort: number; ep?: number; title: string; type: number; airdate: string;
    watched: boolean; files: MediaFile[]; danmaku?: { cid?: number; offset?: number; path?: string; [key: string]: unknown };
    pendingRevision?: { hash: string; title: string }; [key: string]: unknown;
  }
  interface Show {
    id: number; title: string; name: string; name_cn?: string; cover: string; date: string;
    total: number; status: number; rate: number; comment: string; private: boolean;
    episodes: Episode[]; subscription: Subscription; blockedTitles: string[]; fankuUrl: string;
    unmatched?: MediaFile[]; lastSync: SyncSnapshot | null; progressAt?: number; localChangedAt?: number;
    localRevision?: number; addedAt?: number; [key: string]: unknown;
  }
  interface SyncSnapshot { title?: string; name?: string; status?: number; rate?: number; comment?: string; private?: boolean; watched?: number[]; [key: string]: unknown }
  interface Job {
    key: string; kind: string; showId: number; episodeId?: number;
    payload: Record<string, string | number | boolean>; attempts?: number; error?: string;
    updated?: number; revision?: number; [key: string]: unknown;
  }
  interface State {
    version: number; settings: Settings; shows: Show[]; queue: Job[];
    events: { at: number; message: string }[]; hiddenShows?: number[];
    syncError?: string; [key: string]: unknown;
  }
  interface BangumiSubject { id: number | string; name: string; name_cn?: string; date?: string; eps?: number; total_episodes?: number; images?: { medium?: string; common?: string } }
  interface BangumiEpisode { id: number; sort: number; ep?: number; name?: string; name_cn?: string; type?: number; airdate?: string }
  interface Torrent { hash: string; name: string; save_path: string; completion_on?: number; progress?: number; state?: string }
  interface TorrentFile { index: number; name: string; progress: number }
  interface Article { title: string; [key: string]: unknown }
  interface HttpResponse { status: number; text: string; headers: Record<string, string>; arrayBuffer?: ArrayBuffer }
  type Transport = (request: import('obsidian').RequestUrlParam) => Promise<HttpResponse>;
}
