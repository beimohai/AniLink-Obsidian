"use strict";
const path = require("path");
const VIDEO = /\.(mkv|mp4|avi|webm|mov|m4v|ts)$/i;
const STATUS = {
  0: "未收藏（本地）",
  1: "想看",
  2: "看过",
  3: "在看",
  4: "搁置",
  5: "弃番",
};
const defaults = () => ({
  version: 1,
  settings: {
    qbUrl: "http://127.0.0.1:8080",
    qbUser: "",
    qbPassword: "",
    bgmToken: "",
    playerExe: "",
    playerUrl: "http://127.0.0.1:80",
    playerToken: "",
    downloadRoot: "",
    remoteRoot: "",
    localRoot: "",
    pollSeconds: 60,
  },
  shows: [],
  queue: [],
  events: [],
});
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function feedUrl(value) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.hash
  )
    throw Error("RSS 必须为 HTTP(S) 地址");
  return value;
}
function baseUrl(value) {
  const u = new URL(value);
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw Error("服务地址必须为不含凭据和查询参数的 HTTP(S) 地址");
  return value.replace(/\/+$/, "");
}
function parseEpisode(name) {
  const n = path
    .basename(String(name))
    .replace(VIDEO, "")
    .replace(/\b(?:Season|S)\s*\d{1,2}(?=\s+-\s+\d)/gi, "Season");
  if (
    /(?:\bcomplete\b|\bbatch\b|合集|全集|\d{1,3}\s*[-~～]\s*\d{1,3}(?!\d))/i.test(
      n,
    )
  )
    return null;
  const patterns = [
    /S\d{1,2}E(\d{1,3})(?!\d)/i,
    /(?:\bEP?|第)\s*(\d{1,3})(?:[话話集]|\b)/i,
    /\[\s*(\d{1,3})(?:v\d+)?\s*\]/i,
    /\s-\s*(\d{1,3})(?:v\d+)?(?:\b|\s|\[)/i,
  ];
  for (const re of patterns) {
    const m = n.match(re);
    if (m) return Number(m[1]);
  }
  return null;
}
function feedPath(show) {
  return `AniLink-${show.id}`;
}
function ruleName(show) {
  return `AniLink-${show.id}`;
}
function buildRule(show, sub = show.subscription) {
  if (!sub?.feed) throw Error("请先填写 RSS 地址");
  feedUrl(sub.feed);
  const start = Number(sub.start || 1),
    end = Number(sub.end || 999);
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 1 ||
    end < start ||
    end > 999
  )
    throw Error("集数范围应为 1–999 的整数，结束集不能小于起始集");
  const words = [sub.keyword, sub.group, sub.quality, sub.language]
    .filter((x) => x?.trim())
    .map((x) => x.trim());
  if (!words.length)
    throw Error("至少填写一个番剧关键词或字幕组，避免下载整个 RSS");
  const excludes = [
    "合集",
    "全集",
    "\\bbatch\\b",
    "\\bcomplete\\b",
    "(?<![A-Za-z\\d])\\d{1,3}\\s*[-~～]\\s*\\d{1,3}(?!\\d)",
  ];
  const profile = sub.profile;
  const required = [];
  if (profile) {
    const langs = {
      简繁: "[简簡]繁",
      简中: "[简簡]",
      繁中: "繁",
      多语: "多[国國]",
    };
    if (langs[profile.language]) required.push(langs[profile.language]);
    if (["简中", "繁中"].includes(profile.language)) excludes.push("[简簡]繁");
    if (profile.codec) required.push(esc(profile.codec));
    const subtitles = { 内封: "[内內]封", 内嵌: "[内內]嵌", 外挂: "外[挂掛]" };
    if (subtitles[profile.subtitle]) required.push(subtitles[profile.subtitle]);
  }
  if (sub.exclude?.trim())
    excludes.push(
      ...sub.exclude
        .split("|")
        .map((x) => x.trim())
        .filter(Boolean)
        .map(esc),
    );
  for (const t of show.blockedTitles || []) excludes.push(`^${esc(t)}$`);
  // qBittorrent's episodeFilter only supports season notation (e.g. 1x01-12;),
  // so enforce anime release numbering in the title regex instead.
  const numbers = Array.from({ length: end - start + 1 }, (_, i) => start + i)
    .filter(
      (n) =>
        !show.episodes?.some(
          (e) =>
            e.type === 0 &&
            e.watched &&
            (sub.numbering === "local" ? e.ep || e.sort : e.sort) === n,
        ),
    )
    .join("|");
  const n = numbers ? `0*(?:${numbers})(?!\\d)` : "(?!)";
  const episode = `(?:\\bS\\d{1,2}E${n}|\\bEP?\\s*${n}(?:v\\d+)?\\b|第\\s*${n}[话話集]|\\[\\s*${n}(?:v\\d+)?\\s*\\]|\\s-\\s*${n}(?:v\\d+)?(?:\\b|\\s|\\[))`;
  return {
    enabled: !!sub.enabled,
    useRegex: true,
    mustContain:
      "^" +
      words.map((w) => `(?=.*${esc(w)})`).join("") +
      required.map((w) => `(?=.*${w})`).join("") +
      `(?=.*${episode}).*`,
    mustNotContain: excludes.join("|"),
    episodeFilter: "",
    smartFilter: false,
    affectedFeeds: [sub.feed],
    assignedCategory: feedPath(show),
    savePath: sub.savePath || "",
    addPaused: false,
  };
}
function previewMatch(title, sub) {
  return (
    new RegExp(
      buildRule({ id: 0, blockedTitles: [] }, sub).mustContain,
      "i",
    ).test(title) &&
    !new RegExp(
      buildRule({ id: 0, blockedTitles: [] }, sub).mustNotContain,
      "i",
    ).test(title) &&
    parseEpisode(title) !== null &&
    parseEpisode(title) >= Number(sub.start || 1) &&
    parseEpisode(title) <= Number(sub.end || 999)
  );
}
function localPath(file, settings) {
  if (!file) return "";
  const remote = settings.remoteRoot?.replace(/[\\/]+$/, ""),
    local = settings.localRoot?.replace(/[\\/]+$/, "");
  if (remote && local) {
    const norm = file.replace(/\\/g, "/"),
      prefix = remote.replace(/\\/g, "/");
    if (norm === prefix || norm.startsWith(prefix + "/"))
      return path.join(
        local,
        ...norm.slice(prefix.length).split("/").filter(Boolean),
      );
  }
  return file;
}
function queueJob(state, job) {
  const found = state.queue.find((x) => x.key === job.key);
  if (found) {
    found.payload = { ...found.payload, ...job.payload };
    found.error = "";
    found.updated = Date.now();
    found.revision = (found.revision || 0) + 1;
    return found;
  }
  const item = {
    ...job,
    attempts: 0,
    error: "",
    updated: Date.now(),
    revision: 1,
  };
  state.queue.push(item);
  return item;
}
function record(state, message) {
  if (/ERR_CONNECTION_REFUSED/i.test(message)) {
    message =
      "服务连接被拒绝：请检查下载器是否运行、Web UI 是否启用及端口是否正确";
    if (
      state.events.some(
        (event) => event.message === message && Date.now() - event.at < 600000,
      )
    )
      return;
  }
  state.events.unshift({ at: Date.now(), message });
  state.events = state.events.slice(0, 100);
}
function newShow(subject, episodes = []) {
  return {
    id: Number(subject.id),
    title: subject.name_cn || subject.name,
    name: subject.name,
    cover: subject.images?.medium || subject.images?.common || "",
    date: subject.date || "",
    total:
      subject.eps ||
      episodes.filter((e) => e.type === 0).length ||
      subject.total_episodes ||
      episodes.length,
    status: 1,
    rate: 0,
    comment: "",
    private: false,
    episodes: episodes.map((e) => ({
      id: e.id,
      sort: e.sort,
      ep: e.ep,
      title: e.name_cn || e.name || "",
      type: e.type || 0,
      airdate: e.airdate || "",
      watched: false,
      files: [],
    })),
    subscription: {
      feed: "",
      keyword: "",
      group: "",
      quality: "1080",
      language: "",
      exclude: "",
      start: 1,
      end: subject.eps || 999,
      enabled: false,
      savePath: "",
    },
    blockedTitles: [],
    fankuUrl: "",
    lastSync: null,
  };
}
class Http {
  constructor(transport) {
    this.transport = transport;
  }
  async request(url, method = "GET", body, headers = {}) {
    const r = await this.transport({
      url,
      method,
      body,
      headers,
      throw: false,
    });
    if (r.status < 200 || r.status >= 300)
      throw Error(`请求失败 HTTP ${r.status}`);
    return r;
  }
  async json(url, method = "GET", body, headers = {}) {
    const r = await this.request(
      url,
      method,
      body === undefined ? undefined : JSON.stringify(body),
      { "Content-Type": "application/json", ...headers },
    );
    return r.text ? JSON.parse(r.text) : null;
  }
}
class Bangumi {
  constructor(http, token) {
    this.http = http;
    this.token = token;
  }
  async call(endpoint, method = "GET", body) {
    return this.http.json("https://api.bgm.tv" + endpoint, method, body, {
      "User-Agent": "AniLink/0.1.0 (Obsidian desktop integration)",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    });
  }
  search(keyword, offset = 0, sort = "match") {
    return this.call(`/v0/search/subjects?limit=20&offset=${offset}`, "POST", {
      keyword,
      sort,
      filter: { type: [2] },
    });
  }
  async pages(endpoint) {
    let out = [];
    for (let offset = 0; offset < 10000; offset += 100) {
      const r = await this.call(
        endpoint +
          (endpoint.includes("?") ? "&" : "?") +
          `limit=100&offset=${offset}`,
      );
      out.push(...r.data);
      if (out.length >= r.total || r.data.length < 100) return out;
    }
    throw Error("分页数量异常，请缩小范围");
  }
  episodes(id) {
    return this.pages(`/v0/episodes?subject_id=${id}`);
  }
  collection(id) {
    return this.call(`/v0/users/-/collections/${id}`, "POST", {});
  }
  async send(job) {
    if (!this.token) throw Error("请在连接设置中填写 Bangumi Access Token");
    if (job.kind === "collection")
      return this.call(
        `/v0/users/-/collections/${job.showId}`,
        "POST",
        job.payload,
      );
    if (job.kind === "episode")
      return this.call(
        `/v0/users/-/collections/-/episodes/${job.episodeId}`,
        "PUT",
        job.payload,
      );
    throw Error("未知同步任务");
  }
}
class QBittorrent {
  constructor(http, settings) {
    this.http = http;
    this.settings = settings;
    this.cookie = "";
  }
  async login() {
    const s = this.settings;
    const r = await this.http.request(
      baseUrl(s.qbUrl) + "/api/v2/auth/login",
      "POST",
      new URLSearchParams({
        username: s.qbUser,
        password: s.qbPassword,
      }).toString(),
      {
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: baseUrl(s.qbUrl),
      },
    );
    if (r.status !== 204 && r.text.trim() !== "Ok.")
      throw Error("qBittorrent 登录失败，请检查 Web UI 用户名和密码");
    const raw = Object.entries(r.headers || {}).find(
      ([k]) => k.toLowerCase() === "set-cookie",
    )?.[1];
    this.cookie = (Array.isArray(raw) ? raw : [raw])
      .filter(Boolean)
      .map((v) => String(v).split(";")[0])
      .join("; ");
  }
  async call(endpoint, params, again = true) {
    if (!this.cookie) await this.login();
    const headers = {
      Referer: baseUrl(this.settings.qbUrl),
      Cookie: this.cookie,
    };
    if (params) headers["Content-Type"] = "application/x-www-form-urlencoded";
    const r = await this.http.transport({
      url: baseUrl(this.settings.qbUrl) + "/api/v2/" + endpoint,
      method: params ? "POST" : "GET",
      body: params ? new URLSearchParams(params).toString() : undefined,
      headers,
      throw: false,
    });
    if (r.status === 403 && again) {
      this.cookie = "";
      return this.call(endpoint, params, false);
    }
    if (r.status < 200 || r.status >= 300)
      throw Error(`qBittorrent HTTP ${r.status}`);
    try {
      return JSON.parse(r.text);
    } catch {
      return r.text;
    }
  }
  async feed(show, sub = show.subscription) {
    feedUrl(sub.feed);
    const items = await this.call("rss/items");
    const key = feedPath(show);
    if (!items[key])
      await this.call("rss/addFeed", { url: sub.feed, path: key });
    else if (
      (typeof items[key] === "string" ? items[key] : items[key].url) !==
      sub.feed
    )
      throw Error("该番剧已绑定另一 RSS，请先停用并移除旧订阅");
    await this.call("rss/refreshItem", { itemPath: key });
    return key;
  }
  async install(show, sub = show.subscription) {
    const rule = buildRule(show, sub);
    await this.feed(show, sub);
    const prefs = await this.call("app/preferences");
    if (!prefs.rss_processing_enabled || !prefs.rss_auto_downloading_enabled)
      throw Error(
        "请先在 qBittorrent 中启用 RSS 获取与 RSS 自动下载，再保存订阅",
      );
    const cats = await this.call("torrents/categories");
    if (!cats[feedPath(show)])
      await this.call("torrents/createCategory", {
        category: feedPath(show),
        savePath: sub.savePath || "",
      });
    await this.call("rss/setRule", {
      ruleName: ruleName(show),
      ruleDef: JSON.stringify(rule),
    });
  }
  async setRule(show, sub = show.subscription) {
    await this.call("rss/setRule", {
      ruleName: ruleName(show),
      ruleDef: JSON.stringify(buildRule(show, sub)),
    });
  }
  async removeSubscription(show) {
    const rules = await this.call("rss/rules");
    if (rules[ruleName(show)])
      await this.call("rss/removeRule", { ruleName: ruleName(show) });
    const items = await this.call("rss/items");
    if (items[feedPath(show)])
      await this.call("rss/removeItem", { path: feedPath(show) });
  }
  async articles(show, sub) {
    await this.feed(show, sub);
    const data = await this.call("rss/items?withData=true");
    return data[feedPath(show)]?.articles || [];
  }
  torrents(show) {
    return this.call(
      "torrents/info?category=" + encodeURIComponent(feedPath(show)),
    );
  }
  files(hash) {
    return this.call("torrents/files?hash=" + encodeURIComponent(hash));
  }
  delete(hash) {
    return this.call("torrents/delete", { hashes: hash, deleteFiles: "true" });
  }
}
function resolveEpisode(show, title) {
  const number = parseEpisode(title);
  if (number === null) return null;
  const eps = show.episodes
    .filter((e) => e.type === 0)
    .sort((a, b) => a.sort - b.sort);
  const typed = String(title).match(/S(\d{1,2})E\d{1,3}/i);
  const season = String(show.title + " " + show.name).match(
    /第\s*([\d一二三四五六七八九十]+)\s*[季期]/,
  );
  if (typed && season) {
    const values = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      七: 7,
      八: 8,
      九: 9,
      十: 10,
    };
    if (Number(typed[1]) !== (Number(season[1]) || values[season[1]]))
      return null;
  }
  const absolute = eps.find((e) => e.sort === number);
  const hasLocal = eps.some((e) => Number(e.ep) > 0);
  const continuous = eps.every(
    (e, i) => i === 0 || e.sort === eps[i - 1].sort + 1,
  );
  const local = hasLocal
    ? eps.find((e) => Number(e.ep) === number)
    : continuous
      ? eps[number - 1]
      : null;
  if (typed) return local || null;
  if (show.subscription?.numbering === "local") return local || null;
  if (show.subscription?.numbering === "absolute") return absolute || null;
  if (absolute && local && absolute.id !== local.id) return null;
  return absolute || local || null;
}
function sourceQueries(show, query) {
  const titles = [query, show.name, show.title, show.name_cn].filter(Boolean);
  const bases = titles.map((title) =>
    title
      .replace(/\s*第[\d一二三四五六七八九十]+(?:クール|部分|季|期).*$/u, "")
      .trim(),
  );
  const short = bases
    .filter((title) => /^[\p{Script=Han}]{7,}$/u.test(title))
    .flatMap((title) =>
      [6, 5].map((length) => Array.from(title).slice(-length).join("")),
    );
  return [
    ...new Set(
      [...titles, ...bases, ...bases.flatMap((title) => title.replace(/\s+\d+$/, "").split(/[：:]/).map((part) => part.trim()).filter((part) => part.length >= 3)), ...short]
        .map((title) => title.trim())
        .filter(Boolean),
    ),
  ];
}
function releaseTags(title) {
  return {
    language: /简繁|簡繁/.test(title)
      ? "简繁"
      : /简|簡/.test(title)
        ? "简中"
        : /繁/.test(title)
          ? "繁中"
          : /多国|多國/.test(title)
            ? "多语"
            : "未标注",
    quality: (
      (title.match(/(?:2160|1080|720|480)[pi]?/i) || [])[0] || "未标注"
    ).toLowerCase(),
    codec: (
      (title.match(/HEVC|AVC|H[. ]?26[45]|AV1/i) || [])[0] || ""
    ).toUpperCase(),
    subtitle: /内封|內封/.test(title)
      ? "内封"
      : /内嵌|內嵌/.test(title)
        ? "内嵌"
        : /外挂|外掛/.test(title)
          ? "外挂"
          : "未标注",
  };
}
function mergeFiles(show, torrents, fileLists, settings) {
  const old = new Map(
    [
      ...show.episodes.flatMap((e) => e.files || []),
      ...(show.unmatched || []),
    ].map((f) => [f.hash + ":" + f.index, f]),
  );
  const result = [];
  for (let i = 0; i < torrents.length; i++) {
    const task = torrents[i];
    for (const f of fileLists[i]) {
      if (!VIDEO.test(f.name)) continue;
      const title =
        parseEpisode(f.name) !== null
          ? f.name
          : fileLists[i].filter((x) => VIDEO.test(x.name)).length === 1
            ? task.name
            : "";
      const previous = old.get(task.hash + ":" + f.index);
      const ep =
        show.episodes.find((e) => e.id === previous?.episodeId) ||
        resolveEpisode(show, title);
      const relative = f.name.split(/[\\/]/);
      const full = task.save_path?.includes("\\")
        ? path.win32.join(task.save_path, ...relative)
        : path.posix.join(task.save_path || "", ...relative);
      result.push({
        ...previous,
        hash: task.hash,
        index: f.index,
        name: f.name,
        taskTitle: task.name,
        completedAt:
          previous?.completedAt ||
          (f.progress === 1
            ? task.completion_on
              ? task.completion_on * 1000
              : Date.now()
            : 0),
        progress: f.progress,
        path: localPath(full, settings),
        episodeId: ep?.id || null,
      });
    }
  }
  for (const e of show.episodes)
    e.files = result.filter((f) => f.episodeId === e.id);
  show.unmatched = result.filter((f) => !f.episodeId);
  return result;
}
module.exports = {
  STATUS,
  VIDEO,
  defaults,
  esc,
  baseUrl,
  parseEpisode,
  resolveEpisode,
  releaseTags,
  sourceQueries,
  feedPath,
  ruleName,
  buildRule,
  previewMatch,
  localPath,
  queueJob,
  record,
  newShow,
  Http,
  Bangumi,
  QBittorrent,
  mergeFiles,
};
