AniLink.prototype.run = function (fn, quiet = false) {
  if (quiet) return this.background("下载刷新", fn);
  const execute = async () => {
    if (this.disposed) return;
    this.busy = true;
    try {
      return await fn();
    } catch (e) {
      C.record(this.state, e.message);
      await this.persist();
      new Notice(e.message, 8000);
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
      await leaf.setViewState({
        type: "webviewer",
        state: { url: url.href },
        active: true,
      });
    } catch (e) {
      leaf.detach();
      throw e;
    }
    await this.app.workspace.revealLeaf(leaf);
    for (let attempt = 0; attempt < 100 && !leaf.view.webviewMounted; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    await leaf.view.webview.loadURL(url.href);
    leaf.view.displayWebView();
    await this.app.workspace.revealLeaf(leaf);
  } catch (e) {
    new Notice(`网页打开失败：${e.message}`);
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
    button(sync, "打开本机数据目录", () =>
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
      text: "同步书架、逐集进度、评价和弹幕映射。使用你现有的同步工具同步库内 AniLink-sync 文件夹。Token、密码、下载路径和文件记录只保存在本机；订阅在每台设备单独启用。",
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
      info.createEl("p", {
        text: [
          s.subscription.sourceGroup || s.subscription.group,
          s.subscription.quality,
          s.subscription.enabled ? "自动下载" : "已暂停",
          s.rssError,
        ]
          .filter(Boolean)
          .join(" · "),
        cls: "al-muted",
      });
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
    button(row, "订阅", () => this.p.subscriptionModal(s));
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
const standardSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  standardSettings.call(this);
  new Setting(this.containerEl)
    .setName("显示与下载偏好")
    .addButton((b) =>
      b.setButtonText("配置").onClick(() => this.p.preferencesModal()),
    );
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
  if (this.trendSubject !== s.id) {
    this.trendGuest = trend.createEl("webview", {
      attr: {
        src: `https://netaba.re/subject/${s.id}`,
        title: "netaba 评分趋势",
        partition: "persist:anilink-trends",
      },
    });
    this.trendGuest.addClass("al-trend-frame");
    const guest = this.trendGuest;
    guest.addEventListener("dom-ready", () => {
      guest
        .insertCSS(
          `
        header { display:none !important; }
        h1 { padding-top:0 !important; margin:0 !important; font-size:22px !important; line-height:1.4 !important; }
        h2 { margin:0 !important; font-size:15px !important; line-height:1.4 !important; }
        [class*="text-8xl"], [class*="text-9xl"], [class*="text-6xl"], [class*="text-4xl"] { font-size:22px !important; line-height:1.3 !important; }
        .pt-6, .pt-8 { padding-top:8px !important; }
        section:has(.highcharts-container) > .mt-20 { margin-top:4px !important; }
        section:has(.highcharts-container) ~ section:has(.highcharts-container) { display:none !important; }
      `,
        )
        .catch(() => {});
    });
    this.trendSubject = s.id;
  } else if (!this.trendGuest.isConnected) trend.appendChild(this.trendGuest);
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
  for (const s of this.state.shows) {
    for (const e of s.episodes)
      e.files = (e.files || []).filter((f) => f.localExists !== false);
    const root =
      s.subscription.savePath ||
      path.join(
        this.state.settings.downloadRoot || "",
        s.title.replace(/[<>:"/\\|?*]/g, "_"),
      );
    if (!path.isAbsolute(root)) continue;
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
          e.files?.some((f) => path.normalize(f.path) === path.normalize(full))
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
    await walk(root, 0);
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
AniLink.prototype.openDownloader = async function () {
  const exe = this.state.settings.qbExe;
  if(!exe) throw Error("请在连接配置中选择qBittorrent程序路径");
  await fs.access(exe);
  const args = this.state.settings.qbProfile ? ["--profile="+this.state.settings.qbProfile,"--no-splash"] : ["--no-splash"];
  await new Promise((resolve, reject) => {
    const child = execFile(exe, args, { windowsHide: true }, () => {});
    child.once("error", reject);
    child.once("spawn", resolve);
  });
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
};
const alignedRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  const scroll = this.contentEl.querySelector(".al-cards")?.scrollTop || 0;
  alignedRender.call(this);
  const root = this.contentEl;
  root.querySelector(".al-cards").scrollTop = scroll;
  this.alignWorkspace = () => {
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
    this.alignmentObserver = new ResizeObserver(() => this.alignWorkspace());
    this.alignmentObserver.observe(root);
    this.alignmentObserver.observe(root.querySelector(".al-nav"));
    this.register(() => this.alignmentObserver.disconnect());
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
  panel.dataset.information = "1";
  const bar = panel.querySelector(".al-actions");
  const opener = bar.querySelector("button");
  const wrap = bar.createDiv("al-header-status");
  const tabs = wrap.createDiv("al-status-buttons");
  bar.insertBefore(wrap, opener);
  const pages = {
    trend: { url: `https://netaba.re/subject/${s.id}`, guest: this.trendGuest },
    bangumi: { url: `https://bgm.tv/subject/${s.id}` },
    fanku: {
      url: s.fankuUrl || null,
    },
  };
  let active =
    this.informationActive || this.p.state.settings.informationPage || "fanku";
  let navigation = 0;
  for (const guest of panel.querySelectorAll("webview")) guest.hidden = true;
  const activate = async (key) => {
    const revision = ++navigation;
    active = key;
    this.informationActive = key;
    for (const guest of panel.querySelectorAll("webview")) guest.hidden = true;
    for (const loading of panel.querySelectorAll(".al-web-loading"))
      loading.hidden = true;
    const page = pages[key];
    if (!page.url) {
      try {
        page.url = await this.p.resolveFanku(s);
      } catch {
        page.url =
          "https://fankuhub.com/anime?q=" + encodeURIComponent(s.title);
      }
    }
    if (!panel.isConnected || revision !== navigation) return;
    if (!page.guest) {
      page.loading = panel.createDiv({
        cls: "al-web-loading",
        text: "加载中…",
      });
      page.guest = panel.createEl("webview", {
        attr: { src: page.url },
      });
      page.guest.addClass("al-trend-frame");
      page.guest.addEventListener("did-start-loading", () => {
        page.loading.textContent = "加载中…";
        page.loading.hidden = active !== key || !!page.ready;
      });
      page.guest.addEventListener("did-stop-loading", () => {
        page.ready = true;
        page.loading.hidden = true;
      });
      page.guest.addEventListener("dom-ready", () => {
        page.ready = true;
        page.loading.hidden = true;
      });
      page.guest.addEventListener("did-fail-load", (event) => {
        if (event.errorCode !== -3) {
          page.loading.textContent = "加载失败 · " + event.errorDescription;
          page.loading.hidden = active !== key || !!page.ready;
          C.record(
            this.p.state,
            "网页加载失败 " + page.url + " " + event.errorDescription,
          );
          this.p.persist();
        }
      });
    }
    active = key;
    for (const [k, value] of Object.entries(pages)) {
      if (value.guest) value.guest.hidden = k !== key;
      if (value.loading && k !== key) value.loading.hidden = true;
    }
    for (const b of tabs.children) {
      b.classList.toggle("al-active", b.dataset.page === key);
      b.setAttribute("aria-pressed", String(b.dataset.page === key));
    }
  };
  for (const [key, label] of [
    ["bangumi", "Bangumi"],
    ["fanku", "番库"],
    ["trend", "评分趋势"],
  ]) {
    const b = button(
      tabs,
      label,
      () => activate(key),
      key === active ? "al-active" : "",
    );
    b.dataset.page = key;
  }
  opener.onclick = async () => {
    await activate(active);
    await this.p.openWebsite(
      pages[active].guest?.getURL() || pages[active].url,
    );
  };
  bar.insertBefore(opener, wrap);
  opener.addClass("al-link");
  activate(active);
  for (const b of el.querySelectorAll(
    ".al-section-review > .al-actions button",
  ))
    if (["Bangumi", "番库"].includes(b.textContent)) b.remove();
};

const informationSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  informationSettings.call(this);
  new Setting(this.containerEl).setName("默认番剧信息").addDropdown((d) =>
    d
      .addOptions({ fanku: "番库", bangumi: "Bangumi", trend: "评分趋势" })
      .setValue(this.p.state.settings.informationPage || "fanku")
      .onChange(async (value) => {
        this.p.state.settings.informationPage = value;
        await this.p.persist();
      }),
  );
};
const refreshWithFeedFallback = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const result = await refreshWithFeedFallback.call(this, manual);
  if (
    this.feedFallbackBusy ||
    (!manual && Date.now() - (this.lastFeedFallback || 0) < 60000)
  )
    return result;
  this.feedFallbackBusy = true;
  this.lastFeedFallback = Date.now();
  try {
    for (const show of this.state.shows.filter(
      (s) => s.subscription.enabled && s.subscription.feed,
    )) {
      try {
        const rows = await this.readFeed(show.subscription.feed);
        const tasks = await this.qb().torrents(show);
        const queued = new Set(
          tasks.map((t) => C.resolveEpisode(show, t.name)?.id).filter(Boolean),
        );
        for (const row of rows) {
          const ep = C.resolveEpisode(show, row.title);
          if (
            !ep ||
            ep.watched ||
            queued.has(ep.id) ||
            ep.files?.some((f) => f.localExists !== false) ||
            !C.previewMatch(row.title, show.subscription)
          )
            continue;
          await this.downloadRelease(show, row);
          queued.add(ep.id);
        }
      } catch (err) {
        show.rssError = err.message;
        C.record(this.state, show.title + "：" + err.message);
      }
    }
    await this.persist();
  } finally {
    this.feedFallbackBusy = false;
  }
  return result;
};
const sourceSearchWithAliases = AniLink.prototype.findSources;
AniLink.prototype.findSources = async function (show, query) {
  const names = [
    ...new Set([query, show.title, show.name, show.name_cn].filter(Boolean)),
  ];
  let failure;
  for (const name of names) {
    try {
      const sources = await sourceSearchWithAliases.call(this, show, name);
      if (sources.length) return sources;
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
    `删除本集 ${files.length} 个视频，保留观看记录。`,
    () =>
      this.run(async () => {
        for (const file of files) {
          await fs.unlink(file.path).catch((err) => {
            if (err.code !== "ENOENT") throw err;
          });
          if (file.taskTitle && !show.blockedTitles.includes(file.taskTitle))
            show.blockedTitles.push(file.taskTitle);
        }
        episode.files = (episode.files || []).filter((f) => !files.includes(f));
        if (show.subscription.feed) await this.qb().setRule(show);
        await this.persist();
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
    refresh.onclick = async () => {
      await this.app.plugins.disablePlugin(this.p.manifest.id);
      await this.app.plugins.enablePlugin(this.p.manifest.id);
      await this.app.plugins.plugins[this.p.manifest.id].open();
    };
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
    /暂停订阅|恢复订阅/.test(b.textContent),
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
const defaultsSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  defaultsSettings.call(this);
  new Setting(this.containerEl).setName("默认季度").addDropdown((d) =>
    d
      .addOptions({ all: "全部季度", current: "当前季度", last: "上次设置" })
      .setValue(this.p.state.settings.shelfQuarterDefault || "all")
      .onChange(async (value) => {
        this.p.state.settings.shelfQuarterDefault = value;
        await this.p.persist();
      }),
  );
};
const loadingDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  loadingDetail.call(this, el, show);
  if (this.renderingSections) return;
  const panel = el.querySelector(".al-section-trend");
  for (const guest of panel?.querySelectorAll("webview") || []) {
    if (guest.dataset.loadingBound) continue;
    guest.dataset.loadingBound = "1";
    const update = (loading) => {
      guest.classList.toggle("al-web-pending", loading);
    };
    guest.addEventListener("did-start-loading", () => update(true));
    guest.addEventListener("dom-ready", () => update(false));
    guest.addEventListener("did-stop-loading", () => update(false));
    guest.addEventListener("did-fail-load", () => update(false));
    try {
      update(guest.isLoading());
    } catch {
      update(true);
    }
  }
};
const diagnosedDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  diagnosedDetail.call(this, el, show);
  if (this.renderingSections) return;
  for (const guest of el.querySelectorAll("webview")) {
    if (guest.dataset.diagnosed) continue;
    guest.dataset.diagnosed = "1";
    const report = (message) => {
      C.record(this.p.state, "网页 " + guest.src + " " + message);
      this.p.persist();
    };
    guest.addEventListener("render-process-gone", (e) =>
      report("进程退出 " + e.reason),
    );
    guest.addEventListener("did-fail-load", (e) => {
      if (e.errorCode !== -3)
        report("加载失败 " + e.errorCode + " " + e.errorDescription);
    });
    const timer = setTimeout(() => {
      if (!guest.isConnected) return;
      try {
        if (!guest.getURL() || guest.isLoading()) report("加载超过30秒");
      } catch (e) {
        report(e.message);
      }
    }, 30000);
    this.register(() => clearTimeout(timer));
  }
};

const visibleLoadingDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  visibleLoadingDetail.call(this, el, show);
  const panel = el.querySelector(".al-section-trend");
  if (!panel || panel.dataset.visibleLoading) return;
  panel.dataset.visibleLoading = "1";
  const update = () => {
    if (!panel.isConnected || revision !== navigation) return;
    const guest = [...panel.querySelectorAll("webview")].find((g) => !g.hidden);
    if (!guest) return;
    const bounds = guest.getBoundingClientRect(),
      viewport = el.querySelector(".al-flat-workspace").getBoundingClientRect();
    const origin = panel.getBoundingClientRect();
    const top = Math.max(
        bounds.top,
        viewport.top,
        panel.querySelector(":scope > .al-actions").getBoundingClientRect()
          .bottom,
      ),
      bottom = Math.min(bounds.bottom, viewport.bottom);
    for (const overlay of panel.querySelectorAll(".al-web-loading")) {
      Object.assign(overlay.style, {
        left: bounds.left - origin.left + "px",
        top: top - origin.top + "px",
        width: bounds.width + "px",
        height: Math.max(0, bottom - top) + "px",
      });
    }
  };
  const body = el.querySelector(".al-flat-workspace");
  body.addEventListener("scroll", update, { passive: true });
  const observer = new ResizeObserver(update);
  observer.observe(body);
  this.register(() => {
    observer.disconnect();
    body.removeEventListener("scroll", update);
  });
  panel.addEventListener("click", () => requestAnimationFrame(update));
  requestAnimationFrame(update);
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
const accountSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  accountSettings.call(this);
  for (const [key, label] of [
    ["bili", "B站扫码登录"],
    ["bangumi", "Bangumi网页登录"],
    ["fanku", "番库网页登录"],
  ])
    new Setting(this.containerEl)
      .setName(label)
      .addButton((b) =>
        b.setButtonText("登录").onClick(() => this.p.websiteLogin(key)),
      );
};
const browserSessionOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await browserSessionOnload.call(this);
  const original = this.http.transport;
  this.http.transport = async (options) => {
    const host = new URL(options.url).hostname;
    if (host !== "bilibili.com" && !host.endsWith(".bilibili.com"))
      return original(options);
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
  };
};

const fittedInformationRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  fittedInformationRender.call(this);
  const root = this.contentEl;
  this.fitInformation = () => {
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
    for (const guest of panel.querySelectorAll("webview"))
      guest.style.setProperty("height", Math.max(120, height - 70) + "px");
    const target = root.querySelector(".al-section-trend .al-status-buttons");
    const head = root.querySelector(".al-detail-head");
    const top = root.querySelector(".al-top>.al-actions");
    if (target && head && top) {
      const right = target.getBoundingClientRect().right;
      for (const element of [head, top]) {
        const edge = element.getBoundingClientRect().right;
        element.style.paddingRight =
          Math.max(0, edge - right + (element === top ? 1 : 0)) + "px";
      }
    }
  };
  if (!this.informationSizeObserver) {
    this.informationSizeObserver = new ResizeObserver(() =>
      this.fitInformation(),
    );
    this.informationSizeObserver.observe(root);
    this.register(() => this.informationSizeObserver.disconnect());
  }
  requestAnimationFrame(() => this.fitInformation());
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
        "690151424,4262884,5306996,442715778,3546957240862932",
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
  const response = await this.http.json(
    "https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=" +
      encodeURIComponent(show.title + " " + String(number).padStart(2, "0")),
    "GET",
    undefined,
    { Referer: "https://www.bilibili.com/" },
  );
  if (response.code !== 0) throw Error("B站搜索失败 " + response.code);
  const norm = (text) =>
    String(text)
      .normalize("NFKC")
      .replace(/[\s\p{P}\p{S}]/gu, "")
      .toLowerCase();
  const sources = [],
    comments = new Map();
  for (const candidate of response.data?.result || []) {
    if (!uploaders.has(Number(candidate.mid))) continue;
    const title = new DOMParser().parseFromString(candidate.title, "text/html")
      .body.textContent;
    const season = show.title.match(/第[一二三四五六七八九十0-9]+季/);
    const base = show.title.replace(/第[一二三四五六七八九十0-9]+季/g, "");
    if (
      !norm(title).includes(norm(base)) ||
      (season && !norm(title).includes(norm(season[0])))
    )
      continue;
    if (/解说|预告|混剪|盘点|速看|reaction/i.test(title)) continue;
    const detail = await this.http.json(
      "https://api.bilibili.com/x/web-interface/view?bvid=" +
        encodeURIComponent(candidate.bvid),
    );
    if (detail.code !== 0) continue;
    for (const page of detail.data?.pages || []) {
      const ep = C.parseEpisode(page.part) ?? C.parseEpisode(title);
      if (ep !== number || page.duration < 600) continue;
      const play = await this.http.json(
        "https://api.bilibili.com/x/player/playurl?bvid=" +
          candidate.bvid +
          "&cid=" +
          page.cid +
          "&fnval=16",
      );
      const audioUrl = play.data?.dash?.audio?.at(-1)?.baseUrl;
      if (!audioUrl) throw Error("来源音轨不可用");
      const calibration =
        this.state.settings.calibrateDanmaku === false
          ? { offsetSeconds: 0, disabled: true }
          : await this.alignSourceAudio(audioUrl, file.path);
      const result = await this.http.request(
        "https://comment.bilibili.com/" + page.cid + ".xml",
      );
      const doc = new DOMParser().parseFromString(result.text, "text/xml");
      if (
        doc.querySelector("parsererror") ||
        doc.documentElement.tagName !== "i"
      )
        throw Error("B站弹幕格式错误");
      for (const node of doc.querySelectorAll("d")) {
        const fields = node.getAttribute("p").split(",");
        const stamp = Number(fields[0]) + calibration.offsetSeconds;
        if (stamp < 0) continue;
        fields[0] = String(stamp);
        node.setAttribute("p", fields.join(","));
        comments.set(
          node.getAttribute("p") + "|" + node.textContent,
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
    }
  }
  if (!sources.length || !comments.size)
    throw Error("指定UP主暂无可核对的同集弹幕");
  const target = file.path.replace(/\.[^.]+$/, ".xml");
  let existing = "";
  try {
    existing = await fs.readFile(target, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (existing)
    await fs.writeFile(
      target + ".before-alignment-" + Date.now() + ".bak",
      existing,
      { flag: "wx" },
    );
  await fs.writeFile(
    target,
    '<?xml version="1.0" encoding="UTF-8"?><i>' +
      [...comments.values()].join("") +
      "</i>",
    "utf8",
  );
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
const uploaderPlay = AniLink.prototype.play;
AniLink.prototype.play = async function (show, episode, file) {
  let cached = !!episode.danmaku?.biliMatchedAt;
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
    } catch (error) {
      C.record(this.state, "UP主弹幕匹配：" + error.message);
      if (this.state.settings.calibrateDanmaku !== false) throw error;
    }
  }
  return uploaderPlay.call(this, show, episode, file);
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
  for (const guest of panel.querySelectorAll("webview"))
    guest.style.setProperty("height", Math.max(100, height) + "px");
};
AniLink.prototype.cleanupShow = async function (show) {
  show.subscription.enabled = false;
  show.cleanupPending = true;
  await this.persist();
  const qb = this.qb();
  await qb.removeSubscription(show);
  const root = path.resolve(
    this.state.settings.downloadRoot || path.join(require("os").homedir(), "Videos", "Anime"),
  );
  const configured = show.subscription.savePath;
  const folder = path.resolve(
    configured || path.join(root, show.title.replace(/[<>:"/\\|?*]/g, "_")),
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
const lifecycleMark = AniLink.prototype.markThrough;
AniLink.prototype.markThrough = async function (show, target) {
  await lifecycleMark.call(this, show, target);
  const normal = show.episodes
    .filter((e) => e.type === 0)
    .sort((a, b) => a.sort - b.sort);
  if (
    target.type === 0 &&
    target.id === normal.at(-1)?.id &&
    normal.length >= Number(show.total || 1) &&
    normal.every((e) => e.watched)
  ) {
    await this.changeStatus(show, 2);
    await this.cleanupShow(show);
  }
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
    qb.createEl("p", {
      text: "在 qBittorrent 工具 → 选项 → Web UI 中启用服务，自行设置用户名和密码，然后填写到这里。",
      cls: "al-muted",
    });
    const player = section("播放器");
    player.createEl("p", {
      text: "弹弹play支持自动读取同名XML弹幕。其他支持命令行打开视频的播放器可播放视频，弹幕载入需对应扩展。",
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
      uploaders.value = "690151424,4262884,5306996,442715778,3546957240862932";
    this.biliAccountPanel(bili);
    const save = async () => {
      const values = Object.fromEntries(
        Object.entries(inputs).map(([key, input]) => [key, input.value.trim()]),
      );
      if (!/^\d+(?:[\s,，]+\d+)*$/.test(values.biliUploaders))
        throw Error("请输入有效的 UP 主 UID");
      Object.assign(settings, values);
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

Connections.prototype.display = function () {
  const el = this.containerEl;
  el.empty();
  el.addClass("al-plugin-settings");
  const settings = this.p.state.settings;
  const heading = (text) => new Setting(el).setName(text).setHeading();
  const dropdown = (key, name, description, choices, fallback) =>
    new Setting(el)
      .setName(name)
      .setDesc(description)
      .addDropdown((d) =>
        d
          .addOptions(choices)
          .setValue(String(settings[key] ?? fallback))
          .onChange(async (value) => {
            settings[key] = value;
            await this.p.persist();
          }),
      );
  const toggle = (key, name, description, fallback) =>
    new Setting(el)
      .setName(name)
      .setDesc(description)
      .addToggle((t) =>
        t.setValue(settings[key] ?? fallback).onChange(async (value) => {
          settings[key] = value;
          await this.p.persist();
        }),
      );
  heading("服务连接");
  new Setting(el)
    .setName("连接配置")
    .setDesc("Bangumi、下载器、播放器与 bilibili 账号。")
    .addButton((b) =>
      b.setButtonText("配置").onClick(() => this.p.settingsModal()),
    );
  heading("书架与检索");
  dropdown(
    "shelfQuarterDefault",
    "默认季度",
    "打开插件时采用的季度范围。",
    { all: "全部季度", current: "当前季度", last: "上次设置" },
    "all",
  );
  dropdown(
    "shelfSort",
    "默认排序",
    "最近更新按本地下载完成时间排列。",
    {
      ready: "最近更新",
      title: "名称",
      progress: "观看进度",
      added: "最近加入",
    },
    "ready",
  );
  dropdown(
    "shelfColumns",
    "书架列数",
    "自动模式随面板宽度切换。",
    { auto: "自动", 1: "单列", 2: "双列" },
    "auto",
  );
  toggle("showOriginalName", "原文标题", "在中文标题下显示日文原名。", true);
  for (const status of [1, 3, 4, 5])
    new Setting(el).setName("搜索按钮 · " + C.STATUS[status]).addToggle((t) =>
      t
        .setValue((settings.searchStatuses || [3]).includes(status))
        .onChange(async (enabled) => {
          const values = new Set(settings.searchStatuses || [3]);
          if (enabled) values.add(status);
          else values.delete(status);
          settings.searchStatuses = [...values];
          await this.p.persist();
        }),
    );
  heading("网页");
  dropdown(
    "browserMode",
    "打开方式",
    "选择条目链接的打开位置。",
    { external: "默认浏览器", obsidian: "Obsidian Web viewer" },
    "external",
  );
  dropdown(
    "informationPage",
    "默认番剧信息",
    "首次进入番剧时显示的网页。",
    { fanku: "番库", bangumi: "Bangumi", trend: "评分趋势" },
    "fanku",
  );
  heading("下载与清理");
  toggle(
    "cleanupAfterWatch",
    "已看文件清理",
    "点击看到这里后删除已看文件。全季完成和弃番会清理番剧目录及 RSS。",
    true,
  );
  toggle(
    "downloadNotifications",
    "下载完成通知",
    "发现本地新增待看集时显示通知。",
    true,
  );
  heading("同步与维护");
  new Setting(el)
    .setName("更多下载与同步设置")
    .setDesc("刷新周期、元数据更新与设备同步。")
    .addButton((b) =>
      b.setButtonText("配置").onClick(() => this.p.preferencesModal()),
    );
  new Setting(el)
    .setName("日志")
    .setDesc("查看失败原因并导出排查记录。")
    .addButton((b) =>
      b.setButtonText("查看").onClick(() => this.p.logsModal()),
    );
};

AniLink.prototype.pathPicker = function (input, directory) {
  const row = input.parentElement.createDiv("al-path-picker");
  row.appendChild(input);
  button(row, "选择", () =>
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
    } catch {}
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
      if (result.code !== 0 || !result.data?.isLogin) {
        profile.setText("未登录");
        return;
      }
      const user = result.data;
      const login = [...actions.children].find((b) => b.textContent === "登录");
      if (login) login.hidden = true;
      if (user.face)
        profile.createEl("img", {
          attr: { src: user.face, referrerpolicy: "no-referrer" },
        });
      profile.createSpan({ text: user.uname + " · UID " + user.mid });
    } catch (error) {
      profile.setText("登录状态检查失败");
      C.record(this.state, error.message);
    }
  };
  button(actions, "登录", () => this.websiteLogin("bili"));
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
  this.run(refresh);
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
  const timer = setInterval(async () => {
    if (!modal?.containerEl.isConnected) {
      clearInterval(timer);
      return;
    }
    if (pending) return;
    pending = true;
    try {
      const result = await this.http.json(
        "https://api.bilibili.com/x/web-interface/nav",
      );
      if (result.code === 0 && result.data?.isLogin) {
        clearInterval(timer);
        modal.close();
        new Notice("已登录 " + result.data.uname);
      }
    } catch {
    } finally {
      pending = false;
    }
  }, 2500);
  this.register(() => clearInterval(timer));
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
};
const orderSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  orderSettings.call(this);
  new Setting(this.containerEl)
    .setName("顶部按钮顺序")
    .setDesc("用逗号分隔按钮名称。")
    .addText((t) =>
      t
        .setValue(
          (
            this.p.state.settings.toolbarOrder || [
              "添加番剧",
              "刷新",
              "设置",
              "同步",
              "连接配置",
              "新番表",
              "RSS订阅",
            ]
          ).join("，"),
        )
        .onChange(async (value) => {
          const values = value.split(/[,，]/).map((s) => s.trim());
          const allowed = [
            "添加番剧",
            "刷新",
            "设置",
            "同步",
            "连接配置",
            "新番表",
            "RSS订阅",
          ];
          if (
            values.length !== 7 ||
            new Set(values).size !== 7 ||
            values.some((v) => !allowed.includes(v))
          )
            return;
          this.p.state.settings.toolbarOrder = values;
          await this.p.persist();
          this.p.redraw();
        }),
    );
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
      eye.setAttribute(
        "aria-label",
        input.type === "password" ? "显示密码" : "隐藏密码",
      );
    });
    eye.addClass("al-password-eye");
    eye.setAttribute("aria-label", "显示密码");
    require("obsidian").setIcon(eye, "eye");
  }
  for (const button of [...modal.contentEl.querySelectorAll("button")]) {
    if (button.textContent === "自动检测") button.remove();
    if (button.textContent === "保存") button.addClass("al-save-connections");
    if (button.textContent === "退出登录") button.addClass("mod-warning");
  }
  for (const p of modal.contentEl.querySelectorAll("p"))
    if (p.textContent.includes("弹弹play支持"))
      p.setText(
        "弹弹play（视频与 XML 弹幕）；PotPlayer、mpv、VLC（视频播放，弹幕需要各自扩展）。",
      );
};

AniLink.prototype.alignSourceAudio = async function (source, target) {
  const script = path.join(
    this.app.vault.adapter.basePath,
    this.manifest.dir,
    "align-audio.py",
  );
  return new Promise((resolve, reject) =>
    execFile(
      "python",
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
AniLink.prototype.ensureDownloader = async function () {
  try {
    await this.qb().call("app/version");
    return;
  } catch (error) {
    if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(error.message)) throw error;
  }
  const host = new URL(this.state.settings.qbUrl).hostname;
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host))
    throw Error("远程下载器不可达，请检查服务");
  if (!this.downloaderStarting)
    this.downloaderStarting = (async () => {
      await this.openDownloader();
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          await this.qb().call("app/version");
          return;
        } catch (error) {
          if (!/ERR_CONNECTION_REFUSED|ECONNREFUSED/.test(error.message))
            throw error;
        }
      }
      throw Error("下载器启动超时，请检查Web UI地址");
    })().finally(() => {
      this.downloaderStarting = null;
    });
  return this.downloaderStarting;
};
const readyDownload = AniLink.prototype.downloadRelease;
AniLink.prototype.downloadRelease = async function (show, article) {
  await this.ensureDownloader();
  return readyDownload.call(this, show, article);
};
const calibrationSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  calibrationSettings.call(this);
  new Setting(this.containerEl)
    .setName("播放前校准弹幕")
    .setDesc("逐来源音频校准并保存XML后启动播放器，需要Python、NumPy、FFmpeg。")
    .addToggle((t) =>
      t
        .setValue(this.p.state.settings.calibrateDanmaku !== false)
        .onChange(async (value) => {
          this.p.state.settings.calibrateDanmaku = value;
          await this.p.persist();
        }),
    );
};
const releaseSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  releaseSettings.call(this);
  for (const [kind, name] of [
    ["sponsor", "赞助与支持"],
    ["feedback", "问题反馈"],
  ])
    new Setting(this.containerEl).setName(name).addButton((b) =>
      b.setButtonText("打开面板").onClick(() =>
        new Panel(this.p, name, (el) => {
          el.createEl("img", {
            attr: { src: communityImages[kind], alt: name },
            cls: "al-community-image",
          });
          button(el, "作者B站主页", () =>
            shell.openExternal("https://space.bilibili.com/1065768987"),
          );
          if (kind === "feedback")
            button(el, "GitHub Issues", () =>
              shell.openExternal(
                "https://github.com/beimohai/AniLink-Obsidian/issues",
              ),
            );
        }).open(),
      ),
    );
  this.containerEl.createEl("p", {
    text:
      "AniLink " +
      this.p.manifest.version +
      " · 更新日期 2026-11-11 · 作者 北漠海",
    cls: "al-muted",
  });
};


