// Desktop integration UI. Included in main.js by build.js.
AniLink.prototype.focusShow = function (s) {
  for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
    leaf.view.selected = s.id;
    leaf.view.tab = "episodes";
    leaf.view.render();
  }
};
AniLink.prototype.removeShow = function (s) {
  return this.confirm(
    "移出书架？",
    `${s.title}：保留已下载文件与 Bangumi 收藏，移除订阅和待同步任务。`,
    () =>
      this.run(async () => {
        if (s.subscription.feed && !s.demo)
          await this.removeManagedSubscription(s);
        this.state.shows = this.state.shows.filter((x) => x !== s);
        this.state.queue = this.state.queue.filter((j) => j.showId !== s.id);
        await this.persist();
      }),
  );
};
AniLink.prototype.updateEpisodes = async function (s) {
  if (s.demo) return;
  const [subject, rows] = await Promise.all([
    this.bgm().call(`/v0/subjects/${s.id}`),
    this.bgm().episodes(s.id),
  ]);
  const old = new Map(s.episodes.map((e) => [e.id, e]));
  // An empty or regressed API response must never erase watched files or IDs.
  if (rows.length) {
    const ids = new Set(rows.map((e) => e.id));
    s.episodes = [
      ...rows.map((e) => ({
        ...old.get(e.id),
        id: e.id,
        sort: e.sort,
        ep: e.ep,
        title: e.name_cn || e.name || "",
        type: e.type ?? 0,
        airdate: e.airdate || "",
        watched: old.get(e.id)?.watched || false,
        files: old.get(e.id)?.files || [],
      })),
      ...s.episodes.filter((e) => !ids.has(e.id)),
    ].sort((a, b) => a.type - b.type || a.sort - b.sort);
  }
  s.total =
    subject.eps ||
    s.episodes.filter((e) => e.type === 0).length ||
    subject.total_episodes;
  s.metadataAt = Date.now();
  s.metadataError = "";
  await this.persist();
};
const baseRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const canceled = this.state.shows.filter((s) => s.cancelRemotePending);
  if (canceled.length && this.state.settings.bgmToken)
    try {
      const me = await this.bgm().call("/v0/me");
      for (const s of canceled) {
        if (Date.now() - (s.cancelCheckAt || 0) < 60000) continue;
        s.cancelCheckAt = Date.now();
        try {
          await this.bgm().call(
            `/v0/users/${encodeURIComponent(me.username)}/collections/${s.id}`,
          );
        } catch (e) {
          if (/HTTP 404\b/.test(e.message)) {
            s.cancelRemotePending = false;
            C.record(this.state, `${s.title}：已确认 Bangumi 收藏已取消`);
          }
        }
      }
    } catch  { /* Best-effort optional operation; retain the existing state on failure. */ }
  for (const s of this.state.shows.filter(
    (s) =>
      !s.demo &&
      (s.status === 1 || s.status === 3 || s.subscription.enabled) &&
      Date.now() - (s.metadataAttempt || s.metadataAt || 0) >
        Math.max(1, Number(this.state.settings.metadataHours) || 6) * 3600000,
  )) {
    s.metadataAttempt = Date.now();
    try {
      await this.updateEpisodes(s);
    } catch (e) {
      s.metadataError = e.message;
      C.record(this.state, `${s.title}：分集资料更新失败，将自动重试`);
      s.metadataAttempt = Date.now() - 5 * 3600000;
    }
  }
  await baseRefresh.call(this, manual);
  await this.persist();
  this.redraw();
};
AniLink.prototype.addWish = async function (subject) {
  const existing = this.state.shows.find((s) => s.id === Number(subject.id));
  if (existing) return existing;
  const full = await this.bgm().call(`/v0/subjects/${subject.id}`);
  let episodes = [],
    error = "";
  try {
    episodes = await this.bgm().episodes(subject.id);
  } catch (e) {
    error = e.message;
  }
  const s = C.newShow(full, episodes);
  s.metadataAt = error ? 0 : Date.now();
  s.metadataError = error;
  this.state.shows.push(s);
  C.queueJob(this.state, {
    key: `collection:${s.id}`,
    kind: "collection",
    showId: s.id,
    payload: { type: 1 },
  });
  await this.persist();
  await this.sync();
  this.focusShow(s);
  return s;
};
AniLink.prototype.cancelWish = function (s) {
  return this.confirm(
    "取消想看",
    "取消本地想看并暂停订阅。Bangumi 公开 API 不提供删除收藏；已同步的想看需要在其条目页取消，插件会保留待确认提示。",
    () =>
      this.run(async () => {
        if (s.subscription.enabled) {
          const next = { ...s.subscription, enabled: false };
          await this.updateSubscriptionRule(s, next);
          s.subscription = next;
        }
        const pending = this.state.queue.some(
          (j) => j.key === `collection:${s.id}`,
        );
        this.state.queue = this.state.queue.filter((j) => j.showId !== s.id);
        s.status = 0;
        s.cancelRemotePending = !!s.lastSync || !pending;
        await this.persist();
      }),
  );
};
const baseMarkWatched = AniLink.prototype.markWatched;
AniLink.prototype.markWatched = async function (s, e, value) {
  if (s.status === 0 && value) await this.changeStatus(s, 3);
  return baseMarkWatched.call(this, s, e, value);
};
AniLink.prototype.searchModal = function () {
  new Panel(this, "搜索番剧", (el, m) => {
    m.modalEl.addClass("al-search-modal");
    const controls = el.createDiv("al-search-header");
    const q = field(controls, "名称、条目 ID 或 Bangumi 链接");
    q.placeholder = "例如：前桥魔女 / 511207";
    const sort = select(controls, "排序", "match", {
      match: "相关程度",
      heat: "热度",
      rank: "排名",
      score: "评分",
    });
    const searchActions = controls.createDiv("al-actions al-search-controls");
    const results = el.createDiv("al-results");
    const pager = el.createDiv("al-actions al-search-pager");
    let offset = 0,
      generation = 0,
      lastQuery = "";
    const load = async (reset = false) => {
      const keyword = q.value.trim();
      if (!keyword) {
        new Notice("请输入关键词");
        return;
      }
      if (reset || keyword !== lastQuery) offset = 0;
      lastQuery = keyword;
      const g = ++generation;
      results.empty();
      results.createEl("p", { text: "搜索中…" });
      prev.disabled = next.disabled = true;
      try {
        const id = keyword.match(
          /^(?:https?:\/\/(?:bgm\.tv|bangumi\.tv|chii\.in)\/subject\/)?(\d+)\/?$/,
        )?.[1];
        const data = id
          ? { data: [await this.bgm().call("/v0/subjects/" + id)], total: 1 }
          : await this.bgm().search(keyword, offset, sort.value);
        if (g !== generation) return;
        results.empty();
        results.scrollTop = 0;
        for (const s of data.data || []) {
          if (s.type !== 2) continue;
          const row = results.createDiv("al-search-card");
          const cover = s.images?.medium || s.images?.common;
          row.toggleClass("al-search-text-only", !cover);
          if (cover)
            row.createEl("img", {
              attr: {
                src: cover,
                loading: "lazy",
                referrerpolicy: "no-referrer",
              },
            });
          const info = row.createDiv();
          info.createEl("h3", { text: s.name_cn || s.name });
          if (s.name_cn && s.name_cn !== s.name)
            info.createEl("p", { text: s.name, cls: "al-muted" });
          info.createEl("p", {
            text: `${s.date || "日期未定"} · ${s.platform || "动画"} · ${s.eps || s.total_episodes || "待定"} 集`,
          });
          info.createEl("p", {
            text: `★ ${s.rating?.score || "暂无评分"} · ${s.rating?.total || 0} 人评分${s.rating?.rank ? " · 排名 " + s.rating.rank : ""}`,
            cls: "al-muted",
          });
          const actions = info.createDiv("al-actions");
          button(
            actions,
            "Bangumi",
            () => (
              this.suspendSearch(m),
              this.openWebsite(`https://bgm.tv/subject/${s.id}`)
            ),
          );
          button(
            actions,
            "番库",
            () => (
              this.suspendSearch(m),
              this.openFanku(s).catch((e) => new Notice(e.message))
            ),
          );
          for (const status of this.state.shows.some((x) => x.id === s.id)
            ? []
            : (this.state.settings.searchStatuses || [3]).filter((status) => [1, 3].includes(status)))
            button(
              actions,
              C.STATUS[status],
              () =>
                this.run(async () => {
                  const current = this.state.shows.find((x) => x.id === s.id);
                  if (current?.status === Number(status)) {
                    this.removeShow(current);
                    return;
                  }
                  const added = await this.addSearchStatus(s, Number(status));
                  this.focusShow(added);
                  for (const b of actions.querySelectorAll(
                    ".al-search-status",
                  )) {
                    const chosen =
                      b.textContent.replace("✓ ", "") === C.STATUS[status];
                    b.classList.toggle("al-active", chosen);
                    b.textContent = b.textContent.replace("✓ ", "");
                  }
                  new Notice(`已设为${C.STATUS[status]}`);
                }),
              "al-search-status",
            );
          const existing = this.state.shows.find((x) => x.id === s.id);
          if (existing)
            button(actions, "书架", () => {
              this.focusShow(existing);
              m.close();
              this.redraw();
            });
        }
        if (!results.children.length)
          results.createEl("p", { text: "没有找到动画条目，可试用日文名。" });
        label.setText(
          `第 ${Math.floor(offset / 20) + 1} 页 · 共 ${data.total || 0} 条`,
        );
        prev.disabled = offset === 0;
        next.disabled = !!id || offset + 20 >= (data.total || 0);
      } catch (e) {
        if (g === generation) {
          results.empty();
          results.createEl("p", { text: e.message });
        }
      }
    };
    const prev = button(pager, "上一页", () => {
      offset = Math.max(0, offset - 20);
      load();
    });
    const label = pager.createSpan();
    const next = button(pager, "下一页", () => {
      offset += 20;
      load();
    });
    prev.disabled = next.disabled = true;
    button(searchActions, "搜索", () => load(true), "mod-cta");
    q.onkeydown = (e) => {
      if (e.key === "Enter") load(true);
    };
    sort.onchange = () => load(true);
  }).open();
};

AniLink.prototype.mikanDocument = async function (url) {
  const r = await this.http.request(url);
  return new DOMParser().parseFromString(r.text, "text/html");
};
AniLink.prototype.findSources = async function (s, query) {
  const doc = await this.mikanDocument(
    "https://mikanani.me/Home/Search?searchstr=" + encodeURIComponent(query),
  );
  const ids = [
    ...new Set(
      [...doc.querySelectorAll("a[href]")]
        .map(
          (a) => a.getAttribute("href").match(/^\/Home\/Bangumi\/(\d+)/)?.[1],
        )
        .filter(Boolean),
    ),
  ].slice(0, 16);
  const matches = [];
  for (const id of ids) {
    let page;
    try {
      page = await this.mikanDocument("https://mikanani.me/Home/Bangumi/" + id);
    } catch (error) {
      if (/HTTP 404/.test(error.message)) continue;
      throw error;
    }
    const verified = [...page.querySelectorAll("a[href]")].some((a) => {
      try {
        const u = new URL(a.getAttribute("href"));
        return (
          ["bgm.tv", "bangumi.tv", "chii.in"].includes(u.hostname) &&
          u.pathname.replace(/\/$/, "") === `/subject/${s.id}`
        );
      } catch {
        return false;
      }
    });
    if (!verified) continue;
    const groups = [];
    for (const a of page.querySelectorAll('a[href*="subgroupid="]')) {
      const u = new URL(a.getAttribute("href"), "https://mikanani.me");
      const gid = u.searchParams.get("subgroupid");
      if (groups.some((g) => g.id === gid)) continue;
      const parent = a.closest(".subgroup-text");
      const name =
        parent?.querySelector('a[href*="PublishGroup"]')?.textContent?.trim() ||
        parent?.textContent?.trim().split("\n")[0] ||
        `字幕组 ${gid}`;
      groups.push({ id: gid, name, feed: u.href });
    }
    matches.push({ id, groups });
  }
  return matches;
};
AniLink.prototype.readFeed = async function (url) {
  const r = await this.http.request(url);
  const doc = new DOMParser().parseFromString(r.text, "application/xml");
  if (doc.querySelector("parsererror")) throw Error("RSS 数据格式错误");
  return [...doc.querySelectorAll("item")].map((item) => ({
    title: item.querySelector("title")?.textContent || "",
    date: item.querySelector("pubDate")?.textContent || "",
  }));
};
AniLink.prototype.subscriptionModal = function (s) {
  if (s.demo) {
    new Notice("演练条目不创建真实下载");
    return;
  }
  new Panel(this, "选择字幕组与版本", (el, m) => {
    m.modalEl.addClass("al-source-modal");
    const header = el.createDiv("al-source-header");
    const query = field(
      header,
      "资源名称",
      s.title || s.name,
    );
    const output = el.createDiv("al-results");
    let gen = 0;
    const load = async () => {
      const current = ++gen;
      output.empty();
      output.createEl("p", { text: "正在核对来源与字幕组…" });
      try {
        const sources = await this.findSources(s, query.value.trim());
        if (current !== gen) return;
        output.empty();
        if (!sources.length) {
          output.createEl("p", {
            text: "暂无来源，试试其他译名。",
          });
          return;
        }
        for (const source of sources)
          for (const group of source.groups.filter((group) => !s.sourceSearch?.group || group.name.includes(s.sourceSearch.group))) {
            const row = output.createDiv("al-result al-group-row");
            row.createEl("strong", { text: group.name });
            button(row, "选择", () =>
              this.run(async () => {
                const articles = await this.readFeed(group.feed);
                new Panel(this, `${group.name} · 选择版本`, (body, modal) => {
                  modal.modalEl.addClass("al-version-modal");
                  const enabled = select(body, "下载", "1", {
                    0: "暂存订阅",
                    1: "自动下载",
                  });
                  const versions = body.createDiv("al-version-list");
                  const profiles = new Map();
                  for (const a of articles) {
                    const search = s.sourceSearch || {};
                    const parsed = C.releaseTags(a.title);
                    if (search.quality && !parsed.quality.includes(search.quality)) continue;
                    if (search.language && parsed.language !== search.language) continue;
                    if (search.codec && parsed.codec !== search.codec) continue;
                    if (search.subtitle && parsed.subtitle !== search.subtitle) continue;
                    if (search.exclude && search.exclude.split("|").some((word) => word.trim() && a.title.includes(word.trim()))) continue;
                    const tags = C.releaseTags(a.title),
                      key = [
                        tags.language,
                        tags.quality,
                        tags.codec,
                        tags.subtitle,
                      ].join(" · ");
                    if (!profiles.has(key))
                      profiles.set(key, { tags, rows: [] });
                    profiles.get(key).rows.push(a);
                  }
                  if (!profiles.size)
                    body.createEl("p", {
                      text: "该字幕组暂无资源，稍后重试。",
                    });
                  for (const [key, profile] of profiles) {
                    const box = versions.createDiv("al-version-card");
                    const info = box.createDiv("al-version-info");
                    const latest = profile.rows
                      .map((a) => Date.parse(a.date))
                      .filter(Number.isFinite)
                      .sort((a, b) => b - a)[0];
                    if (latest)
                      info.createEl("p", {
                        text: `更新于 ${new Date(latest).toLocaleDateString("zh-CN")}`,
                        cls: "al-muted",
                      });
                    const tags = info.createDiv("al-version-tags");
                    for (const value of key
                      .split(" · ")
                      .filter((v) => v && v !== "未标注"))
                      tags.createSpan({ text: value });
                    const episodes = [
                      ...new Set(
                        profile.rows
                          .map((a) =>
                            C.resolveEpisode(
                              { ...s, subscription: {} },
                              a.title,
                            ),
                          )
                          .filter(Boolean)
                          .map((e) => e.ep || e.sort),
                      ),
                    ].sort((a, b) => a - b);
                    info.createEl("p", {
                      text: episodes.length
                        ? `${C.episodeRanges(episodes)}集 · RSS 共 ${profile.rows.length} 个资源 · Bangumi 共 ${s.total || "待确认"} 集`
                        : `RSS 共 ${profile.rows.length} 个资源 · 已识别 0 集 · Bangumi 共 ${s.total || "待确认"} 集`,
                      cls: "al-muted",
                    });
                    button(
                      box,
                      "订阅",
                      () =>
                        this.run(async () => {
                          const eps = s.episodes
                            .filter((e) => e.type === 0)
                            .sort((a, b) => a.sort - b.sort);
                          if (!eps.length)
                            throw Error(
                              "尚无分集元数据，暂不能建立自动下载规则",
                            );
                          const sample = profile.rows
                            .map((a) => ({
                              title: a.title,
                              n: C.parseEpisode(a.title),
                            }))
                            .filter((a) => a.n !== null);
                          const absolute = sample.every((a) =>
                              eps.some((e) => e.sort === a.n),
                            ),
                            local = sample.every(
                              (a) => a.n >= 1 && a.n <= eps.length,
                            );
                          const typed = sample.every((a) =>
                            /S\d+E\d+/i.test(a.title),
                          );
                          if (
                            !sample.length ||
                            (absolute &&
                              local &&
                              eps[0].sort !== 1 &&
                              !typed) ||
                            (!absolute && !local)
                          )
                            throw Error(
                              "资源编号存在歧义，自动下载未启用。需要来源提供明确季数或连续编号。",
                            );
                          const numbering =
                            typed || !absolute ? "local" : "absolute";
                          const sub = {
                            ...s.subscription,
                            feed: group.feed,
                            keyword: "",
                            group: "",
                            quality:
                              profile.tags.quality === "未标注"
                                ? ""
                                : profile.tags.quality,
                            language:
                              profile.tags.language === "简繁"
                                ? "简繁"
                                : profile.tags.language === "简中"
                                  ? "简"
                                  : profile.tags.language === "繁中"
                                    ? "繁"
                                    : "",
                            exclude: "",
                            start: numbering === "local" ? 1 : eps[0].sort,
                            end:
                              numbering === "local"
                                ? eps.length
                                : eps.at(-1).sort,
                            numbering,
                            enabled: enabled.value === "1",
                            savePath:
                              s.subscription.savePath ||
                              path.join(
                                this.state.settings.downloadRoot ||
                                  "D:\\Application\\qBittorrent\\downloads",
                                s.title.replace(/[<>:"/\\|?*]/g, "_"),
                              ),
                            profile: profile.tags,
                            sourceGroup: group.name,
                          };
                          if (!sub.quality && !sub.language)
                            throw Error(
                              "此版本缺少可用于筛选的画质或语言，请使用高级 RSS 配置",
                            );
                          const valid = profile.rows.filter((a) =>
                            C.previewMatch(a.title, sub),
                          );
                          if (!valid.length)
                            throw Error("规则未匹配资源，未保存");
                          // Replacing a feed is explicit and cannot leave an active old rule behind.
                          if (
                            s.subscription.feed &&
                            s.subscription.feed !== sub.feed
                          )
                            await this.removeManagedSubscription(s);
                          await this.installSubscription(s, sub);
                          s.subscription = sub;
                          await this.persist();
                          modal.close();
                          m.close();
                          new Notice(
                            `已保存 ${group.name}，${sub.enabled ? "自动下载已启用" : "尚未开始下载"}`,
                          );
                        }),
                      "mod-cta",
                    );
                  }
                }).open();
              }),
            );
          }
      } catch (e) {
        if (current === gen) {
          output.empty();
          output.createEl("p", { text: `来源读取失败：${e.message}` });
        }
      }
    };
    button(header, "搜索", load, "mod-cta");
    button(header, "自定义搜索", () => {
      new Panel(this, "自定义搜索", (body, modal) => {
        const name = field(body, "番剧名称或别名", query.value);
        const group = field(body, "字幕组包含文字", s.sourceSearch?.group || "");
        const quality = select(body, "分辨率", s.sourceSearch?.quality || "", { "": "不限", "2160": "2160p", "1080": "1080p", "720": "720p" });
        const language = select(body, "语言", s.sourceSearch?.language || "", { "": "不限", "简中": "简中", "繁中": "繁中", "简繁": "简繁", "多语": "多语" });
        const codec = select(body, "编码", s.sourceSearch?.codec || "", { "": "不限", HEVC: "HEVC", AVC: "AVC", AV1: "AV1" });
        const subtitle = select(body, "字幕方式", s.sourceSearch?.subtitle || "", { "": "不限", "内嵌": "内嵌", "内封": "内封", "外挂": "外挂" });
        const exclude = field(body, "排除关键词（| 分隔）", s.sourceSearch?.exclude || "");
        button(body, "应用并搜索", () => this.run(async () => {
          s.sourceSearch = { group: group.value.trim(), quality: quality.value, language: language.value, codec: codec.value, subtitle: subtitle.value, exclude: exclude.value.trim() };
          query.value = name.value.trim();
          await this.persist();
          modal.close();
          await load();
        }));
      }).open();
    });
    load();
  }).open();
};

const baseCheckConnections = AniLink.prototype.checkConnections;
AniLink.prototype.checkConnections = async function () {
  await baseCheckConnections.call(this);
  try {
    await fs.access(this.state.settings.playerExe);
    this.health.player = { ok: true, text: "本机播放器可用（远程 API 可选）" };
  } catch  { /* Best-effort optional operation; retain the existing state on failure. */ }
  this.redraw();
};
AniLink.prototype.autoConfigure = async function (useSystemProxy = false) {
  const settings = this.state.settings;
  const exe = "D:\\Application\\qBittorrent\\qbittorrent.exe";
  await fs.access(exe);
  if (!settings.downloadRoot)
    settings.downloadRoot = "D:\\Application\\qBittorrent\\downloads";
  await fs.mkdir(settings.downloadRoot, { recursive: true });
  if (!settings.playerExe)
    settings.playerExe = "D:\\Application\\DanDanPlay\\dandanplay.exe";
  try {
    await this.qb().call("app/version");
  } catch (e) {
    // Never reset credentials or modify another application's profile.
    if (/HTTP|登录/.test(e.message))
      throw Error(
        "服务已响应但认证失败，请在高级设置填写现有 Web UI 用户名和密码",
      );
    execFile(
      exe,
      ["--profile=D:\\Application\\qBittorrent\\profile"],
      { windowsHide: true },
      () => {},
    );
    let ready = false;
    for (let i = 0; i < 8; i++) {
      await new Promise((r) => window.setTimeout(r, 500));
      try {
        await this.qb().call("app/version");
        ready = true;
        break;
      } catch  { /* Best-effort optional operation; retain the existing state on failure. */ }
    }
    if (!ready)
      throw Error("已启动下载器，请检查 Web UI 是否启用及现有账号密码");
  }
  await this.qb().call("app/setPreferences", {
    json: JSON.stringify({
      rss_processing_enabled: true,
      rss_auto_downloading_enabled: true,
    }),
  });
  if (useSystemProxy) {
    const registry = await new Promise((resolve, reject) =>
      execFile(
        "reg.exe",
        [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        ],
        { windowsHide: true },
        (e, out) => (e ? reject(e) : resolve(out)),
      ),
    );
    const enabled = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(registry);
    const address = registry
      .match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/i)?.[1]
      ?.trim();
    const local = address?.match(/^(?:http=)?(127\.0\.0\.1|localhost):(\d+)$/i);
    if (enabled && local) {
      const qb = this.qb(),
        prefs = await qb.call("app/preferences");
      if (prefs.proxy_type === "None") {
        settings.previousQbProxy = {
          proxy_type: prefs.proxy_type,
          proxy_ip: prefs.proxy_ip,
          proxy_port: prefs.proxy_port,
          proxy_rss: prefs.proxy_rss,
          proxy_bittorrent: prefs.proxy_bittorrent,
          proxy_peer_connections: prefs.proxy_peer_connections,
          proxy_misc: prefs.proxy_misc,
          proxy_hostname_lookup: prefs.proxy_hostname_lookup,
        };
        await qb.call("app/setPreferences", {
          json: JSON.stringify({
            proxy_type: "HTTP",
            proxy_ip: local[1],
            proxy_port: Number(local[2]),
            proxy_rss: true,
            proxy_bittorrent: false,
            proxy_peer_connections: false,
            proxy_misc: false,
            proxy_hostname_lookup: true,
          }),
        });
        C.record(this.state, "下载器 RSS 已使用 Windows 当前本机代理");
      }
    } else
      C.record(this.state, "未检测到启用的本机 HTTP 代理，保留下载器网络设置");
  }
  await this.persist();
  await this.checkConnections();
  return this.health;
};
const advancedSettings = AniLink.prototype.settingsModal;
AniLink.prototype.settingsModal = function () {
  new Panel(this, "服务连接", (el, m) => {
    el.createEl("p", {
      text: "必需：Bangumi（搜索与收藏）、qBittorrent（后台 RSS 下载）、弹弹play（播放）。蜜柑作为内置来源，无需安装。",
    });
    el.createEl("p", {
      text: "一键配置会检查 D:\\Application 的现有安装、启动本机下载器、开启 RSS，并检查播放器。不会覆盖已有 Web UI 密码。",
    });
    const proxy = select(el, "RSS 网络", "1", {
      1: "沿用 Windows 已启用的本机 HTTP 代理（下载连接保持直连）",
      0: "保留下载器现有代理设置",
    });
    const result = el.createDiv();
    button(
      el,
      "一键配置并检查",
      () =>
        this.run(async () => {
          result.empty();
          const health = await this.autoConfigure(proxy.value === "1");
          for (const [key, value] of Object.entries(health))
            result.createEl("p", { text: `${key}：${value.text}` });
        }),
      "mod-cta",
    );
    button(el, "恢复一键配置前的代理", () =>
      this.run(async () => {
        const old = this.state.settings.previousQbProxy;
        if (!old) throw Error("没有需要恢复的代理配置");
        await this.qb().call("app/setPreferences", {
          json: JSON.stringify(old),
        });
        delete this.state.settings.previousQbProxy;
        await this.persist();
        new Notice("已恢复原下载器代理设置");
      }),
    );
    const token = field(
      el,
      "Bangumi Token",
      this.state.settings.bgmToken,
      "password",
    );
    link(
      el,
      "生成 Token（可选择一年有效期）",
      "https://next.bgm.tv/demo/access-token",
    );
    button(el, "保存 Token 并同步", () =>
      this.run(async () => {
        this.state.settings.bgmToken = token.value.trim();
        await this.persist();
        await this.sync();
        await this.checkConnections();
        result.empty();
        for (const [name, value] of Object.entries(this.health))
          result.createEl("p", { text: `${name}：${value.text}` });
        new Notice("Token 已保存");
      }),
    );
    button(el, "高级连接设置", () => {
      m.close();
      advancedSettings.call(this);
    });
    el.createEl("p", {
      text: "首次安装仍需要软件本身和 Web UI 账号密码。高级设置包含下载目录、远程地址、路径映射；本机播放不要求启用弹弹play远程 API。",
      cls: "al-muted",
    });
  }).open();
};
