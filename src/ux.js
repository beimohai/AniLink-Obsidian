AniLink.prototype.run = function (fn, quiet = false) {
  if (quiet) return this.background("下载刷新", fn);
  const execute = async () => {
    if (this.disposed) return;
    this.busy = true;
    try {
      return await fn();
    } catch (e) {
      if (isConnectionFailure(e.message)) return;
      const message = String(e.message || "操作失败");
      C.record(this.state, message);
      await this.persist();
      new Notice(message, 8000);
    } finally {
      this.busy = false;
      this.redraw();
    }
  };
  this.foregroundChain = (this.foregroundChain || Promise.resolve()).then(
    execute,
    execute,
  );
  return this.foregroundChain;
};
AniLink.prototype.openWebsite = async function (value) {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol))
      throw Error("链接地址无效");
    if (this.state.settings.browserMode !== "obsidian")
      return await shell.openExternal(url.href);
    // Web viewer is an optional core plugin. Its view state is capability-checked;
    // this adapter is deliberately isolated because it is not a public API.
    if (!this.app.viewRegistry.getViewCreatorByType("webviewer")) {
      return await shell.openExternal(url.href);
    }
    const leaf = this.app.workspace.getLeaf("tab");
    try {
      let timer;
      try {
        await Promise.race([
          leaf.setViewState({ type: "webviewer", state: { url: url.href }, active: true }),
          new Promise((_, reject) => { timer = window.setTimeout(() => reject(Error("Web viewer 打开超时")), 10000); }),
        ]);
      } finally { window.clearTimeout(timer); }
    } catch (e) {
      leaf.detach();
      C.record(this.state, "Web viewer 打开失败：" + e.message);
      await this.persist();
      new Notice("内置网页打开失败，已转到默认浏览器");
      await shell.openExternal(url.href);
      return;
    }
    await this.app.workspace.revealLeaf(leaf);
  } catch (e) {
    throw Error(`网页未能打开：${String(e.message || "未知错误")}`);
  }
};
AniLink.prototype.openFanku = async function (subject) {
  let url;
  try {
    url = await this.resolveFanku(subject);
  } catch {
    url =
      "https://fankuhub.com/anime?q=" +
      encodeURIComponent(subject.title || subject.name_cn || subject.name);
  }
  await this.openWebsite(url);
};
AniLink.prototype.addSearchStatus = async function (subject, status) {
  let show = this.state.shows.find((s) => s.id === Number(subject.id));
  if (!show) {
    show = C.newShow(subject, []);
    show.metadataAt = 0;
    this.state.shows.push(show);
  }
  await this.changeStatus(show, status);
  this.background(`分集 ${show.id}`, () =>
    this.updateEpisodes(show).then(() => this.persist()),
  );
  return show;
};
AniLink.prototype.settingsModal = function () {
  new Panel(this, "连接设置", (el, modal) => {
    modal.modalEl.addClass("al-settings-modal");
    const tabs = el.createDiv("al-actions al-settings-tabs"),
      body = el.createDiv("al-settings-body"),
      footer = el.createDiv("al-actions al-settings-footer"),
      inputs = {},
      settings = this.state.settings;
    const panes = {};
    const section = (id, name) => {
      const pane = body.createDiv("al-settings-pane");
      panes[id] = pane;
      const tab = button(tabs, name, () => {
        for (const [key, p] of Object.entries(panes)) p.hidden = key !== id;
        for (const b of tabs.querySelectorAll("button"))
          b.classList.toggle("mod-cta", b === tab);
      });
      pane.hidden = Object.keys(panes).length !== 1;
      if (!pane.hidden) tab.addClass("mod-cta");
      return pane;
    };
    const input = (pane, key, label, type) =>
      (inputs[key] = field(pane, label, settings[key], type));
    const bgm = section("bangumi", "Bangumi");
    input(bgm, "bgmToken", "Access Token", "password");
    button(bgm, "获取 Token", () =>
      this.openWebsite("https://next.bgm.tv/demo/access-token"),
    );
    const qb = section("download", "下载器");
    input(qb, "qbUrl", "Web UI 地址");
    input(qb, "qbUser", "用户名");
    input(qb, "qbPassword", "密码", "password");
    input(qb, "downloadRoot", "下载目录");
    button(qb, "打开 Web UI", () => this.openWebsite(inputs.qbUrl.value));
    const proxy = select(qb, "一键配置时的 RSS 网络", "0", {
      0: "保留现有代理",
      1: "沿用 Windows 本机代理",
    });
    const output = qb.createDiv("al-connection-output");
    button(
      qb,
      "一键配置",
      () =>
        this.run(async () => {
          await save();
          const health = await this.autoConfigure(proxy.value === "1");
          output.empty();
          for (const [name, value] of Object.entries(health))
            output.createEl("p", { text: `${name}：${value.text}` });
        }),
      "mod-cta",
    );
    button(qb, "恢复代理", () =>
      this.run(async () => {
        const old = settings.previousQbProxy;
        if (!old) throw Error("没有需要恢复的代理配置");
        await this.qb().call("app/setPreferences", {
          json: JSON.stringify(old),
        });
        delete settings.previousQbProxy;
        await this.persist();
        new Notice("代理已恢复");
      }),
    );
    qb.createEl("p", {
      text: "首次需在 qBittorrent 设置中开启 Web UI；账号密码由你设置。一键配置负责检测现有安装并开启 RSS。",
      cls: "al-muted",
    });
    const player = section("player", "播放器");
    input(player, "playerExe", "弹弹play路径");
    button(player, "打开弹弹play", () =>
      this.run(async () => {
        await fs.access(this.state.settings.playerExe);
        execFile(
          this.state.settings.playerExe,
          [],
          { windowsHide: true },
          (e) => {
            if (e) new Notice(e.message);
          },
        );
      }),
    );
    input(player, "remoteRoot", "下载器路径前缀（可选）");
    input(player, "localRoot", "本机路径前缀（可选）");
    const display = section("display", "检索与网页");
    inputs.browserMode = select(
      display,
      "网页打开方式",
      settings.browserMode || "external",
      { external: "默认浏览器", obsidian: "Obsidian 标签页（Web viewer）" },
    );
    inputs.informationPage = select(
      display,
      "默认番剧信息",
      settings.informationPage || "fanku",
      { fanku: "番库", bangumi: "Bangumi", trend: "评分趋势" },
    );

    button(display, "Web viewer 设置", () => {
      this.app.setting.open();
      this.app.setting.openTabById("core-plugins");
    });
    const checks = {};
    display.createEl("p", {
      text: "搜索卡片状态按钮",
      cls: "al-setting-label",
    });
    for (const status of [1, 3, 2, 4, 5]) {
      const label = display.createEl("label", { cls: "al-check-option" });
      checks[status] = label.createEl("input", { type: "checkbox" });
      checks[status].checked = (settings.searchStatuses || [1, 3]).includes(
        status,
      );
      label.createSpan({ text: C.STATUS[status] });
    }
    const sync = section("sync", "跨设备");
    button(sync, "打开数据目录", () =>
      shell.openPath(path.dirname(this.deviceFile)),
    );
    inputs.deviceSync = select(
      sync,
      "追番资料同步",
      String(settings.deviceSync === true),
      { false: "关闭", true: "开启（同一 Bangumi 账号）" },
    );
    input(sync, "syncGroup", "同步分组（各设备相同）");
    sync.createEl("p", {
      text: "同步书架、逐集进度、评价和弹幕映射。使用你现有的同步工具同步库内 AniLink-sync 文件夹。此交换文件不含 Token、密码、路径与下载记录；完整配置仍保存在插件目录 data.json。",
      cls: "al-muted",
    });
    button(sync, "立即合并", () =>
      this.run(async () => {
        await save();
        await this.exchangeDevices();
        this.redraw();
        new Notice("跨设备资料已合并");
      }),
    );
    const save = async () => {
      const next = {};
      for (const [key, node] of Object.entries(inputs))
        next[key] = node.value.trim();
      C.baseUrl(next.qbUrl);
      if (
        next.deviceSync === "true" &&
        !/^[a-zA-Z0-9_-]{1,48}$/.test(next.syncGroup)
      )
        throw Error("同步分组请使用 1–48 位字母、数字、下划线或短横线");
      next.deviceSync = next.deviceSync === "true";
      next.searchStatuses = Object.entries(checks)
        .filter(([, n]) => n.checked)
        .map(([id]) => Number(id));
      if (!next.searchStatuses.length)
        throw Error("请至少保留一个搜索状态按钮");
      Object.assign(settings, next);
      await this.persist();
    };
    button(
      footer,
      "保存",
      () =>
        this.run(async () => {
          await save();
          modal.close();
          new Notice("设置已保存");
        }),
      "mod-cta",
    );
    button(footer, "检查连接", () =>
      this.background("连接检查", async () => {
        await save();
        await this.checkConnections();
        new Notice(
          Object.values(this.health)
            .map((v) => v.text)
            .join("\n"),
        );
      }),
    );
    button(footer, "更多偏好", () => {
      modal.close();
      this.preferencesModal();
    });
  }).open();
};
AniLink.prototype.subscriptionsManager = function () {
  new Panel(this, "RSS 订阅", (el, m) => {
    m.modalEl.addClass("al-source-modal");
    const list = el.createDiv("al-results");
    const shows = this.state.shows.filter((s) => s.subscription?.feed);
    if (!shows.length) list.createEl("p", { text: "暂无订阅" });
    for (const s of shows) {
      const row = list.createDiv("al-group-row"),
        info = row.createDiv();
      info.createEl("strong", { text: s.title });
      row.addClass("al-rss-manager-row");
      info.createEl("p", { text: s.subscription.sourceGroup || s.subscription.group || "未指定字幕组" });
      const tags = info.createDiv("al-version-tags");
      for (const tag of [s.subscription.profile?.quality || s.subscription.quality, s.subscription.profile?.language || s.subscription.language, s.subscription.profile?.codec, s.subscription.profile?.subtitle].filter((value) => value && value !== "未标注")) tags.createSpan({ text: tag });
      const status = info.createEl("p", { cls: "al-muted" });
      const showUpdate = () => status.setText((s.subscription.enabled ? "自动下载" : "已暂停") + " · 最近更新 " + (s.subscription.rssUpdatedAt ? new Date(s.subscription.rssUpdatedAt).toLocaleDateString("zh-CN") : "暂无记录"));
      showUpdate();
      this.readFeed(s.subscription.feed).then((rows) => {
        s.subscription.rssUpdatedAt = Math.max(0, ...rows.map((item) => Date.parse(item.date)).filter(Number.isFinite));
        if (status.isConnected) showUpdate();
      }).catch((error) => C.record(this.state, `${s.title} · RSS 更新日期读取失败：${error.message}`));
      const actions = row.createDiv("al-actions");
      button(actions, "更换", () => {
        m.close();
        this.subscriptionModal(s);
      });
      button(actions, s.subscription.enabled ? "暂停" : "恢复", () =>
        this.run(async () => {
          const next = { ...s.subscription, enabled: !s.subscription.enabled };
          await this.installSubscription(s, next);
          s.subscription = next;
          await this.persist();
          m.close();
          this.subscriptionsManager();
        }),
      );
      button(actions, "自定义 RSS", () => { m.close(); this.customRssModal(s); });
      button(actions, "移除", () => this.run(async () => {
        await this.removeManagedSubscription(s);
        s.subscription = { ...s.subscription, feed: "", enabled: false };
        await this.persist();
        m.close();
        this.subscriptionsManager();
      }));
    }
  }).open();
};
const compactDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  compactDetail.call(this, el, s);
  const head = el.querySelector(".al-detail-head");
  if (head) {
    const row = head.createDiv("al-subscription-strip");
    row.createSpan({
      text: s.subscription?.feed
        ? [
            s.subscription.sourceGroup || "已订阅",
            s.subscription.quality,
            s.subscription.enabled ? "自动下载" : "暂停",
          ]
            .filter(Boolean)
            .join(" · ")
        : "未订阅",
    });
    button(row, s.subscription?.feed ? "更换字幕组" : "选择字幕组", () => this.p.subscriptionModal(s));
  }
};
const quarterCards = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (el) {
  const original = this.p.state.shows;
  if (this.seasonFilter)
    this.p.state.shows = original.filter(
      (s) =>
        s.date &&
        `${s.date.slice(0, 4)}-${Math.ceil(Number(s.date.slice(5, 7)) / 3)}` ===
          this.seasonFilter,
    );
  try {
    quarterCards.call(this, el);
  } finally {
    this.p.state.shows = original;
  }
};
const quarterRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  quarterRender.call(this);
  const nav = this.contentEl.querySelector(".al-nav");
  if (!nav) return;
  const selectEl = nav.createEl("select", { attr: { "aria-label": "季度" } });
  const tools = this.contentEl.querySelector(".al-shelf-tools");
  tools?.insertBefore(selectEl, tools.querySelector("select"));
  selectEl.createEl("option", { value: "", text: "全部季度" });
  const quarters = [
    ...new Set(
      this.p.state.shows
        .filter((s) => s.date)
        .map(
          (s) =>
            `${s.date.slice(0, 4)}-${Math.ceil(Number(s.date.slice(5, 7)) / 3)}`,
        ),
    ),
  ]
    .sort()
    .reverse();
  for (const q of quarters)
    selectEl.createEl("option", {
      value: q,
      text:
        q.split("-")[0] +
        "年" +
        String(1 + 3 * (Number(q.split("-")[1]) - 1)).padStart(2, "0") +
        "月",
    });
  selectEl.value = this.seasonFilter || "";
  selectEl.onchange = () => {
    this.seasonFilter = selectEl.value;
    this.render();
  };
};


const flatDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  const previous = this.tab;
  this.tab = "episodes";
  flatDetail.call(this, el, s);
  el.querySelector(".al-tabs")?.remove();
  el.querySelector(".al-subscription-strip")?.remove();
  const body = el.querySelector(".al-tab-body");
  body.addClass("al-flat-workspace");
  const episode = body.createDiv("al-work-section al-watch-section");
  const content = [...body.children].filter((n) => n !== episode);
  episode.createEl("h3", { text: "观看" });
  for (const n of content) episode.appendChild(n);
  for (const [tab, title] of [
    ["subscription", "订阅"],
    ["review", "评价"],
  ]) {
    const temp = el.createDiv();
    this.tab = tab;
    flatDetail.call(this, temp, s);
    const section = body.createDiv("al-work-section al-section-" + tab);
    section.createEl("h3", { text: title });
    const source = temp.querySelector(".al-tab-body");
    if (source)
      while (source.firstChild) section.appendChild(source.firstChild);
    if (tab === "review") {
      const links = el.querySelector(".al-detail-head > .al-actions");
      if (links) section.insertBefore(links, section.children[1] || null);
      if (links) button(links, "弹幕", () => this.p.danmakuModal(s));
      for (const b of section.querySelectorAll("button")) {
        if (b.textContent === "移出书架") {
          const states = el.querySelector(".al-detail-head>.al-status-buttons");
          if (states) {
            const controls = el
              .querySelector(".al-detail-head")
              .createDiv("al-header-status");
            controls.appendChild(b);
            controls.appendChild(states);
          }
        }
        if (b.textContent === "打开番库") b.remove();
        if (b.textContent === "核对此番剧远端进度") b.textContent = "核对进度";
        if (b.textContent === "保存并同步评价") b.textContent = "保存评价";
      }
      const reviewActions = section.createDiv("al-actions al-review-actions");
      for (const b of [...section.querySelectorAll("button")])
        if (["保存评价", "核对进度"].includes(b.textContent))
          reviewActions.appendChild(b);
    }
    for (const p of section.querySelectorAll("p.al-muted"))
      if (p.textContent.length > 60) p.remove();
    if (tab === "subscription")
      for (const heading of [...section.querySelectorAll(":scope > h3")].slice(
        1,
      ))
        heading.remove();
    temp.remove();
  }
  this.tab = previous;
  if (this.renderingSections) return;
  const trend = body.createDiv("al-work-section al-section-trend"),
    bar = trend.createDiv("al-actions");
  bar.createEl("h3", { text: "番剧信息" });
  button(bar, "打开网页", () =>
    this.p.openWebsite(`https://netaba.re/subject/${s.id}`),
  );
  this.trendGuest = null;
};
const removalConfirm = AniLink.prototype.confirm;
AniLink.prototype.confirm = function (title, text, fn) {
  if (title !== "移出书架？") return removalConfirm.call(this, title, text, fn);
  const selected =
    this.state.shows.find((s) => text.includes(s.title)) ||
    this.state.shows.find((s) =>
      this.app.workspace
        .getLeavesOfType(VIEW)
        .some((l) => l.view.selected === s.id),
    );
  new Panel(this, title, (el, m) => {
    m.modalEl.addClass("al-remove-modal");
    if (selected)
      el.createEl("p", { text: selected.title, cls: "al-remove-title" });
    el.createEl("p", {
      text: "保留视频与 Bangumi 收藏，移除订阅及待同步任务。",
      cls: "al-muted",
    });
    const actions = el.createDiv("al-actions");
    const links = actions.createDiv("al-remove-links");
    const decisions = actions.createDiv("al-actions");
    if (selected)
      button(links, "取消 Bangumi 收藏", () =>
        this.openWebsite(`https://bgm.tv/subject/${selected.id}#panelInterest`),
      );
    button(decisions, "取消", () => m.close());
    button(
      decisions,
      "移出书架",
      () => {
        m.close();
        fn();
      },
      "mod-warning",
    );
  }).open();
};
const polishedDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  polishedDetail.call(this, el, s);
  const head = el.querySelector(".al-detail-head .al-actions");
  if (head) button(head, "弹幕", () => this.p.danmakuModal(s));
};
AniLink.prototype.scanLocalVideos = async function () {
  if (this.state.settings.remoteEnabled) {
    await this.scanRemoteVideos();
    return;
  }
  for (const s of this.state.shows) {
    if (s.status === 0) continue;
    for (const e of s.episodes)
      e.files = (e.files || []).filter((f) => f.localExists !== false);
    const directories = await this.libraryDirectories(s);
    const walk = async (dir, depth) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of entries) {
        const full = path.join(dir, item.name);
        if (item.isDirectory() && depth < 2) {
          await walk(full, depth + 1);
          continue;
        }
        if (!item.isFile() || !C.VIDEO.test(item.name)) continue;
        const e = C.resolveEpisode(s, item.name);
        if (
          !e ||
          e.files?.some((f) => f.path && path.normalize(f.path) === path.normalize(full))
        )
          continue;
        const st = await fs.stat(full);
        if (!st.size) continue;
        e.files ||= [];
        e.files.push({
          name: item.name,
          path: full,
          index: 0,
          progress: 1,
          localExists: true,
          episodeId: e.id,
          completedAt: st.mtimeMs,
          localOnly: true,
        });
      }
    };
    for (const directory of directories) await walk(directory, 0);
  }
};
const diskRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  await diskRefresh.call(this, manual);
  await this.scanLocalVideos();
  await this.persist();
  this.redraw();
};
AniLink.prototype.autoMatchBili = async function (s) {
  if (s.episodes.filter((e) => e.type === 0).every((e) => e.danmaku?.cid))
    return;
  if (Date.now() - (s.biliSearchAt || 0) < 3600000) return;
  const response = await this.http.json(
    "https://api.bilibili.com/x/web-interface/search/type?search_type=media_bangumi&keyword=" +
      encodeURIComponent(s.title),
    "GET",
    undefined,
    { Referer: "https://www.bilibili.com/" },
  );
  if (response.code !== 0) throw Error("B站自动匹配暂不可用");
  const norm = (x) =>
    String(x || "")
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]/gu, "")
      .toLowerCase();
  const matches = (response.data?.result || []).filter((x) => {
    const name = new DOMParser().parseFromString(x.title || "", "text/html")
      .body.textContent;
    return [s.title, s.name].some((n) => n && norm(n) === norm(name));
  });
  if (matches.length !== 1) throw Error("未找到唯一同季度弹幕源");
  const url =
      "https://www.bilibili.com/bangumi/play/ss" + Number(matches[0].season_id),
    rows = await this.biliSource(url);
  const seen = new Set();
  for (const r of rows) {
    if (!Number.isInteger(r.sort) || seen.has(r.sort))
      throw Error("弹幕分集不明确");
    seen.add(r.sort);
  }
  for (const e of s.episodes.filter((e) => e.type === 0)) {
    const row = rows.find((r) => r.sort === (e.ep || e.sort));
    if (row) e.danmaku = { cid: row.cid, offset: 0 };
  }
  s.biliSearchAt = Date.now();
  s.biliSource = url;
  await this.persist();
};
const matchedPlay = AniLink.prototype.play;
AniLink.prototype.play = async function (s, e, f) {
  try {
    await this.autoMatchBili(s);
    if (e.danmaku?.cid) await this.downloadMappedDanmaku(s);
  } catch (err) {
    C.record(this.state, "自动弹幕：" + err.message);
  }
  return matchedPlay.call(this, s, e, f);
};
AniLink.prototype.openDownloader = async function ({ refreshSubscriptions = true } = {}) {
  const exe = this.state.settings.qbExe;
  if(!exe) throw Error("请在连接配置中选择qBittorrent程序路径");
  await fs.access(exe);
  const wasRunning = await this.qb().call("app/version").then(() => true, () => false);
  const args = this.state.settings.qbProfile ? ["--profile="+this.state.settings.qbProfile,"--no-splash"] : ["--no-splash"];
  await new Promise((resolve, reject) => {
    const macApplication = process.platform === "darwin" && exe.endsWith(".app");
    const child = execFile(macApplication ? "open" : exe, macApplication ? ["-a", exe, "--args", ...args] : args, { windowsHide: false }, () => {});
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  if (!wasRunning) this.downloaderStartedByAniLink = true;
  if (refreshSubscriptions) {
    await this.waitForDownloader();
    await this.refreshRssSubscriptions();
    await this.armIdleShutdown();
  }
};
AniLink.prototype.waitForDownloader = async function () {
  for (let i = 0; i < 60; i++) {
    try {
      await this.qb().call("app/version");
      return;
    } catch (error) {
      if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(error.message)) throw error;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
  }
  throw Error("下载器启动超时，请检查 Web UI 地址");
};
AniLink.prototype.prepareSchedulerScripts = async function (root) {
  for (const [name, content] of Object.entries(this.bundledSchedulerScripts))
    await fs.writeFile(path.join(root, name), content, "utf8");
};
AniLink.prototype.runScheduler = async function (args = []) {
  const root = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
  const script = path.join(root, "download-scheduler.ps1");
  const config = path.join(root, "scheduler.json");
  const exe = this.state.settings.qbExe;
  if (!exe) throw Error("请先选择 qBittorrent 程序路径");
  await this.prepareSchedulerScripts(root);
  await fs.access(exe);
  await fs.writeFile(config, JSON.stringify({ dataFile: this.deviceFile, deviceSettingsFile: this.deviceIdentityFile, exe, profile: this.state.settings.qbProfile || "" }), "utf8");
  const powerShell = path.join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await new Promise((resolve, reject) => {
    const child = execFile(powerShell, ["-NoProfile", "-WindowStyle", "Hidden", "-File", script, ...args], { windowsHide: true }, () => {});
    child.once("error", reject);
    child.once("spawn", resolve);
  });
};
AniLink.prototype.configureLoginScheduler = async function (enable, automatic = false) {
  const root = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir);
  const script = path.join(root, "install-scheduler.ps1");
  const exe = this.state.settings.qbExe;
  if (enable && !exe) throw Error("请先选择 qBittorrent 程序路径");
  await this.prepareSchedulerScripts(root);
  if (enable) await fs.access(exe);
  if (enable) this.state.settings.downloadMode = "once";
  await this.persist();
  const powerShell = path.join(process.env.SystemRoot || "C:/Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const args = ["-NoProfile", "-WindowStyle", "Hidden", "-File", script];
  if (enable) {
    args.push("-PluginDataPath", this.deviceFile, "-QbExe", exe);
    if (this.deviceIdentityFile) args.push("-DeviceSettingsPath", this.deviceIdentityFile);
    if (this.state.settings.qbProfile) args.push("-QbProfile", this.state.settings.qbProfile);
  } else args.push("-Uninstall");
  await new Promise((resolve, reject) => execFile(powerShell, args, { windowsHide: true }, (error) => error ? reject(error) : resolve()));
  if (!automatic) new Notice(enable ? "已启用 AniLink 登录检查" : "已停用 AniLink 登录检查");
};
AniLink.prototype.armIdleShutdown = async function () {
  if (typeof process !== "undefined" && process.platform !== "win32") return;
  if (!this.downloaderStartedByAniLink || Number(this.state.settings.idleMinutes || 10) <= 0) return;
  await this.runScheduler(["-Once", "-ManageRunning"]);
};
const tidyRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  tidyRender.call(this);
  const root = this.contentEl,
    tools = root.querySelector(".al-top>.al-actions"),
    footer = root.querySelector(".al-footer");
  if (tools) {
    for (const b of [...tools.querySelectorAll("button")]) {
      if (b.textContent.startsWith("任务 ") || b.textContent === "连接设置")
        b.remove();
      if (b.textContent === "同步管理") b.textContent = "同步";
    }
  }
  if (footer) {
    const details = [...footer.querySelectorAll("button")].find(
      (b) => b.textContent === "同步详情",
    );
    if (details) details.remove();
  }
};
AniLink.prototype.matchBiliVideo = async function (s, e) {
  const ep = e.ep || e.sort,
    keyword = `${s.title} 第${ep}集`;
  const r = await this.http.json(
    "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
      encodeURIComponent(keyword),
    "GET",
    undefined,
    { Referer: "https://www.bilibili.com/" },
  );
  if (r.code !== 0) throw Error("B站视频搜索失败：" + (r.message || r.code));
  const plain = (t) =>
    new DOMParser().parseFromString(t || "", "text/html").body.textContent;
  const norm = (t) =>
    String(t || "")
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]/gu, "")
      .toLowerCase();
  const candidates = (r.data?.result || [])
    .map((x) => ({ ...x, clean: plain(x.title) }))
    .filter((x) => {
      if (/解说|reaction|预告|混剪|盘点|吐槽|讲解|速看|AMV|MAD/i.test(x.clean))
        return false;
      if (!norm(x.clean).includes(norm(s.title))) return false;
      const n = C.parseEpisode(x.clean);
      if (n !== ep) return false;
      const duration = String(x.duration || "")
        .split(":")
        .map(Number)
        .reduce((a, n) => a * 60 + n, 0);
      return duration >= 600;
    });
  if (candidates.length !== 1)
    throw Error(
      candidates.length
        ? "存在多个同集视频，未自动绑定"
        : "未找到同季度同集完整视频",
    );
  const c = candidates[0],
    view = await this.http.json(
      "https://api.bilibili.com/x/web-interface/view?bvid=" +
        encodeURIComponent(c.bvid),
      "GET",
      undefined,
      { Referer: "https://www.bilibili.com/" },
    );
  if (view.code !== 0) throw Error("B站视频详情读取失败");
  const pages = view.data?.pages || [];
  const page =
    pages.length === 1
      ? pages[0]
      : pages.find((p) => C.parseEpisode(p.part) === ep);
  if (!page?.cid) throw Error("分P集数无法确定");
  e.danmaku = { cid: page.cid, offset: 0 };
  await this.persist();
};
const searchVideoPlay = AniLink.prototype.play;
AniLink.prototype.play = async function (s, e, f) {
  if (!e.danmaku?.cid) {
    try {
      await this.matchBiliVideo(s, e);
    } catch (err) {
      C.record(this.state, "视频弹幕匹配：" + err.message);
    }
  }
  return searchVideoPlay.call(this, s, e, f);
};
const mergedDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  mergedDetail.call(this, el, s);
  const watch = el.querySelector(".al-watch-section"),
    sub = el.querySelector(".al-section-subscription");
  if (watch && sub) {
    watch.querySelector("h3").textContent = "观看进度";
    sub.classList.remove("al-work-section");
    sub.classList.add("al-inline-subscription");
    watch.appendChild(sub);
    for (const p of sub.querySelectorAll("p"))
      if (!p.textContent.trim()) p.remove();
    const heading = sub.createDiv("al-subscription-heading");
    sub.prepend(heading);
    heading.appendChild(sub.querySelector("h3"));
    heading.createSpan({
      text: s.subscription.feed
        ? s.subscription.enabled
          ? "订阅中"
          : "已暂停"
        : "未订阅",
      cls: "al-subscription-state",
    });
    const actions = sub.createDiv("al-actions al-subscription-actions");
    for (const b of [...sub.querySelectorAll(":scope > button")])
      actions.appendChild(b);
    for (const p of sub.querySelectorAll(":scope > p"))
      if (p.textContent === "尚未选择字幕组") p.remove();
  }
};
const watchOpen = AniLink.prototype.open;
AniLink.prototype.open = async function () {
  await watchOpen.call(this);
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
    leaf.view.filter = "watch";
    leaf.view.render();
  }
};
const stableDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  const trend = el.querySelector(".al-section-trend"),
    body = el.querySelector(".al-flat-workspace");
  if (
    trend &&
    body &&
    this.trendSubject === s.id &&
    this.trendGuest?.isConnected
  ) {
    const temp = el.ownerDocument.createElement("div");
    this.renderingSections = true;
    try {
      stableDetail.call(this, temp, s);
    } finally {
      this.renderingSections = false;
    }
    el.querySelector(".al-detail-head").replaceWith(
      temp.querySelector(".al-detail-head"),
    );
    for (const child of [...body.children]) if (child !== trend) child.remove();
    for (const child of [...temp.querySelector(".al-flat-workspace").children])
      if (!child.classList.contains("al-section-trend"))
        body.insertBefore(child, trend);
  } else {
    el.empty();
    stableDetail.call(this, el, s);
  }
  this.alignWorkspace?.();
  this.fitInformation?.();
};
const alignedRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  const scroll = this.contentEl.querySelector(".al-cards")?.scrollTop || 0;
  alignedRender.call(this);
  const root = this.contentEl;
  root.querySelector(".al-cards").scrollTop = scroll;
  this.alignWorkspace = () => {
    if (Platform.isMobile) return;
    const cards = root.querySelector(".al-cards"),
      head = root.querySelector(".al-detail-head");
    if (!cards || !head) return;
    const extra =
      parseFloat(root.style.getPropertyValue("--al-shelf-extra")) || 0;
    const headTop = head.getBoundingClientRect().top;
    const cardTop =
      cards.getBoundingClientRect().top +
      parseFloat(getComputedStyle(cards).paddingTop) -
      extra;
    const hs = getComputedStyle(head);
    const rowHeights = hs.gridTemplateRows
      .split(" ")
      .map(parseFloat)
      .filter(Number.isFinite);
    const naturalBottom =
      headTop +
      rowHeights.reduce((a, b) => a + b, 0) +
      Math.max(0, rowHeights.length - 1) * (parseFloat(hs.rowGap) || 0) +
      parseFloat(hs.paddingTop) +
      parseFloat(hs.paddingBottom) +
      4;
    const target = Math.max(cardTop, naturalBottom);
    root.style.setProperty(
      "--al-shelf-extra",
      Math.max(0, target - cardTop) + "px",
    );
    root.style.setProperty(
      "--al-detail-head-height",
      Math.max(0, target - headTop - 4) + "px",
    );
  };
  if (!this.alignmentObserver) {
    this.alignmentObserver = true;
    const resize = () => window.requestAnimationFrame(() => this.alignWorkspace());
    window.addEventListener("resize", resize);
    this.register(() => window.removeEventListener("resize", resize));
  }
  this.alignWorkspace();
};
const informationDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  informationDetail.call(this, el, s);
  const panel = el.querySelector(".al-section-trend");
  for (const b of el.querySelectorAll(
    ".al-section-review > .al-actions button",
  ))
    if (["Bangumi", "番库"].includes(b.textContent)) b.remove();
  if (!panel || panel.dataset.information) return;
  if (this.p.state.settings.informationPanel === false) {
    panel.remove();
    return;
  }
  panel.dataset.information = "1";
  const bar = panel.querySelector(".al-actions");
  const opener = bar.querySelector("button");
  const wrap = bar.createDiv("al-header-status");
  const tabs = wrap.createDiv("al-status-buttons");
  bar.insertBefore(wrap, opener);
  const viewport = panel.createDiv("al-preview-viewport");
  const pages = {
    trend: { url: `https://netaba.re/subject/${s.id}` },
    bangumi: { url: `https://${this.p.state.settings.bgmMirror && this.p.state.settings.bgmMirrorWeb !== false ? "bangumi.lat" : "bgm.tv"}/subject/${s.id}` },
    fanku: {
      url: s.fankuUrl || null,
    },
  };
  let active =
    this.informationActive || this.p.state.settings.informationPage || "none";
  let navigation = 0;
  const updateTabs = () => {
    for (const b of tabs.children) {
      b.classList.toggle("al-active", b.dataset.page === active);
      b.setAttribute("aria-pressed", String(b.dataset.page === active));
    }
  };
  for (const guest of panel.querySelectorAll("webview, iframe")) guest.hidden = true;
  let activate = async (key) => {
    const revision = ++navigation;
    active = key;
    this.informationActive = key;
    for (const guest of panel.querySelectorAll("webview, iframe")) guest.hidden = true;
    for (const loading of panel.querySelectorAll(".al-web-loading"))
      loading.hidden = true;
    if (key === "none") {
      updateTabs();
      return;
    }
    const page = pages[key];
    if (Platform.isMobile) {
      panel.addClass("al-mobile-information");
      page.loading ||= viewport.createDiv({ cls: "al-web-loading", text: "点击上方“打开网页”查看番剧信息。" });
      page.loading.hidden = false;
      updateTabs();
      return;
    }
    if (!page.url) {
      try {
        page.url = await this.p.resolveFanku(s);
      } catch {
        page.url =
          "https://fankuhub.com/anime?q=" + encodeURIComponent(s.title);
      }
    }
    if (!panel.isConnected || revision !== navigation) return;
    if (page.failed && page.guest) {
      page.dispose?.();
      page.guest.remove();
      page.loading?.remove();
      page.guest = null;
      page.ready = false;
      page.failed = false;
    }
    if (!page.guest) {
      page.loading = viewport.createDiv({
        cls: "al-web-loading",
        text: "加载中…",
      });
      page.guest = viewport.createEl(Platform.isMobile ? "iframe" : "webview", {
        attr: { partition: "anilink-preview-v2", allowpopups: "true", useragent: navigator.userAgent.replace(/\s(?:obsidian|Electron)\/[^\s]+/gi, "") },
      });
      page.guest.addClass("al-trend-frame");
      this.trendGuest = page.guest;
      this.trendSubject = s.id;
      this.bindInformationPreview(page, () => active === key, () => activate(key));
      page.guest.setAttribute("src", page.url);
    }
    active = key;
    for (const [k, value] of Object.entries(pages)) {
      if (value.guest) value.guest.hidden = k !== key;
      if (value.loading) value.loading.hidden = k !== key || !!value.ready;
    }
    updateTabs();
  };
  for (const [key, label] of [
    ["bangumi", "Bangumi"],
    ["fanku", "番库"],
    ["trend", "评分趋势"],
  ]) {
    const b = button(
      tabs,
      label,
      () => {
        const action = key === active && key !== "none" && !pages[key].failed ? "none" : key;
        activate(action).catch((error) => new Notice(error.message));
      },
      key === active ? "al-active" : "",
    );
    b.dataset.page = key;
  }
  opener.onclick = () => this.p.run(async () => {
    const page = pages[active === "none" ? "bangumi" : active];
    const url = page.url || await this.p.resolveFanku(s);
    await this.p.openWebsite(url);
  });
  bar.insertBefore(opener, wrap);
  opener.addClass("al-link");
  const empty = viewport.createEl("p", {
    text: "未加载预览。",
    cls: "al-muted al-information-empty",
  });
  const activateInformation = activate;
  activate = async (key) => {
    empty.hidden = key !== "none";
    return activateInformation(key);
  };
  activate(active).catch((error) => new Notice(error.message));
  for (const b of el.querySelectorAll(
    ".al-section-review > .al-actions button",
  ))
    if (["Bangumi", "番库"].includes(b.textContent)) b.remove();
};



const refreshWithFeedFallback = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  // RSS is owned by qBittorrent. Refreshing AniLink deliberately only scans
  // known local media and syncs metadata; it must never probe the downloader.
  return refreshWithFeedFallback.call(this, manual);
};
const sourceSearchWithAliases = AniLink.prototype.findSources;
AniLink.prototype.findSources = async function (show, query) {
  const names = C.sourceQueries(show, query);
  let failure;
  for (const name of names) {
    try {
      const sources = await sourceSearchWithAliases.call(this, show, name);
      if (sources.some((source) => source.groups.length)) return sources;
    } catch (err) {
      failure = err;
    }
  }
  if (failure) throw failure;
  return [];
};
const videoMatchWithAliases = AniLink.prototype.matchBiliVideo;
AniLink.prototype.matchBiliVideo = async function (show, episode) {
  let failure;
  for (const title of [...new Set([show.title, show.name].filter(Boolean))]) {
    try {
      return await videoMatchWithAliases.call(
        this,
        { ...show, title },
        episode,
      );
    } catch (err) {
      failure = err;
    }
  }
  throw failure;
};
const relocatedSubscription = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  relocatedSubscription.call(this, el, show);
  const sub = el.querySelector(".al-inline-subscription");
  const state = sub?.querySelector(".al-subscription-state");
  const group = sub?.querySelector(":scope > p");
  if (state && group) {
    const line = sub.createDiv("al-subscription-meta");
    group.before(line);
    line.append(group, state);
  }
};
const relocatedCardStatus = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (cards) {
  relocatedCardStatus.call(this, cards);
  for (const card of cards.querySelectorAll(".al-card")) {
    const status = card.querySelector("div > span.al-muted");
    const summary = card.querySelector("div > p.al-muted");
    if (status && summary) {
      status.textContent = status.textContent.replace("未启用订阅", "未订阅");
      summary.appendChild(status);
      summary.addClass("al-card-summary");
    }
  }
};
AniLink.prototype.deleteEpisodeFiles = function (show, episode) {
  const files = (episode.files || []).filter(
    (f) => f.progress === 1 && f.localExists !== false,
  );
  this.confirm(
    "删除文件？",
    `删除本集 ${files.length} 个视频及其绑定的弹幕 XML，保留观看记录。`,
    () =>
      this.run(async () => {
        const danmakuPaths = new Set(episode.danmaku?.ownedPaths || []);
        for (const file of files) {
          const xml = file.path.replace(/\.[^.]+$/, ".xml");
          if (this.state.settings.deleteTorrentWithFiles !== false && file.hash &&
              !show.episodes.some((other) => other.id !== episode.id && other.files?.some((media) => media.hash === file.hash)))
            await this.qb().call("torrents/delete", { hashes: file.hash, deleteFiles: "false" });
          if (file.remotePath) await this.deleteRemoteMedia(file);
          danmakuPaths.add(xml);
          await fs.unlink(file.path).catch((err) => {
            if (err.code !== "ENOENT") throw err;
          });
          if (file.taskTitle && !show.blockedTitles.includes(file.taskTitle))
            show.blockedTitles.push(file.taskTitle);
        }
        for (const danmakuPath of danmakuPaths)
          await fs.unlink(danmakuPath).catch((err) => {
            if (err.code !== "ENOENT") throw err;
          });
        episode.files = (episode.files || []).filter((f) => !files.includes(f));
        delete episode.danmaku;
        await this.persist();
        if (show.subscription.feed) {
          try { await this.qb().setRule(show); }
          catch { show.ruleError = "删除已完成，订阅规则更新待重试"; await this.persist(); }
        }
        C.record(this.state, show.title + "：已删除本集文件");
      }),
  );
};
AniLink.prototype.logsModal = function () {
  new Panel(this, "日志", (el) => {
    const logs = [
      ...this.state.queue
        .filter((j) => j.error)
        .map((j) => ({ at: Date.now(), message: j.error })),
      ...this.state.events,
    ];
    const bar = el.createDiv("al-actions");
    button(bar, "导出日志", () =>
      this.run(async () => {
        const file = path.join(
          path.dirname(this.deviceFile),
          "AniLink-log-" + Date.now() + ".txt",
        );
        await fs.writeFile(
          file,
          logs
            .map((l) => new Date(l.at).toISOString() + " " + l.message)
            .join("\n"),
          "utf8",
        );
        shell.showItemInFolder(file);
      }),
    );
    const list = el.createDiv("al-log-list");
    for (const log of logs) {
      const row = list.createDiv("al-log-row");
      row.createEl("time", { text: time(log.at) });
      row.createEl("p", { text: log.message });
    }
  }).open();
};
const finalCards = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (cards) {
  finalCards.call(this, cards);
  for (const card of cards.querySelectorAll(".al-card")) {
    const show = this.p.state.shows.find(
      (s) => String(s.id) === card.dataset.showId,
    );
    const meta = card.querySelector(":scope > div");
    if (!show || !meta) continue;
    const episodes = show.episodes.filter((e) => e.type === 0);
    const watched = episodes.filter((e) => e.watched).length;
    const stamp = Math.max(
      show.lastLocalUpdate || 0,
      0,
      ...episodes.flatMap((e) =>
        (e.files || []).map((f) => f.completedAt || 0),
      ),
    );
    show.lastLocalUpdate = stamp;
    meta.empty();
    meta.createEl("strong", { text: show.title });
    if (show.name && show.name !== show.title)
      meta.createEl("p", { text: show.name, cls: "al-original-name" });
    const summary = meta.createEl("p", {
      text: `${C.STATUS[show.status]} · ${watched}/${show.total || episodes.length || "待定"}集`,
      cls: "al-card-summary",
    });
    if (stamp)
      summary.createSpan({
        text: " · " + new Date(stamp).toLocaleDateString("zh-CN"),
        cls: "al-update-date",
      });
    meta.createEl("p", {
      text: show.subscription.feed
        ? show.subscription.enabled
          ? "订阅中"
          : "已暂停"
        : "未订阅",
      cls: "al-subscription-caption",
    });
    meta.createEl("progress", {
      attr: {
        value: String(watched),
        max: String(show.total || episodes.length || 1),
        "aria-label": "观看进度",
      },
    });
  }
};
const finalToolbar = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  finalToolbar.call(this);
  const bar = this.contentEl.querySelector(".al-top>.al-actions");
  const refresh = [...bar.children].find(
    (b) => b.textContent === "刷新整个插件",
  );
  if (refresh) {
    refresh.textContent = "刷新";
    refresh.onclick = () => this.p.refreshAndReopen();
  }
  button(bar, "新番表", () => {
    const now = new Date();
    const month = String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(
      2,
      "0",
    );
    this.p.openWebsite(`https://yuc.wiki/${now.getFullYear()}${month}/`);
  });
};
const compactSyncPanel = AniLink.prototype.syncModal;
AniLink.prototype.syncModal = function () {
  compactSyncPanel.call(this);
  const panel = [...(this.panels || [])].find((p) => p.title === "同步管理");
  if (!panel) return;
  panel.modalEl.addClass("al-sync-modal");
  const toolbar = panel.contentEl.createDiv("al-actions al-sync-toolbar");
  panel.contentEl.insertBefore(toolbar, panel.contentEl.children[2] || null);
  for (const b of [...panel.contentEl.querySelectorAll(":scope > button")])
    toolbar.appendChild(b);
};

const settledDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  settledDetail.call(this, el, show);
  const sub = el.querySelector(".al-inline-subscription");
  const state = sub?.querySelector(".al-subscription-state");
  const toggle = [...(sub?.querySelectorAll("button") || [])].find((b) =>
    /暂停|恢复/.test(b.textContent),
  );
  if (toggle && state) {
    toggle.classList.toggle(
      "al-subscription-enabled",
      !!show.subscription.enabled,
    );
    toggle.setAttribute("aria-pressed", String(!!show.subscription.enabled));
    state.remove();
  }
};
const defaultsRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  const settings = this.p.state.settings;
  if (!this.shelfDefaultsApplied) {
    this.shelfDefaultsApplied = true;
    const now = new Date();
    this.seasonFilter =
      settings.shelfQuarterDefault === "current"
        ? `${now.getFullYear()}-${Math.ceil((now.getMonth() + 1) / 3)}`
        : settings.shelfQuarterDefault === "last"
          ? settings.lastShelfQuarter || ""
          : "";
    this.sortMode = settings.shelfSort || "ready";
  }
  defaultsRender.call(this);
  const root = this.contentEl;
  const season = root.querySelector('select[aria-label="季度"]');
  if (season)
    season.addEventListener("change", () => {
      settings.lastShelfQuarter = season.value;
      this.p.persist();
    });
  const toolbar = root.querySelector(".al-top>.al-actions");
  const rss = [...toolbar.children].find(
    (b) => b.textContent === "RSS订阅" || b.textContent === "RSS 订阅",
  );
  if (rss) toolbar.appendChild(rss);
  const detail = root.querySelector(".al-detail");
  detail?.classList.toggle(
    "al-empty-detail",
    !this.p.state.shows.some((s) => s.id === this.selected),
  );
};


const visibleLoadingDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  visibleLoadingDetail.call(this, el, show);
  const panel = el.querySelector(".al-section-trend");
  if (!panel || panel.dataset.visibleLoading) return;
  panel.dataset.visibleLoading = "1";
  const update = () => {
    if (!panel.isConnected) return;
    const bar = panel.querySelector(":scope > .al-actions");
    if (bar) panel.style.setProperty("--al-preview-toolbar-height", bar.offsetHeight + "px");
  };
  const body = el.querySelector(".al-flat-workspace");
  body.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(body);
  this.register(() => {
    observer.disconnect();
    body.removeEventListener("scroll", update);
  });
  panel.addEventListener("click", () => window.requestAnimationFrame(update));
  window.requestAnimationFrame(update);
};
AniLink.prototype.websiteLogin = function (service) {
  const urls = {
    bili: "https://passport.bilibili.com/login",
    bangumi: "https://bgm.tv/login",
    fanku: "https://fankuhub.com/",
  };
  new Panel(this, "网页登录", (el, m) => {
    m.modalEl.addClass("al-web-modal");
    const guest = el.createEl("webview", { attr: { src: urls[service] } });
    guest.addClass("al-webview");
    button(el, "检查登录", () =>
      this.run(async () => {
        if (service === "bili") {
          const result = await this.http.json(
            "https://api.bilibili.com/x/web-interface/nav",
          );
          new Notice(
            result.code === 0 && result.data?.isLogin
              ? "B站已登录"
              : "B站尚未登录",
          );
        } else new Notice("登录状态由网站保存，可在番剧信息中查看");
      }),
    );
  }).open();
};


const browserSessionOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await browserSessionOnload.call(this);
  const original = this.http.transport;
  const browserFetch = this.http.withTimeout(async (options) => {
    const session = require("electron").remote.session.defaultSession;
    const response = await session.fetch(options.url, {
      method: options.method,
      headers: options.headers,
      body: options.body,
      credentials: "include",
    });
    return {
      status: response.status,
      text: await response.text(),
      headers: {},
    };
  });
  this.http.transport = async (options) => {
    const host = new URL(options.url).hostname;
    return host === "bilibili.com" || host.endsWith(".bilibili.com") ? browserFetch(options) : original(options);
  };
};

const fittedInformationRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  fittedInformationRender.call(this);
  const root = this.contentEl;
  this.fitInformation = () => {
    if (Platform.isMobile) return;
    const detail = root.querySelector(".al-detail");
    const head = root.querySelector(".al-detail-head");
    const top = root.querySelector(".al-top>.al-actions");
    if (detail && top) {
      // Use the same content edge and native scrollbar gutter even when the
      // empty state has no review card or scrolling workspace yet.
      const probe = root.ownerDocument.createElement("div");
      probe.classList.add("al-scrollbar-probe");
      root.appendChild(probe);
      const gutter = probe.offsetWidth - probe.clientWidth;
      probe.remove();
      const style = getComputedStyle(detail);
      const right = detail.getBoundingClientRect().right -
        parseFloat(style.paddingRight || "0") -
        parseFloat(style.borderRightWidth || "0") - gutter;
      for (const element of [head, top].filter(Boolean)) {
        element.style.setProperty("padding-right",
          Math.max(0, element.getBoundingClientRect().right - right) + "px");
      }
    }
    const body = root.querySelector(".al-flat-workspace"),
      panel = root.querySelector(".al-section-trend");
    if (!body || !panel) return;
    const height =
      body.clientHeight -
      parseFloat(getComputedStyle(body).paddingBottom || "0") -
      ((root.querySelector(".al-card") || body).getBoundingClientRect().top -
        body.getBoundingClientRect().top);

    panel.style.maxHeight = height + "px";

    panel.style.setProperty("height", height + "px");
    for (const guest of panel.querySelectorAll("webview, iframe"))
      guest.style.setProperty("height", Math.max(120, height - 70) + "px");
  };
  if (!this.informationSizeObserver) {
    this.informationSizeObserver = true;
    const resize = () => window.requestAnimationFrame(() => this.fitInformation());
    window.addEventListener("resize", resize);
    this.register(() => window.removeEventListener("resize", resize));
  }
  window.requestAnimationFrame(() => this.fitInformation());
};

AniLink.prototype.prepareUploaderDanmaku = async function (
  show,
  episode,
  file,
) {
  const started = Date.now();
  const uploaders = new Set(
    String(
      this.state.settings.biliUploaders ||
        "4262884,5306996,690151424,154244413,442715778,3546957240862932",
    )
      .split(/[\s,，]+/)
      .filter(Boolean)
      .map(Number),
  );
  const normal = show.episodes
    .filter((e) => e.type === 0)
    .sort((a, b) => a.sort - b.sort);
  const number = normal.findIndex((e) => e.id === episode.id) + 1;
  if (number < 1) throw Error("无法确定本季集数");
  const candidates = new Map();
  for (const name of C.biliNames(show)) {
    try {
      for (let page = 1; page <= 2; page++) {
        const response = await this.http.json(
          "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
            encodeURIComponent(name + " 第" + number + "话") +
            "&page=" +
            page,
          "GET",
          undefined,
          { Referer: "https://www.bilibili.com/" },
        );
        if (response.code !== 0) {
          C.record(this.state, `${show.title} 第${number}集 · 搜索词 ${name} · 第${page}页 · UP ${[...uploaders].join(",")}：B站搜索失败 ${response.code} ${response.message || ""}`);
          break;
        }
        for (const candidate of response.data?.result || [])
          if (uploaders.has(Number(candidate.mid)))
            candidates.set(candidate.bvid, candidate);
        if (page >= Number(response.data?.numPages || 1)) break;
      }
    } catch (error) {
      C.record(this.state, `${show.title} 第${number}集 · 搜索词 ${name} · UP ${[...uploaders].join(",")}：B站检索失败 ${error.message}`);
    }
  }
  const hasNamedCandidate = [...candidates.values()].some((candidate) =>
    C.biliTitleMatches(show, new DOMParser().parseFromString(candidate.title, "text/html").body.textContent));
  if (!hasNamedCandidate) {
    for (const name of C.biliNames(show).slice(0, 3)) {
      try {
        const response = await this.http.json(
          "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" + encodeURIComponent(name) + "&page=1",
          "GET", undefined, { Referer: "https://www.bilibili.com/" });
        if (response.code !== 0) throw Error(response.message || String(response.code));
        for (const candidate of response.data?.result || [])
          if (uploaders.has(Number(candidate.mid))) candidates.set(candidate.bvid, candidate);
      } catch (error) {
        C.record(this.state, `${show.title} 第${number}集 · 备用搜索 ${name} 失败：${error.message}`);
      }
    }
  }
  const sources = [],
    comments = new Map();
  for (const candidate of candidates.values()) {
    try {
      if (!uploaders.has(Number(candidate.mid))) continue;
      const title = new DOMParser().parseFromString(
        candidate.title,
        "text/html",
      ).body.textContent;
      if (!C.biliTitleMatches(show, title)) {
        C.record(this.state, `${show.title} 第${number}集 · UP ${candidate.mid} · ${candidate.bvid}：番名或季数核验失败，视频标题 ${title}`);
        continue;
      }
      const detail = await this.http.json(
        "https://api.bilibili.com/x/web-interface/view?bvid=" +
          encodeURIComponent(candidate.bvid),
      );
      if (detail.code !== 0) {
        C.record(this.state, `${show.title} 第${number}集 · UP ${candidate.mid} · ${candidate.bvid}：视频详情读取失败 ${detail.code} ${detail.message || ""}`);
        continue;
      }
      if (!uploaders.has(Number(detail.data?.owner?.mid))) continue;
      if (!C.biliTitleMatches(show, detail.data?.title || "")) continue;
      for (const page of detail.data?.pages || []) {
        try {
          const ep = C.biliPageEpisode(page, title);
          if (ep !== number || page.duration < 600) continue;
          let calibration = { offsetSeconds: 0, disabled: true };
          if (this.state.settings.calibrateDanmaku !== false) {
            const play = await this.http.json(
              "https://api.bilibili.com/x/player/playurl?bvid=" +
                candidate.bvid +
                "&cid=" +
                page.cid +
                "&fnval=16",
            );
            const audioUrl = play.data?.dash?.audio?.at(-1)?.baseUrl;
            if (!audioUrl) throw Error("来源音轨不可用");
            calibration = await this.alignSourceAudio(audioUrl, file.path);
          }
          const result = await this.http.request(
            "https://comment.bilibili.com/" + page.cid + ".xml",
          );
          const doc = new DOMParser().parseFromString(result.text, "text/xml");
          this.filterDanmaku?.(doc);
          if (
            doc.querySelector("parsererror") ||
            doc.documentElement.tagName !== "i"
          )
            throw Error("B站弹幕格式错误");
          for (const node of doc.querySelectorAll("d")) {
          const fields = node.getAttribute("p").split(",");
        const identity = String(page.cid) + ":" + (fields[7] || fields.join(",") + "|" + node.textContent);
        node.setAttribute("anilink-key", identity);
            const stamp = Number(fields[0]) + calibration.offsetSeconds;
            if (stamp < 0) continue;
            fields[0] = String(stamp);
            node.setAttribute("p", fields.join(","));
            comments.set(
          identity,
              new XMLSerializer().serializeToString(node),
            );
          }
          sources.push({
            bvid: candidate.bvid,
            cid: page.cid,
            calibration,
            mid: candidate.mid,
            title,
          });
        } catch (error) {
          C.record(
            this.state,
            `${show.title} 第${number}集 · UP ${candidate.mid} · ${candidate.bvid}：${error.message}`,
          );
        }
      }
    } catch (error) {
      C.record(this.state, `${show.title} 第${number}集 · UP ${candidate.mid} · ${candidate.bvid}：${error.message}`);
    }
  }
  for (const uid of uploaders) if (!sources.some((source) => Number(source.mid) === uid)) C.record(this.state, `${show.title} 第${number}集 · ${this.biliUploaderCache?.get(String(uid))?.name || "UP"}（UID ${uid}）弹幕获取失败：未通过番名、季数、集数及时长核验，候选视频 ${[...candidates.values()].filter((item) => Number(item.mid) === uid).map((item) => item.bvid).join("、") || "无"}`);
  if (!sources.length)
    throw Error(`${show.title} 第${number}集 · UP ${[...uploaders].join(",")}：没有通过校验的弹幕来源`);
  if (!comments.size)
    throw Error(`${show.title} 第${number}集：已匹配 ${sources.length} 个来源，来源弹幕为空或均被屏蔽`);
  const target = file.path.replace(/\.[^.]+$/, ".xml");
  let existing = "";
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing && !this.danmakuResetPaths?.has(target)) {
    const old = new DOMParser().parseFromString(existing, "text/xml");
    if (old.querySelector("parsererror")) throw Error("已有弹幕 XML 无法解析，已保留原文件");
    for (const node of old.querySelectorAll("d")) {
      const identity = node.getAttribute("anilink-key") || node.getAttribute("p") + "|" + node.textContent;
      if (!comments.has(identity)) comments.set(identity, new XMLSerializer().serializeToString(node));
    }
  }
  await fs.writeFile(
    target,
    '<?xml version="1.0" encoding="UTF-8"?><i>' +
      [...comments.values()].join("") +
      "</i>",
    "utf8",
  );
  this.danmakuResetPaths?.delete(target);
  episode.danmaku = {
    ...episode.danmaku,
    sources,
    xmlPath: target,
    count: comments.size,
    saved: true,
    biliMatchedAt: Date.now(),
  };
  await this.persist();
  return { sources, count: comments.size, elapsedMs: Date.now() - started };
};
AniLink.prototype.play = async function (show, episode, file) {
  if (file.remotePath) await this.cacheRemoteVideo(file);
  let cached = !!episode.danmaku?.biliMatchedAt;
  const uploaderIds = String(this.state.settings.biliUploaders || "").split(/[\s,，]+/).filter(Boolean).sort().join(",");
  const sourceOptions = ["opening-consensus-v2", this.state.settings.biliOfficialFirst !== false, !!this.state.settings.biliRegional, this.state.settings.biliCutAlignment !== false, uploaderIds, this.state.settings.biliFilterRevision || 0].join(":");
  if (cached && episode.danmaku.sourceOptions !== sourceOptions) {
    const xml = file.path.replace(/\.[^.]+$/, ".xml");
    this.danmakuResetPaths ||= new Set();
    this.danmakuResetPaths.add(xml);
    cached = false;
  }
  if (this.state.settings.biliOfficialFirst !== false && !episode.danmaku?.official && !episode.danmaku?.officialCheckedAt) cached = false;
  if (cached) {
    try {
      await fs.access(file.path.replace(/\.[^.]+$/, ".xml"));
    } catch {
      cached = false;
    }
  }
  if (
    this.state.settings.calibrateDanmaku !== false &&
    episode.danmaku?.sources?.some((source) => source.calibration?.disabled)
  )
    cached = false;
  if (!cached) {
    try {
      await this.prepareUploaderDanmaku(show, episode, file);
      if (episode.danmaku) episode.danmaku.sourceOptions = sourceOptions;
    } catch (error) {
      C.record(this.state, `${show.title} 第${episode.sort}集 · UP ${this.state.settings.biliUploaders || C.defaults().settings.biliUploaders}：弹幕匹配失败 ${error.message}`);
    } finally {
      this.danmakuResetPaths?.delete(file.path.replace(/\.[^.]+$/, ".xml"));
    }
  }
  const result = await launchLocalMedia.call(this, show, episode, file);
  if (show.episodes && !this.danmakuPrefetchRunning) {
    this.danmakuPrefetchRunning = true;
    this.background("后续剧集弹幕", async () => {
      try {
        for (const next of show.episodes.filter((item) => item.type === 0 && !item.watched && item.sort > episode.sort)) {
          if (this.disposed) break;
          const media = next.files?.find((item) => item.progress === 1 && item.localExists !== false);
          if (!media) continue;
          try { await this.prepareUploaderDanmaku(show, next, media); }
          catch (error) { C.record(this.state, "预抓取弹幕：" + error.message); }
        }
      } finally { this.danmakuPrefetchRunning = false; }
    });
  }
  return result;
};

AniLink.prototype.suspendSearch = function (modal) {
  if (this.state.settings.browserMode !== "obsidian") return;
  modal.containerEl.hidden = true;
  const event = this.app.workspace.on("active-leaf-change", (leaf) => {
    if (leaf?.view?.getViewType() !== VIEW) return;
    modal.containerEl.hidden = false;
    this.app.workspace.offref(event);
  });
  this.register(() => this.app.workspace.offref(event));
};
const cleanDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  cleanDetail.call(this, el, show);
  const sub = el.querySelector(".al-inline-subscription");
  for (const node of sub?.querySelectorAll(
    "p,.al-error,.al-subscription-state",
  ) || []) {
    if (/未订阅|ERR_|err_connection|连接失败|请求失败/i.test(node.textContent))
      node.remove();
  }
  const panel = el.querySelector(".al-section-trend");
  if (!panel) return;
  const bar = panel.querySelector(":scope>.al-actions");
  const height = panel.clientHeight - bar.offsetHeight - 32;
  for (const guest of panel.querySelectorAll("webview, iframe"))
    guest.style.setProperty("height", Math.max(100, height) + "px");
};
AniLink.prototype.cleanupShow = async function (show) {
  show.subscription.enabled = false;
  show.cleanupPending = true;
  await this.persist();
  const qb = this.qb();
  await qb.removeSubscription(show);
  const root = path.resolve(
    this.state.settings.downloadRoot || path.join(os.homedir(), "Videos", "Anime"),
  );
  const configured = show.subscription.savePath;
  const folder = path.resolve(
    configured || await this.showFolder(show, root),
  );
  const relative = path.relative(root, folder);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw Error("清理目录必须是番剧下载目录内的独立文件夹");
  const shared = this.state.shows.some(
    (other) =>
      other.id !== show.id &&
      allFiles(other).some(
        (file) =>
          file.path &&
          (file.path === folder || file.path.startsWith(folder + path.sep)),
      ),
  );
  if (shared) throw Error("其他番剧仍使用该文件夹，清理已保留");
  const hashes = [
    ...new Set(
      allFiles(show)
        .filter((file) => file.hash && !file.localOnly)
        .map((file) => file.hash),
    ),
  ];
  for (const hash of hashes)
    await qb.call("torrents/delete", { hashes: hash, deleteFiles: "false" });
  await fs.rm(folder, { recursive: true, force: true });
  for (const episode of show.episodes) episode.files = [];
  show.unmatched = [];
  show.subscription.feed = "";
  show.cleanupPending = false;
  C.record(this.state, show.title + "：已清理番剧目录与RSS任务");
  await this.persist();
};
const lifecycleStatus = AniLink.prototype.changeStatus;
AniLink.prototype.changeStatus = async function (show, status) {
  await lifecycleStatus.call(this, show, status);
  if (Number(status) === 5) await this.cleanupShow(show);
};
const retryCleanupRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const result = await retryCleanupRefresh.call(this, manual);
  for (const show of this.state.shows.filter((s) => s.cleanupPending)) {
    try {
      await this.cleanupShow(show);
    } catch (error) {
      C.record(this.state, "番剧清理待重试：" + error.message);
    }
  }
  return result;
};
AniLink.prototype.settingsModal = function () {
  new Panel(this, "连接配置", (el, modal) => {
    modal.modalEl.addClass("al-connections-flat");
    const inputs = {},
      settings = this.state.settings;
    const section = (title) => {
      const area = el.createDiv("al-connection-section");
      area.createEl("h3", { text: title });
      return area;
    };
    const add = (area, key, label, type = "text") =>
      (inputs[key] = field(area, label, settings[key] || "", type));
    const bgm = section("Bangumi");
    const tokenRow = bgm.createDiv("al-token-row");
    const token = add(tokenRow, "bgmToken", "Access Token", "password");
    const inputWrap = token.parentElement.createDiv("al-token-input");
    inputWrap.appendChild(token);
    const paste = button(inputWrap, "", () => {
      token.value = require("electron").remote.clipboard.readText().trim();
    });
    paste.setAttribute("aria-label", "粘贴 Token");
    require("obsidian").setIcon(paste, "clipboard-paste");
    button(tokenRow, "获取 Token", () =>
      this.openWebsite("https://next.bgm.tv/demo/access-token"),
    );
    const qb = section("qBittorrent");
    if (!settings.qbUrl) settings.qbUrl = "http://127.0.0.1:8080";
    add(qb, "qbUrl", "Web UI 地址");
    const qbExe = add(qb, "qbExe", "程序路径");
    this.pathPicker(qbExe, false);
    add(qb, "qbUser", "用户名");
    add(qb, "qbPassword", "密码", "password");
    const directory = add(qb, "downloadRoot", "下载目录");
    this.pathPicker(directory, true);
    const storage = section("远程服务");
    inputs.remoteEnabled = select(storage, "启用远程媒体", String(!!settings.remoteEnabled), { false: "关闭", true: "开启" });
    inputs.remoteProtocol = select(storage, "服务类型", settings.remoteProtocol || "webdav", {
      webdav: "WebDAV", sftp: "SFTP", ftp: "FTP", ftps: "FTPS", smb: "SMB",
    });
    add(storage, "remoteAddress", "服务地址");
    add(storage, "remoteUser", "用户名");
    const remotePassword = add(storage, "remotePassword", "密码", "password");
    const passwordRow = remotePassword.parentElement.createDiv("al-token-row");
    const passwordBox = passwordRow.createDiv("al-token-input");
    passwordBox.appendChild(remotePassword);
    const readRemote = () => ({ ...settings, ...Object.fromEntries(Object.entries(inputs).map(([key, node]) => [key, node.value.trim()])) });
    const remoteStatus = storage.createEl("p", { cls: "al-muted" });
    button(passwordRow, "检查连接", () => this.run(async () => {
      await this.remoteDirectories(readRemote(), inputs.remoteDirectory.value || "/");
      remoteStatus.setText("连接成功");
    }));
    const remoteDirectory = add(storage, "remoteDirectory", "远程目录");
    const directoryRow = remoteDirectory.parentElement.createDiv("al-path-picker");
    directoryRow.appendChild(remoteDirectory);
    button(directoryRow, "选择路径", () => this.chooseRemoteDirectory(readRemote(), remoteDirectory));
    qb.createEl("p", {
      text: "在 qBittorrent 工具 → 选项 → Web UI 中启用服务，自行设置用户名和密码，然后填写到这里。",
      cls: "al-muted",
    });
    const player = section("播放器");
    player.createEl("p", {
      text: "推荐使用弹弹play；PotPlayer、mpv、VLC等视频播放器，需要安装对应弹幕扩展。",
      cls: "al-muted",
    });
    const executable = add(player, "playerExe", "程序路径");
    this.pathPicker(executable, false);
    button(player, "自动检测", () =>
      this.run(async () => {
        executable.value = (await this.detectPlayer()) || executable.value;
      }),
    );
    const bili = section("bilibili");
    const uploaders = add(bili, "biliUploaders", "弹幕抓取来源（UP 主 UID）");
    uploaders.placeholder = "多个 UID 用逗号或换行分隔";
    if (!uploaders.value)
      uploaders.value = "4262884,5306996,690151424,154244413,442715778,3546957240862932";
    this.biliAccountPanel(bili);
    const save = async () => {
      const values = Object.fromEntries(
        Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]),
      );
      if (!/^\d+(?:[\s,，]+\d+)*$/.test(values.biliUploaders))
        throw Error("请输入有效的 UP 主 UID");
      Object.assign(settings, values);
      settings.remoteEnabled = values.remoteEnabled === "true";
      await this.persist();
    };
    button(
      el,
      "保存",
      () =>
        this.run(async () => {
          await save();
          modal.close();
        }),
      "mod-cta",
    );
  }).open();
};
const connectionToolbarRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  connectionToolbarRender.call(this);
  const toolbar = this.contentEl.querySelector(".al-top>.al-actions");
  if (!toolbar) return;
  const connection = [...toolbar.children].find(
    (b) => b.textContent === "设置",
  );
  if (connection) {
    connection.textContent = "连接配置";
    connection.onclick = () => this.p.settingsModal();
  }
  button(toolbar, "设置", () => {
    this.app.setting.open();
    this.app.setting.openTabById(this.p.manifest.id);
  });
};
const removeDanmakuButton = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  removeDanmakuButton.call(this, el, show);
  for (const button of el.querySelectorAll("button"))
    if (button.textContent === "弹幕") button.remove();
};



AniLink.prototype.pathPicker = function (input, directory) {
  const row = input.parentElement.createDiv("al-path-picker");
  row.appendChild(input);
  button(row, "选择路径", () =>
    this.run(async () => {
      const result = await require("electron").remote.dialog.showOpenDialog({
        properties: [directory ? "openDirectory" : "openFile"],
        filters: directory
          ? undefined
          : [{ name: "程序", extensions: ["exe"] }],
      });
      if (!result.canceled && result.filePaths[0])
        input.value = result.filePaths[0];
    }),
  );
};
AniLink.prototype.detectPlayer = async function () {
  const candidates = [
    "D:/Application/DanDanPlay/dandanplay.exe",
    path.join(
      process.env.ProgramFiles || "C:/Program Files",
      "DanDanPlay/dandanplay.exe",
    ),
    path.join(process.env.LOCALAPPDATA || "", "DanDanPlay/dandanplay.exe"),
  ];
  for (const file of candidates) {
    try {
      await fs.access(file);
      return file;
    } catch  { /* Best-effort optional operation; retain the existing state on failure. */ }
  }
  new Notice("未检测到播放器，请手动选择程序");
  return null;
};
AniLink.prototype.biliAccountPanel = function (el) {
  const profile = el.createDiv("al-bili-profile"),
    actions = el.createDiv("al-actions");
  const refresh = async () => {
    profile.empty();
    try {
      const result = await this.http.json(
        "https://api.bilibili.com/x/web-interface/nav",
      );
      const loggedIn = result.code === 0 && result.data?.isLogin;
      for (const control of actions.children) {
        if (control.textContent === "登录") control.hidden = !!loggedIn;
        if (control.textContent === "退出登录") control.hidden = !loggedIn;
      }
      if (!loggedIn) {
        profile.setText("未登录");
        return;
      }
      const user = result.data;
      if (user.face)
        profile.createEl("img", {
          attr: { src: user.face, referrerpolicy: "no-referrer" },
        });
      profile.createSpan({ text: user.uname + " · UID " + user.mid });
      button(profile, "打开主页", () => this.openWebsite("https://space.bilibili.com/" + user.mid));
    } catch (error) {
      profile.setText("登录状态检查失败");
      C.record(this.state, error.message);
    }
  };
  button(actions, "登录", () => {
    this.biliProfileRefresh = refresh;
    this.websiteLogin("bili");
  });
  button(actions, "测试登录状态", () => this.run(refresh));
  button(actions, "退出登录", () =>
    this.run(async () => {
      const session = require("electron").remote.session.defaultSession;
      const cookies = await session.cookies.get({ domain: ".bilibili.com" });
      for (const cookie of cookies)
        await session.cookies.remove(
          "https://" + cookie.domain.replace(/^\./, "") + cookie.path,
          cookie.name,
        );
      await session.cookies.flushStore();
      await refresh();
    }),
  );
  refresh().catch((error) => profile.setText("登录状态读取失败：" + error.message));
  [...actions.children].find((control) => control.textContent === "退出登录")?.addClass("mod-warning");
};
const detectPlayerOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await detectPlayerOnload.call(this);
  if (!this.state.settings.playerExe) {
    const found = await this.detectPlayer();
    if (found) {
      this.state.settings.playerExe = found;
      await this.persist();
    }
  }
};
const autoCloseLogin = AniLink.prototype.websiteLogin;
AniLink.prototype.websiteLogin = function (service) {
  autoCloseLogin.call(this, service);
  if (service !== "bili") return;
  const modal = [...(this.panels || [])].at(-1);
  let pending = false;
  const timer = window.setInterval(async () => {
    if (!modal?.containerEl.isConnected) {
      window.clearInterval(timer);
      return;
    }
    if (pending) return;
    pending = true;
    try {
      const result = await this.http.json(
        "https://api.bilibili.com/x/web-interface/nav",
      );
      if (result.code === 0 && result.data?.isLogin) {
        window.clearInterval(timer);
        modal.close();
        new Notice("已登录 " + result.data.uname);
        await this.biliProfileRefresh?.();
        this.biliProfileRefresh = null;
      }
    } catch  { /* Best-effort optional operation; retain the existing state on failure. */ } finally {
      pending = false;
    }
  }, 2500);
  this.register(() => window.clearInterval(timer));
};
const orderedToolbar = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  orderedToolbar.call(this);
  const bar = this.contentEl.querySelector(".al-top>.al-actions");
  if (!bar) return;
  const order = this.p.state.settings.toolbarOrder || [
    "添加番剧",
    "刷新",
    "设置",
    "同步",
    "连接配置",
    "新番表",
    "RSS订阅",
  ];
  for (const name of order) {
    const button = [...bar.children].find(
      (b) => b.textContent.replace(/[+＋\s]/g, "") === name,
    );
    if (button) bar.appendChild(button);
  }
  const rss = [...bar.children].find((control) => /RSS\s*订阅/.test(control.textContent));
  const downloader = [...bar.children].find((control) => control.textContent === "打开下载器");
  if (rss && downloader) rss.after(downloader);
};


const refinedConnections = AniLink.prototype.settingsModal;
AniLink.prototype.settingsModal = function () {
  refinedConnections.call(this);
  const modal = [...(this.panels || [])].at(-1);
  if (!modal) return;
  modal.titleEl.empty();
  modal.modalEl.addClass("al-refined-connections");
  for (const input of modal.contentEl.querySelectorAll(
    "input[type=password]",
  )) {
    const row = input.parentElement;
    const eye = button(row, "", () => {
      input.type = input.type === "password" ? "text" : "password";
      require("obsidian").setIcon(
        eye,
        input.type === "password" ? "eye-off" : "eye",
      );
      eye.setAttribute(
        "aria-label",
        input.type === "password" ? "显示密码" : "隐藏密码",
      );
    });
    eye.addClass("al-password-eye");
    eye.setAttribute("aria-label", "显示密码");
    require("obsidian").setIcon(eye, "eye-off");
  }
  for (const button of [...modal.contentEl.querySelectorAll("button")]) {
    if (button.textContent === "自动检测") button.remove();
    if (button.textContent === "保存") button.addClass("al-save-connections");
    if (button.textContent === "退出登录") button.addClass("mod-warning");
  }
  for (const p of modal.contentEl.querySelectorAll("p"))
    if (p.textContent.includes("弹弹play支持"))
      p.setText(
        "推荐使用弹弹play；PotPlayer、mpv、VLC等视频播放器，需要安装对应弹幕扩展。",
      );
  const player = [...modal.contentEl.querySelectorAll(".al-connection-section")].find(
    (section) => section.querySelector("h3")?.textContent === "播放器",
  );
  if (!player) return;
  const calibration = player.createDiv("al-calibration-settings");
  calibration.createEl("h3", { text: "弹幕偏移纠正" });
  const enabled = calibration.createEl("input", { attr: { type: "checkbox" } });
  enabled.checked = this.state.settings.calibrateDanmaku !== false;
  const label = calibration.createEl("label", { text: "播放前校准弹幕" });
  label.prepend(enabled);
  enabled.onchange = async () => {
    this.state.settings.calibrateDanmaku = enabled.checked;
    await this.persist();
  };
  const status = calibration.createEl("p", { cls: "al-calibration-status" });
  const check = calibration.createDiv("al-actions al-calibration-actions");
  const installers = calibration.createDiv("al-actions al-calibration-installers");
  const installButtons = {};
  const inspect = async () => {
    const result = await this.calibrationDependencies();
    status.setText(`Python：${result.python ? "已就绪" : "未找到"}；NumPy：${result.numpy ? "已就绪" : "未安装"}；FFmpeg：${result.ffmpeg ? "已就绪" : "未找到"}`);
    for (const [key, control] of Object.entries(installButtons)) control.hidden = result[key];
    return result;
  };
  installButtons.python = button(installers, "安装 Python", () => this.openWebsite(process.platform === "win32" ? "https://www.python.org/downloads/windows/" : "https://www.python.org/downloads/"));
  installButtons.numpy = button(installers, "安装 NumPy", () =>
    this.run(async () => {
      if (!(await this.calibrationDependencies()).python)
        throw Error("未找到 Python，请先安装 Python 后重新打开 Obsidian");
      await this.installCalibrationNumpy();
      await inspect();
    }),
  );
  installButtons.ffmpeg = button(installers, "安装 FFmpeg", () => this.openWebsite("https://ffmpeg.org/download.html"));
  for (const control of Object.values(installButtons)) control.hidden = true;
  button(check, "检查依赖", () => this.run(inspect));
  inspect().catch(() => status.setText("无法检查依赖"));
};
AniLink.prototype.calibrationPython = async function () {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const program of candidates) {
    const found = await new Promise((resolve) => execFile(program, ["--version"], { windowsHide: true, timeout: 10000 }, (error) => resolve(!error)));
    if (found) return program;
  }
  throw Error("未找到 Python，请安装后重新检查依赖");
};
AniLink.prototype.calibrationDependencies = async function () {
  const probe = (program, args) =>
    new Promise((resolve) => execFile(program, args, { windowsHide: true, timeout: 10000 }, (error) => resolve(!error)));
  const program = await this.calibrationPython().catch(() => null);
  const [numpy, ffmpeg] = await Promise.all([
    program ? probe(program, ["-c", "import numpy"]) : false,
    probe("ffmpeg", ["-version"]),
  ]);
  return { python: !!program, numpy, ffmpeg };
};
AniLink.prototype.installCalibrationNumpy = async function () {
  const program = await this.calibrationPython();
  return new Promise((resolve, reject) =>
    execFile(
      program,
      ["-m", "pip", "install", "--user", "numpy"],
      { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
      (error, _stdout, stderr) =>
        error ? reject(Error(String(stderr || "NumPy 安装失败"))) : resolve(),
    ),
  );
};

AniLink.prototype.alignSourceAudio = async function (source, target) {
  const program = await this.calibrationPython();
  const script = path.join(
    this.app.vault.adapter.getBasePath(),
    this.manifest.dir,
    "align-audio.py",
  );
  await fs.writeFile(script, this.bundledAudioScript, "utf8");
  return new Promise((resolve, reject) =>
    execFile(
      program,
      [script, source, target],
      { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            Error(
              String(stderr).match(/ValueError:([^\r\n]+)/)?.[1] ||
                "音频校准失败，请检查 Python、NumPy、FFmpeg 与来源音轨",
            ),
          );
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch {
          reject(Error("音频校准结果无效"));
        }
      },
    ),
  );
};
AniLink.prototype.ensureDownloader = async function ({ allowStart = true } = {}) {
  try {
    await this.qb().call("app/version");
    return;
  } catch (error) {
    if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(error.message)) throw error;
    if (!allowStart)
      throw Error("下载器未运行；刷新只会记录状态，不会自动启动它");
  }
  const host = new URL(this.state.settings.qbUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    throw Error("远程下载器不可达，请检查服务");
  if (!this.downloaderStarting)
    this.downloaderStarting = (async () => {
      await this.openDownloader({ refreshSubscriptions: false });
      this.downloaderStartedByAniLink = true;
      await this.waitForDownloader();
    })().finally(() => {
      this.downloaderStarting = null;
    });
  return this.downloaderStarting;
};

// Keep the dashboard's existing desktop layout, but expose a true master/detail
// flow for phones.  The class is intentionally state-driven rather than based
// on window width so rotating a device never loses the current selection.
const responsiveDashboardRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  responsiveDashboardRender.call(this);
  const root = this.contentEl;
  root.querySelectorAll(".al-mobile-back").forEach((back) => back.remove());
  const compact = Platform?.isMobile || root.clientWidth <= 620;
  if (compact && !Platform?.isMobile && !this.mobilePane && this.selected && this.p.state.settings.openFirstShow)
    this.mobilePane = "detail";
  root.classList.toggle("al-mobile-detail", compact && this.mobilePane === "detail");
  if (!Platform?.isMobile && !this.masterDetailObserver) {
    this.masterDetailCompact = compact;
    this.masterDetailObserver = new ResizeObserver(() => {
      const next = root.clientWidth <= 620;
      if (root.isConnected && next !== this.masterDetailCompact) {
        this.masterDetailCompact = next;
        this.render();
      }
    });
    this.masterDetailObserver.observe(root);
    this.register(() => this.masterDetailObserver.disconnect());
  }
  const detail = root.querySelector(".al-detail");
  if (!compact || !detail || this.mobilePane !== "detail") return;

  const head = detail.querySelector(".al-detail-head");
  if (!head) return;
  const back = button(
    head,
    "← 返回番单",
    () => {
      this.mobilePane = "shelf";
      this.render();
    },
    "al-mobile-back",
  );
  back.setAttribute("aria-label", "返回番单");
};
const readyDownload = AniLink.prototype.downloadRelease;
AniLink.prototype.downloadRelease = async function (show, article, allowStart = false) {
  await this.ensureDownloader({ allowStart });
  return readyDownload.call(this, show, article);
};

const completedTasksRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const result = await completedTasksRefresh.call(this, manual);
  if (!this.state.settings.clearCompletedTasks || Platform.isMobile) return result;
  try {
    const qb = this.qb();
    const tasks = await qb.call("torrents/info");
    const completed = tasks.filter((task) =>
      !/checking|moving|allocating/i.test(task.state) &&
      (task.progress >= 1 || (task.state === "missingFiles" && task.completion_on > 0)),
    );
    if (completed.length) {
      await qb.call("torrents/delete", { hashes: completed.map((task) => task.hash).join("|"), deleteFiles: "false" });
      C.record(this.state, `已清除 ${completed.length} 个已完成的下载任务，保留文件`);
      await this.persist();
    }
  } catch (error) {
    C.record(this.state, `自动清除下载任务失败：${error.message}`);
  }
  return result;
};
