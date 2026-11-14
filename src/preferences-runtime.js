// Settings behaviours are installed after the existing feature adapters.
const settingsRedraw = AniLink.prototype.redraw;
AniLink.prototype.redraw = function () {
  if (this.app.setting?.containerEl?.isShown()) return;
  return settingsRedraw.call(this);
};
AniLink.prototype.syncModal = function () {
  this.app.setting.open();
  this.app.setting.openTabById(this.manifest.id);
};
AniLink.prototype.syncBiliFilters = async function () {
  const response = await this.http.json("https://api.bilibili.com/x/dm/filter/user", "GET", undefined, { Referer: "https://www.bilibili.com/" });
  if (response.code !== 0 || !Array.isArray(response.data?.rule)) throw Error("屏蔽词同步失败，请确认 B站登录有效");
  this.state.settings.biliFilterRules = response.data.rule.filter((rule) => rule.type === 0 || rule.type === 1);
  await this.persist();
  new Notice("已同步 " + this.state.settings.biliFilterRules.length + " 条屏蔽规则");
};
AniLink.prototype.filterDanmaku = function (document) {
  for (const node of document.querySelectorAll("d")) {
    const blocked = (this.state.settings.biliFilterRules || []).some((rule) => {
      if (rule.type === 0) return node.textContent.includes(rule.filter);
      try { return new RegExp(rule.filter, "i").test(node.textContent); } catch { return false; }
    });
    if (blocked) node.remove();
  }
};
const settingsPlay = AniLink.prototype.play;
AniLink.prototype.focusLocalPlayer = async function () {
  if (process.platform !== "win32") return;
  const script = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir, "focus-player.ps1");
  await fs.writeFile(script, this.bundledFocusScript, "utf8");
  await new Promise((resolve, reject) => execFile("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-File", script, "-Executable", this.state.settings.playerExe], { windowsHide: true }, (error) => error ? reject(error) : resolve()));
};
AniLink.prototype.play = async function (show, episode, file) {
  if (this.playPreparing) { new Notice("正在准备播放，请稍候"); return; }
  this.playPreparing = true;
  const buttons = [...document.querySelectorAll(".al-root button")].filter((button) => button.textContent === "播放");
  for (const button of buttons) { button.disabled = true; button.textContent = "准备弹幕…"; }
  const notice = new Notice("正在匹配来源、抓取并校准弹幕…", 0);
  try {
  const settings = this.state.settings;
  if (settings.remoteEnabled && settings.networkPlayer && settings.networkPlayer !== "local") {
    const base = new URL(settings.networkPlayerUrl);
    if (!["http:", "https:"].includes(base.protocol)) throw Error("播放器服务地址须为 HTTP(S)");
    const mediaPath = (settings.networkPlayerRoot || "").replace(/\/$/, "") + "/" + String(file.remotePath || file.name).replace(/^\//, "");
    if (settings.networkPlayer === "kodi") {
      const result = await this.http.json(new URL("jsonrpc", base.href.endsWith("/") ? base : base.href + "/").href, "POST", { jsonrpc: "2.0", id: 1, method: "Player.Open", params: { item: { file: mediaPath } } });
      if (result.error) throw Error("Kodi 播放失败：" + result.error.message);
    } else {
      const headers = { "X-Emby-Token": settings.networkPlayerToken || "" };
      const root = base.href.replace(/\/$/, "");
      const response = await this.http.json(root + "/Items?Recursive=true&Fields=Path&IncludeItemTypes=Episode&SearchTerm=" + encodeURIComponent(show.title), "GET", undefined, headers);
      const matches = (response.Items || []).filter((item) => item.Path === mediaPath || item.Path?.replace(/\\/g, "/").endsWith("/" + file.name));
      if (matches.length !== 1) throw Error("网络媒体库未找到唯一文件，请核对媒体路径");
      if (!settings.networkPlayerSession) throw Error("请填写在线播放器会话 ID");
      await this.http.request(root + "/Sessions/" + encodeURIComponent(settings.networkPlayerSession) + "/Playing?PlayCommand=PlayNow&ItemIds=" + encodeURIComponent(matches[0].Id), "POST", undefined, headers);
    }
    return;
  }
  const result = await settingsPlay.call(this, show, episode, file);
  notice.setMessage("弹幕准备完成，正在打开播放器");
  try { await this.focusLocalPlayer?.(); }
  catch (error) { C.record(this.state, "播放器窗口置前失败：" + error.message); }
  return result;
  } finally {
    this.playPreparing = false;
    notice.hide();
    for (const button of buttons) { button.disabled = false; button.textContent = "播放"; }
  }
};
const settingsUploader = AniLink.prototype.prepareUploaderDanmaku;
AniLink.prototype.prepareUploaderDanmaku = async function (show, episode, file) {
  if (this.state.settings.biliOfficialFirst !== false) {
    try {
      let url = show.biliOfficialUrl;
      if (!url) {
        const names = C.biliNames(show);
        const queries = [...new Set([show.title === "异世界舅舅" ? "奇幻世界舅舅" : show.title, ...names])];
        const normalize = (value) => String(value).replace(/<[^>]*>/g, "").replace(/[（(]?[仅僅]限.*$/, "").normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
        for (const query of queries) {
          try {
            const result = await this.http.json("https://api.bilibili.com/x/web-interface/search/type?search_type=media_bangumi&keyword=" + encodeURIComponent(query), "GET", undefined, { Referer: "https://www.bilibili.com/" });
            const matches = (result.data?.result || []).filter((item) => names.some((name) => [item.title, item.org_title].some((title) => title && normalize(name) === normalize(title))));
            for (const candidate of matches.sort((a, b) => Number(/[仅僅]限|港澳台/.test(a.title)) - Number(/[仅僅]限|港澳台/.test(b.title)))) {
              const candidateUrl = "https://www.bilibili.com/bangumi/play/ss" + candidate.season_id;
              try {
                if ((await this.biliSource(candidateUrl)).length) { url = candidateUrl; break; }
              } catch (error) { C.record(this.state, "官方区域来源不可用：" + error.message); }
            }
          } catch (error) { C.record(this.state, "官方番剧名称检索失败：" + error.message); }
          if (url) break;
        }
      }
      if (url) {
        const rows = await this.biliSource(url);
        const number = show.episodes.filter((item) => item.type === 0).sort((a, b) => a.sort - b.sort).findIndex((item) => item.id === episode.id) + 1;
        const match = rows.find((item) => item.sort === number);
        if (match) {
          const response = await this.http.request("https://comment.bilibili.com/" + match.cid + ".xml");
          const document = new DOMParser().parseFromString(response.text, "text/xml");
          if (document.querySelector("parsererror") || document.documentElement.tagName !== "i") throw Error("官方弹幕响应无效");
          this.filterDanmaku(document);
          const cuts = await this.officialCuts(show, number, match.cid);
          for (const node of document.querySelectorAll("d")) {
            const fields = node.getAttribute("p").split(",");
            const sourceTime = Number(fields[0]);
            fields[0] = String(sourceTime + cuts.filter((cut) => sourceTime >= cut.at).reduce((total, cut) => total + cut.duration, 0));
            node.setAttribute("p", fields.join(","));
          }
          const target = file.path.replace(/\.[^.]+$/, ".xml");
          try {
            const existing = await fs.readFile(target, "utf8");
            if (existing !== new XMLSerializer().serializeToString(document)) await fs.writeFile(target + ".before-alignment-" + Date.now() + ".bak", existing, { flag: "wx" });
          } catch (error) { if (error.code !== "ENOENT") throw error; }
          await fs.writeFile(target, new XMLSerializer().serializeToString(document), "utf8");
          episode.danmaku = { ...episode.danmaku, cid: match.cid, official: true, cuts, xmlPath: target, biliMatchedAt: Date.now() };
          await this.persist();
          return;
        }
      }
    } catch (error) { C.record(this.state, "官方弹幕获取失败：" + error.message); }
  }
  const result = await settingsUploader.call(this, show, episode, file);
  episode.danmaku.officialCheckedAt = Date.now();
  await this.persist();
  return result;
};
AniLink.prototype.applyRssDefaults = async function () {
  const settings = this.state.settings;
  for (const show of this.state.shows) {
    const sub = show.subscription;
    if (!sub?.feed || sub.customized || sub.profile) continue;
    Object.assign(sub, {
      quality: settings.rssDefaultQuality || "",
      language: settings.rssDefaultLanguage || "",
      exclude: settings.rssDefaultExclude || "",
    });
    await this.qb().setRule(show, sub);
  }
  await this.persist();
};

const settingsInstallSubscription = AniLink.prototype.installSubscription;
AniLink.prototype.installSubscription = async function (show, sub) {
  if (["latest", "upgrade"].includes(sub.revisionPolicy)) {
    const rows = await this.readFeed(sub.feed);
    const latest = new Map();
    for (const row of rows.filter((row) => C.previewMatch(row.title, { ...sub, supersededTitles: [] }))) {
      const episode = C.resolveEpisode(show, row.title);
      if (!episode || episode.watched) continue;
      const revision = Number(row.title.match(/\d+v(\d+)/i)?.[1] || 1);
      const previous = latest.get(episode.id);
      if (!previous || revision > previous.revision) latest.set(episode.id, { row, revision });
    }
    sub.supersededTitles = rows.filter((row) => {
      const episode = C.resolveEpisode(show, row.title);
      const best = episode && latest.get(episode.id);
      return best && Number(row.title.match(/\d+v(\d+)/i)?.[1] || 1) < best.revision;
    }).map((row) => row.title);
    if (sub.revisionPolicy === "upgrade") {
      for (const [episodeId, best] of latest) {
        const episode = show.episodes.find((episode) => episode.id === episodeId);
        for (const hash of new Set((episode.files || []).filter((file) => file.hash && Number((file.taskTitle || file.name).match(/\d+v(\d+)/i)?.[1] || 1) < best.revision).map((file) => file.hash))) {
          if (show.episodes.some((other) => other.id !== episodeId && other.files?.some((file) => file.hash === hash))) continue;
          episode.pendingRevision = { hash, title: best.row.title };
        }
      }
    }
  }
  if (!sub.customized && !sub.profile) {
    sub.quality = this.state.settings.rssDefaultQuality || sub.quality;
    sub.language = this.state.settings.rssDefaultLanguage || sub.language;
    sub.exclude = this.state.settings.rssDefaultExclude || sub.exclude;
  }
  return settingsInstallSubscription.call(this, show, sub);
};
const revisionRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const result = await revisionRefresh.call(this, manual);
  for (const show of this.state.shows) {
    for (const episode of show.episodes.filter((episode) => !episode.watched && episode.pendingRevision)) {
      const pending = episode.pendingRevision;
      if (!(episode.files || []).some((file) => file.progress === 1 && file.hash !== pending.hash && file.taskTitle === pending.title)) continue;
      if (show.episodes.some((other) => other.id !== episode.id && other.files?.some((file) => file.hash === pending.hash))) continue;
      await this.qb().delete(pending.hash);
      episode.files = episode.files.filter((file) => file.hash !== pending.hash);
      delete episode.pendingRevision;
      await this.persist();
    }
  }
  if (Date.now() - (this.lastRevisionCheck || 0) < 600000) return result;
  this.lastRevisionCheck = Date.now();
  for (const show of this.state.shows.filter((show) => show.subscription.enabled && ["latest", "upgrade"].includes(show.subscription.revisionPolicy))) {
    try {
      await this.qb().call("app/version");
      await this.installSubscription(show, show.subscription);
      await this.persist();
    }
    catch (error) { C.record(this.state, "订阅更新检查失败：" + error.message); }
  }
  return result;
};

const settingsOpenWebsite = AniLink.prototype.openWebsite;
AniLink.prototype.openWebsite = function (value) {
  const url = new URL(value);
  if (this.state.settings.bgmMirror && ["bgm.tv", "www.bgm.tv"].includes(url.hostname))
    url.hostname = "bangumi.tv";
  return settingsOpenWebsite.call(this, url.href);
};

const settingsDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  settingsDetail.call(this, el, show);
  if (this.p.state.settings.bgmMirror) {
    for (const guest of el.querySelectorAll("webview")) {
      const src = guest.getAttribute("src");
      if (src?.startsWith("https://bgm.tv/")) guest.setAttribute("src", src.replace("https://bgm.tv/", "https://bangumi.tv/"));
    }
  }
};

const settingsOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await settingsOnload.call(this);
  const synchronize = async () => {
    if (this.settingsSyncRunning || !this.state.settings.bgmToken) return;
    this.settingsSyncRunning = true;
    try {
      await this.pullAccount();
      await this.sync();
      this.lastSettingsSync = Date.now();
    } finally {
      this.settingsSyncRunning = false;
    }
  };
  this.lastSettingsSync = Date.now();
  this.registerInterval(window.setInterval(() => {
    const minutes = Number(this.state.settings.bgmSyncMinutes);
    if (minutes > 0 && Date.now() - this.lastSettingsSync >= Math.max(1, minutes) * 60000)
      this.background("Bangumi 自动同步", synchronize);
  }, 30000));
  if (this.state.settings.bgmSyncStartup) this.background("Bangumi 启动同步", synchronize);
};

const settingsUnload = AniLink.prototype.onunload;
AniLink.prototype.onunload = function () {
  const finish = async () => {
    if (this.state.settings.bgmSyncExit && this.state.settings.bgmToken) {
      try { await this.sync(); } catch (error) { C.record(this.state, "退出推送失败：" + error.message); }
    }
    if ((this.state.settings.logRetention || "session") === "session") this.state.events = [];
    await this.saveChain;
    await this.saveData(JSON.parse(JSON.stringify(this.state)));
  };
  this.settingsUnloadTask = finish();
  this.settingsUnloadTask.catch((error) => console.error("AniLink 退出保存失败", error));
  settingsUnload.call(this);
};
