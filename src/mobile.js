// Mobile shares the dashboard and settings, with platform-safe service adapters.
class MobileAniLink extends AniLink {
  async onload() {
    this.document = await this.loadData();
    if (this.document?.storage === "vault" && !Array.isArray(this.document.state?.shows))
      throw Error("AniLink 库内数据格式无效，已停止加载以免覆盖数据");
    const saved = this.document?.state || this.document || {};
    this.state = { ...C.defaults(), ...saved, settings: { ...C.defaults().settings, ...saved.settings } };
    const localSettings = this.app.loadLocalStorage("anilink-mobile-settings");
    if (localSettings && typeof localSettings === "object") Object.assign(this.state.settings, DeviceModel.localSettings(localSettings));
    this.mobileLocalSettingsJSON = JSON.stringify(localSettings);
    this.mobileBaseline = DeviceModel.project(this.state);
    const deviceKey = "anilink-mobile-device";
    /** @type {unknown} */
    const savedDeviceId = this.app.loadLocalStorage(deviceKey);
    const legacyDeviceId = typeof savedDeviceId === "string" ? savedDeviceId : window.localStorage.getItem(deviceKey);
    this.mobileDeviceId = legacyDeviceId;
    if (!/^[a-f0-9]{32}$/.test(this.mobileDeviceId || "")) {
      this.mobileDeviceId = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
      for (const record of Object.values(this.document?.records || {}))
        if (record.device === legacyDeviceId) record.device = this.mobileDeviceId;
    }
    this.app.saveLocalStorage(deviceKey, this.mobileDeviceId);
    this.http = new C.Http(requestUrl);
    this.health = {};
    this.saveChain = Promise.resolve();
    this.backgroundTasks = new Map();
    this.disposed = false;
    if ((this.state.settings.logRetention || "session") === "session") this.state.events = [];
    this.registerView(VIEW, (leaf) => new MobileDashboard(leaf, this));
    this.addRibbonIcon("tv", "打开 AniLink", () => this.open());
    this.addCommand({ id: "open", name: "打开", callback: () => this.open() });
    this.addCommand({ id: "open-settings", name: "打开插件设置", callback: () => this.settingsModal() });
    this.addSettingTab(new Connections(this.app, this));
    this.notify("startup", "AniLink 已加载");
    const synchronize = () => this.background("Bangumi 自动同步", () => this.syncMobile());
    this.lastMobileSync = Date.now();
    this.registerInterval(window.setInterval(() => {
      const minutes = Number(this.state.settings.bgmSyncMinutes);
      if (minutes > 0 && Date.now() - this.lastMobileSync >= Math.max(1, minutes) * 60000) synchronize();
    }, 30000));
    if (this.state.settings.bgmToken && this.state.settings.bgmSyncStartup !== false) synchronize();
  }
  async persistMobile() {
    const state = JSON.parse(JSON.stringify(this.state));
    const localSettings = DeviceModel.localSettings(state.settings);
    const settingsJSON = JSON.stringify(localSettings);
    if (settingsJSON !== this.mobileLocalSettingsJSON) {
      this.app.saveLocalStorage("anilink-mobile-settings", localSettings);
      this.mobileLocalSettingsJSON = settingsJSON;
    }
    const after = DeviceModel.project(state);
    const records = DeviceModel.capture(this.document?.records || {}, this.mobileBaseline, after, this.mobileDeviceId);
    const document = { version: 3, storage: "vault", records, state };
    await this.saveData(document);
    this.document = document;
    this.mobileBaseline = after;
  }
  persist() {
    this.saveChain = this.saveChain.catch(() => {}).then(() => this.persistMobile());
    return this.saveChain;
  }
  async onExternalSettingsChange() {
    await this.saveChain;
    const incoming = await this.loadData();
    if (incoming?.storage !== "vault" || !incoming.state) return;
    const local = DeviceModel.capture(this.document?.records || {}, this.mobileBaseline, DeviceModel.project(this.state), this.mobileDeviceId);
    const combined = DeviceModel.merge(local, incoming.records);
    if (JSON.stringify(combined) === JSON.stringify(this.document?.records || {})) return;
    DeviceModel.apply(this.state, combined, C.newShow);
    this.document = { ...incoming, records: combined, state: this.state };
    this.mobileBaseline = DeviceModel.project(this.state);
    for (const job of this.state.queue) {
      const show = this.state.shows.find((item) => item.id === job.showId);
      if (!show) continue;
      if (job.kind === "collection") C.queueJob(this.state, { ...job, payload: { type: show.status, rate: show.rate, comment: show.comment, private: show.private } });
      if (job.kind === "episode") {
        const episode = show.episodes.find((item) => item.id === job.episodeId);
        if (episode) C.queueJob(this.state, { ...job, payload: { type: episode.watched ? 2 : 0 } });
      }
    }
    await this.persist();
    this.redraw();
  }
  async open() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] || this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  settingsModal() {
    this.app.setting.open();
    this.app.setting.openTabById(this.manifest.id);
  }
  async openWebsite(value) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol)) throw Error("链接地址无效");
    if (this.state.settings.bgmMirror && this.state.settings.bgmMirrorWeb !== false && ["bgm.tv", "bangumi.tv", "www.bgm.tv"].includes(url.hostname)) url.hostname = "bgm.lat";
    if (this.state.settings.browserMode === "obsidian" && this.app.viewRegistry?.getViewCreatorByType("webviewer")) {
      const leaf = this.app.workspace.getLeaf("tab");
      try { await leaf.setViewState({ type: "webviewer", state: { url: url.href }, active: true }); }
      catch (error) { leaf.detach(); throw error; }
      await this.app.workspace.revealLeaf(leaf);
    } else window.open(url.href, "_blank");
  }
  async pullAccount() {
    await AniLink.prototype.pullAccount.call(this);
    const shows = this.state.shows.filter((item) => item.status !== 0);
    for (let i = 0; i < shows.length && !this.disposed; i += 4) {
      await Promise.all(shows.slice(i, i + 4).map(async (show) => {
        try { await this.loadMobileEpisodes(show); }
        catch (error) { C.record(this.state, `${show.title} · 分集同步失败：${error.message}`); }
      }));
    }
    await this.persist();
  }
  async loadMobileEpisodes(show) {
    const revision = show.localRevision || 0;
    await this.updateEpisodes(show);
    const progress = await this.bgm().pages(`/v0/users/-/collections/${show.id}/episodes`);
    if ((show.localRevision || 0) !== revision) return;
    const pending = new Set(this.state.queue.filter((job) => job.kind === "episode").map((job) => job.episodeId));
    const episodes = new Map(show.episodes.map((episode) => [episode.id, episode]));
    for (const entry of progress) {
      const episode = episodes.get(entry.episode.id);
      if (episode && !pending.has(episode.id)) episode.watched = entry.type === 2;
    }
    show.progressAt = Date.now();
  }
  async syncMobile() {
    if (this.mobileSyncTask) return this.mobileSyncTask;
    this.mobileSyncTask = (async () => {
      await this.pullAccount();
      await this.sync();
      this.lastMobileSync = Date.now();
      await this.persist();
      this.redraw();
    })().finally(() => { this.mobileSyncTask = null; });
    return this.mobileSyncTask;
  }
  async refresh() {
    if (this.state.settings.bgmToken) await this.syncMobile();
    if (this.state.settings.remoteEnabled) await this.scanRemoteVideos();
    this.redraw();
  }
  async refreshAndReopen() { return this.run(() => this.refresh()); }
  async markWatched(show, episode, watched) {
    episode.watched = watched;
    show.localRevision = (show.localRevision || 0) + 1;
    C.queueJob(this.state, { key: `episode:${episode.id}`, kind: "episode", showId: show.id, episodeId: episode.id, payload: { type: watched ? 2 : 0 } });
    await this.persist();
    this.background("Bangumi 推送", () => this.sync());
  }
  async markThrough(show, target) {
    const episodes = target.type === 0 ? show.episodes.filter((episode) => episode.type === 0 && episode.sort <= target.sort) : [target];
    for (const episode of episodes) {
      if (episode.watched) continue;
      episode.watched = true;
      C.queueJob(this.state, { key: `episode:${episode.id}`, kind: "episode", showId: show.id, episodeId: episode.id, payload: { type: 2 } });
    }
    if ([0, 1].includes(show.status)) await this.changeStatus(show, 3);
    show.localRevision = (show.localRevision || 0) + 1;
    this.completeWatchedShow(show, target);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      if (leaf.view.selected !== show.id) continue;
      leaf.view.episodeFocus = show.episodes.filter((episode) => episode.type === 0 && episode.sort > target.sort && !episode.watched).sort((a, b) => a.sort - b.sort)[0]?.id || target.id;
      leaf.view.render();
    }
    this.redraw();
    this.notify("progress", `已看到第 ${target.ep || target.sort} 集`);
    await this.persist();
    this.background("Bangumi 推送", () => this.sync());
  }
  async changeStatus(show, status) {
    show.status = status;
    show.localRevision = (show.localRevision || 0) + 1;
    C.queueJob(this.state, { key: `collection:${show.id}`, kind: "collection", showId: show.id, payload: { type: status } });
    await this.persist();
    this.background("Bangumi 推送", () => this.sync());
  }
  removeShow(show) {
    this.confirm("移出书架？", "保留 Bangumi 收藏与媒体文件。", () => this.run(async () => {
      this.state.hiddenShows ||= [];
      this.state.hiddenShows.push(show.id);
      this.state.shows = this.state.shows.filter((item) => item !== show);
      this.state.queue = this.state.queue.filter((job) => job.showId !== show.id);
      await this.persist();
    }));
  }
  logsModal() {
    new Panel(this, "日志", (el) => {
      const logs = [...this.state.queue.filter((job) => job.error).map((job) => ({ at: Date.now(), message: job.error })), ...this.state.events];
      button(el, "导出日志", () => this.run(async () => {
        const file = "AniLink-log-" + Date.now() + ".txt";
        await this.app.vault.create(file, logs.map((log) => time(log.at, this.state.settings.dateFormat) + " " + log.message).join("\n"));
        new Notice("日志已导出到仓库根目录");
      }));
      const list = el.createDiv("al-log-list");
      for (const log of logs) {
        const row = list.createDiv("al-log-row");
        row.createEl("time", { text: time(log.at, this.state.settings.dateFormat) });
        row.createEl("p", { text: log.message });
      }
    }).open();
  }
  async onunload() {
    this.disposed = true;
    this.exitSyncRunning = true;
    for (const panel of this.panels || []) panel.close();
    try {
      await this.saveChain;
      if (this.state.settings.bgmSyncExit !== false && this.state.settings.bgmToken) await this.sync();
    } catch (error) { C.record(this.state, "退出同步失败：" + error.message); }
    if ((this.state.settings.logRetention || "session") === "session") this.state.events = [];
    try { await this.persist(); } finally { this.exitSyncRunning = false; }
  }
  mobileRemoteUrl(settings, relative = "") {
    if ((settings.remoteProtocol || "webdav") !== "webdav") throw Error("手机端支持 WebDAV，请使用 WebDAV 服务地址");
    const base = new URL(settings.remoteAddress);
    if (!["http:", "https:"].includes(base.protocol) || base.username || base.password) throw Error("请使用 HTTP(S) 服务地址，并在账号输入框填写凭据");
    const segments = String(relative).replace(/\\/g, "/").split("/").filter(Boolean);
    if (segments.some((part) => part === ".." || /[\r\n\0]/.test(part))) throw Error("远程目录无效");
    base.pathname = base.pathname.replace(/\/$/, "") + "/" + segments.map(encodeURIComponent).join("/");
    return base;
  }
  async mobileRemoteList(settings, directory) {
    const url = this.mobileRemoteUrl(settings, directory);
    if (!url.pathname.endsWith("/")) url.pathname += "/";
    const headers = { Depth: "1", "Content-Type": "application/xml" };
    if (settings.remoteUser || settings.remotePassword) {
      const bytes = new TextEncoder().encode((settings.remoteUser || "") + ":" + (settings.remotePassword || ""));
      headers.Authorization = "Basic " + btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    }
    const response = await this.http.request(url.href, "PROPFIND", '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>', headers);
    const xml = new DOMParser().parseFromString(response.text, "application/xml");
    if (xml.querySelector("parsererror")) throw Error("WebDAV 返回的目录数据无效");
    const rows = [];
    for (const item of xml.getElementsByTagNameNS("DAV:", "response")) {
      const status = item.getElementsByTagNameNS("DAV:", "status")[0]?.textContent;
      if (status && !/HTTP\/\S+\s+2\d\d/.test(status)) continue;
      const href = item.getElementsByTagNameNS("DAV:", "href")[0]?.textContent;
      if (!href) continue;
      const resolved = new URL(href, url);
      if (resolved.origin !== url.origin) continue;
      let pathname;
      try { pathname = decodeURIComponent(resolved.pathname).replace(/\/$/, ""); }
      catch { continue; }
      if (pathname === decodeURIComponent(url.pathname).replace(/\/$/, "")) continue;
      const root = decodeURIComponent(new URL(settings.remoteAddress).pathname).replace(/\/$/, "") + "/";
      if (!pathname.startsWith(root)) continue;
      const relative = pathname.slice(root.length);
      rows.push({ Name: relative.split("/").pop(), Path: relative, IsDir: !!item.getElementsByTagNameNS("DAV:", "collection").length });
    }
    return rows;
  }
  async remoteDirectories(settings, directory) {
    return (await this.mobileRemoteList(settings, directory)).filter((row) => row.IsDir);
  }
  chooseRemoteDirectory(settings, input) {
    new Panel(this, "选择远程目录", (el, modal) => {
      let current = input.value || "/";
      const location = el.createEl("p");
      const list = el.createDiv("al-results");
      const load = async () => {
        location.setText(current); list.empty();
        for (const row of await this.remoteDirectories(settings, current)) button(list, row.Name, () => this.run(async () => { current = row.Path; await load(); }));
      };
      const actions = el.createDiv("al-actions");
      button(actions, "上一级", () => this.run(async () => { current = current.split("/").filter(Boolean).slice(0, -1).join("/"); await load(); }));
      button(actions, "选择此目录", () => { input.value = current; input.dispatchEvent(new Event("input", { bubbles: true })); modal.close(); });
      this.run(load);
    }).open();
  }
  async scanRemoteVideos() {
    const settings = this.state.settings;
    if (!settings.remoteEnabled) return;
    const found = new Set();
    const normalize = (value) => String(value).normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
    const names = this.state.shows.map((show) => ({ show, names: [show.title, show.name].filter(Boolean).map(normalize) }));
    const walk = async (directory, depth) => {
      for (const row of await this.mobileRemoteList(settings, directory)) {
        if (row.IsDir) { if (depth < 3) await walk(row.Path, depth + 1); continue; }
        if (!C.VIDEO.test(row.Name)) continue;
        found.add("/" + row.Path);
        const filename = normalize(row.Path);
        const shows = names.filter((entry) => entry.names.some((name) => filename.includes(name))).map((entry) => entry.show);
        if (shows.length !== 1) continue;
        const episode = C.resolveEpisode(shows[0], row.Name);
        if (!episode) continue;
        const file = { name: row.Name, remotePath: "/" + row.Path, progress: 1, localExists: true, episodeId: episode.id };
        episode.files ||= [];
        const existing = episode.files.find((item) => item.remotePath === file.remotePath);
        if (existing) Object.assign(existing, file); else episode.files.push(file);
      }
    };
    await walk(settings.remoteDirectory || "/", 0);
    for (const show of this.state.shows) for (const episode of show.episodes)
      for (const file of episode.files || []) if (file.remotePath) file.localExists = found.has(file.remotePath);
    await this.persist();
  }
  pickFile(show, episode, files) {
    const remote = files.filter((file) => file.remotePath);
    if (remote.length === 1) return this.play(show, episode, remote[0]);
    new Panel(this, "选择播放文件", (el) => {
      for (const file of remote) button(el, file.name, () => this.play(show, episode, file));
    }).open();
  }
  async play(show, episode, file) {
    return this.run(async () => {
      const settings = this.state.settings;
      const url = this.mobileRemoteUrl(settings, file.remotePath);
      new Panel(this, `${show.title} · 第${episode.sort}集`, (el) => {
        if (settings.remoteUser || settings.remotePassword)
          el.createEl("p", { text: "此服务需要认证，请打开网页，在浏览器中登录后播放。" });
        else {
          const video = el.createEl("video", { attr: { controls: "", playsinline: "", src: url.href }, cls: "al-mobile-video" });
          video.addEventListener("error", () => new Notice("视频无法播放，请检查网络及视频编码支持，或点击打开网页。", 8000));
        }
        button(el, "打开网页", () => this.openWebsite(url.href));
      }).open();
    });
  }
}
class MobileDashboard extends Dashboard {
  withMobileFiles(shows, render) {
    const saved = [];
    for (const show of shows) for (const episode of show.episodes || []) {
      saved.push([episode, episode.files]);
      episode.files = (episode.files || []).filter((file) => this.p.state.settings.remoteEnabled && file.remotePath && file.localExists !== false);
    }
    try { return render(); } finally { for (const [episode, files] of saved) episode.files = files; }
  }
  renderCards(cards) {
    this.withMobileFiles(this.p.state.shows, () => super.renderCards(cards));
    for (const caption of cards.querySelectorAll(".al-subscription-caption"))
      if (caption.textContent === "未订阅") caption.remove();
  }
  render() {
    const pane = this.mobilePane || "shelf";
    const previous = this.mobileRenderedPane;
    if (previous === "shelf" && pane === "detail") this.mobileShelfScroll = this.contentEl.scrollTop;
    this.mobileRenderedPane = pane;
    super.render();
    this.contentEl.addClass("al-mobile-dashboard");
    this.contentEl.dataset.columns = "1";
    const back = this.contentEl.querySelector(".al-mobile-back");
    if (back) back.onclick = () => { this.mobilePane = "shelf"; this.render(); };
    const toolbar = this.contentEl.querySelector(".al-top > .al-actions");
    for (const control of toolbar?.querySelectorAll("button") || [])
      if (/RSS|下载器|任务/.test(control.textContent)) control.remove();
      else if (/添加番剧/.test(control.textContent)) control.textContent = "添加番剧";
    if (previous !== pane) this.contentEl.scrollTop = pane === "shelf" ? this.mobileShelfScroll || 0 : 0;
    if (this.selectFirstShow === false && this.selected && this.p.state.settings.openFirstShow && !this.mobilePane) {
      this.mobilePane = "detail";
      this.contentEl.addClass("al-mobile-detail");
      this.render();
    }
  }
  renderDetail(el, show) {
    this.withMobileFiles([show], () => super.renderDetail(el, show));
    if (this.mobilePane === "detail" && !el.querySelector(".al-mobile-back")) {
      const head = el.querySelector(".al-detail-head");
      if (head) button(head, "← 返回番单", () => { this.mobilePane = "shelf"; this.render(); }, "al-mobile-back");
    }
    el.querySelectorAll(".al-section-subscription,.al-inline-subscription,.al-subscription-strip").forEach((node) => node.remove());
    const normal = show.episodes.filter((episode) => episode.type === 0).sort((a, b) => a.sort - b.sort);
    const selected = show.episodes.find((episode) => episode.id === this.episodeFocus)
      || normal.find((episode) => !episode.watched && this.p.state.settings.remoteEnabled && episode.files?.some((file) => file.remotePath && file.localExists !== false))
      || normal.find((episode) => !episode.watched) || normal.at(-1);
    const remoteFiles = (selected?.files || []).filter((file) => file.remotePath && file.localExists !== false);
    if (!this.p.state.settings.remoteEnabled) {
      const summary = el.querySelector(".al-episode-summary");
      if (summary) summary.textContent = summary.textContent.split(" · ")[0];
    }
    for (const control of el.querySelectorAll("button")) {
      if (/下载本集|打开文件位置|删除文件|刷新文件|弹幕|取消想看/.test(control.textContent)) control.remove();
      if (control.textContent === "播放") {
        if (!this.p.state.settings.remoteEnabled || !remoteFiles.length) control.remove();
      }
    }
    for (const label of el.querySelectorAll(".al-episode-tile span"))
      if (["未下载", "文件缺失", "下载中"].includes(label.textContent)) label.textContent = "未看";
    if (!show.progressAt && !show.mobileLoading && this.p.state.settings.bgmToken) {
      show.mobileLoading = true;
      this.p.background("读取分集 " + show.id, async () => {
        try { await this.p.loadMobileEpisodes(show); await this.p.persist(); }
        finally { delete show.mobileLoading; }
        if (this.selected === show.id) this.renderDetail(el, show);
      });
    }
  }
}
