"use strict";
const {
  Plugin,
  ItemView,
  Modal,
  Notice,
  requestUrl,
  Setting,
  PluginSettingTab,
} = require("obsidian");
const { shell } = require("electron");
const fs = require("fs/promises");
const path = require("path");
const { execFile } = require("child_process");
const C = require("./core");
const VIEW = "anilink-dashboard";
let fieldCounter = 0;
function button(el, text, fn, cls = "") {
  const b = el.createEl("button", { text, cls });
  b.onclick = () => fn();
  return b;
}
function field(el, label, value = "", type = "text") {
  const wrap = el.createDiv("al-field"),
    id = "al-field-" + ++fieldCounter;
  wrap.createEl("label", { text: label, attr: { for: id } });
  const input = wrap.createEl(type === "textarea" ? "textarea" : "input", {
    attr: { id },
  });
  if (type !== "textarea") input.type = type;
  input.value = String(value ?? "");
  return input;
}
function select(el, label, value, options) {
  const wrap = el.createDiv("al-field"),
    id = "al-field-" + ++fieldCounter;
  wrap.createEl("label", { text: label, attr: { for: id } });
  const s = wrap.createEl("select", { attr: { id } });
  for (const [v, text] of Object.entries(options))
    s.createEl("option", { value: v, text });
  s.value = String(value);
  return s;
}
function link(el, text, url) {
  button(
    el,
    text,
    () => {
      try {
        const u = new URL(url);
        if (!["http:", "https:"].includes(u.protocol)) throw Error();
        shell.openExternal(u.href);
      } catch {
        new Notice("链接地址无效");
      }
    },
    "al-link",
  );
}
function time(t) {
  return t ? new Date(t).toLocaleString("zh-CN") : "尚未同步";
}
function allFiles(show) {
  return [
    ...show.episodes.flatMap((e) => e.files || []),
    ...(show.unmatched || []),
  ];
}
class Panel extends Modal {
  constructor(p, title, render) {
    super(p.app);
    this.p = p;
    this.title = title;
    this.draw = render;
  }
  onOpen() {
    this.p.panels ??= new Set();
    this.p.panels.add(this);
    this.modalEl.addClass("al-modal");
    this.contentEl.createEl("h2", { text: this.title });
    this.draw(this.contentEl, this);
  }
  onClose() {
    this.p.panels?.delete(this);
    this.contentEl.empty();
  }
}
class Dashboard extends ItemView {
  constructor(leaf, p) {
    super(leaf);
    this.p = p;
    this.filter = "watch";
    this.query = "";
    this.tab = "episodes";
    this.selected = null;
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "AniLink";
  }
  getIcon() {
    return "tv";
  }
  async onOpen() {
    this.render();
  }
  render() {
    const p = this.p,
      root = this.contentEl;
    root.querySelector(":scope > .al-top")?.remove();
    root.querySelector(":scope > .al-footer")?.remove();
    root.addClass("al-root");
    const top = root.createDiv("al-top");
    root.prepend(top);
    const brand = top.createDiv();
    brand.createEl("h1", { text: "AniLink" });
    const actions = top.createDiv("al-actions");
    button(actions, "＋ 添加番剧", () => p.searchModal(), "mod-cta");
    button(actions, "刷新整个插件", () => p.run(() => p.refresh(true)));
    button(actions, `任务 ${p.state.queue.length}`, () => p.jobs());
    button(actions, "设置", () => p.settingsModal());
    button(actions, "同步管理", () => p.syncModal());
    button(actions, "RSS 订阅", () => p.subscriptionsManager());

    const layout =
        root.querySelector(":scope > .al-layout") ||
        root.createDiv("al-layout"),
      nav =
        layout.querySelector(":scope > .al-nav") || layout.createDiv("al-nav");
    nav.empty();
    const filters = {
      watch: "在看",
      ready: "待看",
      wish: "想看",
      done: "看过",
      paused: "搁置",
      all: "全部番剧",
    };
    for (const [key, label] of Object.entries(filters))
      button(
        nav,
        label,
        () => {
          this.filter = key;
          this.render();
        },
        this.filter === key ? "al-active" : "",
      );
    nav.createEl("p", {
      text: "订阅由 qBittorrent 持续运行；关闭 Obsidian 不会停止下载。",
      cls: "al-muted",
    });
    const shelf =
      layout.querySelector(":scope > .al-shelf") ||
      layout.createDiv("al-shelf");
    shelf.empty();
    const search = shelf.createEl("input", {
      type: "search",
      placeholder: "搜索番剧",
      cls: "al-search",
    });
    search.value = this.query;
    search.oninput = () => {
      this.query = search.value;
      this.renderCards(cards);
    };
    const cards = shelf.createDiv("al-cards");
    this.renderCards(cards);
    const detail =
      layout.querySelector(":scope > .al-detail") ||
      layout.createDiv("al-detail");
    const show = p.state.shows.find((s) => s.id === this.selected);
    if (show) this.renderDetail(detail, show);
    else {
      detail.empty();
      detail.createEl("h2", { text: "下一集，等你来看" });
      detail.createEl("p", {
        text: "收藏期待的新番，接住每一次更新",
        cls: "al-muted",
      });
      button(detail, "搜索番剧", () => p.searchModal(), "mod-cta");
    }
    const footer = root.createDiv("al-footer");
    footer.createEl("span", {
      text: p.state.events[0]
        ? `${time(p.state.events[0].at)} · ${p.state.events[0].message}`
        : "还没有任务。先添加一部想看的番剧。",
    });
  }
  renderCards(cards) {
    cards.empty();
    const list = this.p.state.shows.filter((s) => {
      const ready = s.episodes.some(
        (e) =>
          !e.watched &&
          e.files?.some((f) => f.progress === 1 && f.localExists !== false),
      );
      return (
        (this.filter === "all" ||
          (this.filter === "watch" && s.status === 3) ||
          (this.filter === "ready" && ready) ||
          (this.filter === "wish" && s.status === 1) ||
          (this.filter === "done" && s.status === 2) ||
          (this.filter === "paused" && [4, 5].includes(s.status))) &&
        `${s.title} ${s.name}`.toLowerCase().includes(this.query.toLowerCase())
      );
    });
    if (!list.length)
      cards.createEl("p", {
        text: "这里还没有番剧。可切换分类，或添加想看的新番。",
        cls: "al-empty",
      });
    for (const s of list) {
      const card = cards.createEl("button", {
        cls: "al-card" + (this.selected === s.id ? " al-selected" : ""),
      });
      card.dataset.showId = String(s.id);
      card.onclick = () => {
        this.selected = s.id;
        this.render();
      };
      if (s.cover) {
        const img = card.createEl("img", {
          attr: {
            src: s.cover,
            loading: "lazy",
            referrerpolicy: "no-referrer",
          },
        });
        img.onerror = () => img.remove();
      } else card.createDiv({ text: "番", cls: "al-cover-placeholder" });
      const meta = card.createDiv();
      meta.createEl("strong", { text: s.title });
      const eps = s.episodes.filter((e) => e.type === 0),
        watched = eps.filter((e) => e.watched).length;
      meta.createEl("p", {
        text: `${C.STATUS[s.status]} · ${watched}/${s.total || eps.length || "待定"}集`,
        cls: "al-muted",
      });
      const ready = eps.filter(
        (e) =>
          !e.watched &&
          e.files?.some((f) => f.progress === 1 && f.localExists !== false),
      ).length;
      meta.createEl("span", {
        text: ready
          ? `${ready} 集待看`
          : s.subscription.enabled
            ? "订阅中"
            : "未启用订阅",
        cls: ready ? "al-pill" : "al-muted",
      });
      if (s.demo) meta.createEl("span", { text: " 演练", cls: "al-muted" });
    }
  }
  renderDetail(el, s) {
    const p = this.p;
    const head = el.createDiv("al-detail-head");
    const titleBlock = head.createDiv("al-title-block");
    titleBlock.createEl("h2", { text: s.title });
    if (s.name && s.name !== s.title)
      titleBlock.createEl("p", { text: s.name, cls: "al-muted" });
    const links = head.createDiv("al-actions");
    button(links, "Bangumi", () =>
      p.openWebsite(`https://bgm.tv/subject/${s.id}`),
    );
    button(links, "番库", () => p.run(() => p.openFanku(s)));
    button(links, "移出书架", () => p.removeShow(s));
    if (s.status === 1) button(links, "取消想看", () => p.cancelWish(s));
    if (s.cancelRemotePending) {
      links.createEl("span", {
        text: "Bangumi 取消收藏待确认",
        cls: "al-muted",
      });
      link(links, "去 Bangumi 取消", "https://bgm.tv/subject/" + s.id);
    }
    const states = head.createDiv("al-status-buttons");
    for (const n of [1, 3, 2, 4, 5]) {
      const b = button(
        states,
        C.STATUS[n],
        () => p.run(() => p.changeStatus(s, n)),
        s.status === n ? "al-active" : "",
      );
      b.setAttribute("aria-pressed", String(s.status === n));
    }
    const tabs = el.createDiv("al-tabs");
    for (const [key, label] of Object.entries({
      episodes: "集数",

      danmaku: "弹幕",
      review: "评价",
    }))
      button(
        tabs,
        label,
        () => {
          this.tab = key;
          this.render();
        },
        this.tab === key ? "al-active" : "",
      );
    const body = el.createDiv("al-tab-body");
    if (this.tab === "episodes") {
      // Episode content is rendered by the dedicated progress panel.
    } else if (this.tab === "subscription") {
      const sub = s.subscription;
      if (s.rssError) body.createEl("p", { text: s.rssError, cls: "al-muted" });
      body.createEl("h3", {
        text: sub.feed ? (sub.enabled ? "订阅中" : "已暂停") : "未订阅",
      });
      body.createEl("p", {
        text: sub.feed ? "" : "尚未选择字幕组",
        cls: "al-muted",
      });
      body.createEl("p", {
        text: sub.feed ? sub.sourceGroup || sub.group || "已订阅" : "",
      });
      if (sub.feed) {
        const tags = body.createDiv("al-version-tags");
        for (const value of [
          sub.profile?.language || sub.language,
          sub.profile?.codec,
          sub.profile?.subtitle,
        ].filter((v) => v && v !== "未标注"))
          tags.createSpan({ text: value });
      }
      button(body, "选择字幕组", () => p.subscriptionModal(s), "mod-cta");
      if (sub.feed) {
        button(body, sub.enabled ? "暂停订阅" : "恢复订阅", () =>
          p.run(async () => {
            const next = { ...sub, enabled: !sub.enabled };
            await p.installSubscription(s, next);
            s.subscription = next;
            await p.persist();
          }),
        );
        button(body, "移除订阅", () =>
          p.confirm(
            "移除自动订阅？",
            "将移除这部番剧的 RSS 和规则，保留已下载文件、观看与评价记录。",
            () =>
              p.run(async () => {
                await p.removeManagedSubscription(s);
                s.subscription.enabled = false;
                s.subscription.feed = "";
                delete s.subscription.sourceGroup;
                s.subscription.group = "";
                delete s.subscription.profile;
                await p.persist();
              }),
          ),
        );
      }
      button(body, "打开下载器", () => p.run(() => p.openDownloader()));
    } else if (this.tab === "danmaku") {
      body.createEl("h3", { text: "B站弹幕" });
      body.createEl("p", {
        text: "解析 B站整季 / BV 分P链接后确认集数对应。弹幕保存为视频旁的同名 XML，弹弹play可自动读取。已有 XML 不会被覆盖。",
        cls: "al-muted",
      });
      button(body, "批量关联 B站弹幕", () => p.danmakuModal(s), "mod-cta");
      for (const e of s.episodes.filter((e) => e.danmaku))
        body.createEl("p", {
          text: `第 ${e.sort} 集 · CID ${e.danmaku.cid} · 偏移 ${e.danmaku.offset || 0} 秒${e.danmaku.saved ? " · 已保存" : ""}`,
        });
    } else {
      this.reviewDrafts = this.reviewDrafts || {};
      const draft = this.reviewDrafts[s.id] || {
        rate: s.rate,
        comment: s.comment,
        private: s.private,
      };
      const rate = select(body, "评分", draft.rate, {
        0: "未评分",
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [i + 1, `${i + 1} 分`]),
        ),
      });
      const comment = field(body, "短评", draft.comment, "textarea");
      const privacy = select(body, "可见性", draft.private ? "1" : "0", {
        0: "公开",
        1: "私密",
      });
      const keepDraft = () => {
        this.reviewDrafts[s.id] = {
          rate: Number(rate.value),
          comment: comment.value,
          private: privacy.value === "1",
        };
      };
      rate.onchange = keepDraft;
      comment.oninput = keepDraft;
      privacy.onchange = keepDraft;
      button(
        body,
        "保存并同步评价",
        () =>
          p.run(async () => {
            if (s.status === 0) throw Error("请先选择追番状态，再同步评价");
            s.localRevision = (s.localRevision || 0) + 1;
            s.rate = Number(rate.value);
            s.comment = comment.value;
            s.private = privacy.value === "1";
            delete this.reviewDrafts[s.id];
            if (!s.demo)
              C.queueJob(p.state, {
                key: `collection:${s.id}`,
                kind: "collection",
                showId: s.id,
                payload: {
                  rate: s.rate,
                  comment: s.comment,
                  private: s.private,
                  type: s.status,
                },
              });
            await p.persist();
            p.background("Bangumi 推送", () => p.sync());
          }),
        "mod-cta",
      );
      body.createEl("p", {
        text: `最近成功同步：${time(s.lastSync)}`,
        cls: "al-muted",
      });
      button(body, "打开番库", () => p.fankuModal(s));
    }
  }
}
class AniLink extends Plugin {
  async onload() {
    const saved = await this.loadData();
    this.state = {
      ...C.defaults(),
      ...saved,
      settings: { ...C.defaults().settings, ...saved?.settings },
    };
    this.health = {};
    this.busy = false;
    this.saveChain = Promise.resolve();
    this.http = new C.Http(requestUrl);
    this.registerView(VIEW, (leaf) => new Dashboard(leaf, this));
    this.addRibbonIcon("tv", "打开 AniLink", () => this.open());
    this.addCommand({
      id: "open",
      name: "打开追番中心",
      callback: () => this.open(),
    });
    this.addCommand({
      id: "refresh",
      name: "刷新下载与待同步任务",
      callback: () => this.run(() => this.refresh(true)),
    });
    this.addSettingTab(new Connections(this.app, this));
    this.registerInterval(
      window.setInterval(() => {
        if (
          this.state.settings.autoRefresh !== false &&
          Date.now() - (this.lastPoll || 0) >=
            Math.max(30, Number(this.state.settings.pollSeconds) || 60) * 1000
        )
          this.run(() => this.refresh(false), true);
      }, 10000),
    );
  }
  async open() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) {
      leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: VIEW, active: true });
    }
    this.app.workspace.revealLeaf(leaf);
  }
  redraw() {
    for (const l of this.app.workspace.getLeavesOfType(VIEW)) {
      if (!l.view?.contentEl || typeof l.view.render !== "function") continue;
      const active = l.view.contentEl.ownerDocument?.activeElement;
      if (
        active &&
        l.view.contentEl.contains(active) &&
        active.matches("input,textarea,select")
      )
        continue;
      l.view.render();
    }
  }
  persist() {
    const data = JSON.parse(JSON.stringify(this.state));
    this.saveChain = this.saveChain
      .catch(() => {})
      .then(() => this.saveData(data));
    return this.saveChain;
  }
  async run(fn, quiet = false) {
    if (this.busy) {
      if (!quiet) new Notice("正在处理上一项操作，请稍候");
      return;
    }
    this.busy = true;
    try {
      await fn();
    } catch (e) {
      C.record(this.state, e.message);
      await this.persist();
      if (!quiet) new Notice(e.message, 8000);
    } finally {
      this.busy = false;
      this.redraw();
    }
  }
  qb() {
    return new C.QBittorrent(this.http, this.state.settings);
  }
  bgm() {
    return new C.Bangumi(this.http, this.state.settings.bgmToken);
  }
  confirm(title, text, fn) {
    new Panel(this, title, (el, m) => {
      el.createEl("p", { text });
      const a = el.createDiv("al-actions");
      button(a, "取消", () => m.close());
      button(
        a,
        "确认",
        () => {
          m.close();
          fn();
        },
        "mod-warning",
      );
    }).open();
  }
  async checkConnections() {
    for (const [key, fn] of [
      [
        "bgm",
        () =>
          this.state.settings.bgmToken
            ? this.bgm().call("/v0/me")
            : Promise.reject(Error("未配置 Token")),
      ],
      ["qb", () => this.qb().call("app/version")],
      [
        "player",
        () =>
          this.http.json(
            C.baseUrl(this.state.settings.playerUrl) + "/api/v1/welcome",
            "GET",
            undefined,
            this.state.settings.playerToken
              ? { Authorization: `Bearer ${this.state.settings.playerToken}` }
              : {},
          ),
      ],
    ]) {
      try {
        const r = await fn();
        this.health[key] = {
          ok: true,
          text:
            key === "bgm"
              ? r.nickname || r.username
              : key === "qb"
                ? String(r)
                : `v${r.version}`,
        };
      } catch (e) {
        this.health[key] = { ok: false, text: e.message };
      }
    }
    await this.persist();
  }
  async refresh(manual) {
    this.lastPoll = Date.now();
    const shows = this.state.shows.filter(
      (s) => s.subscription.feed && !s.demo,
    );
    if (shows.length) {
      const qb = this.qb();
      try {
        for (const s of shows) {
          const tasks = await qb.torrents(s);
          const files = [];
          for (const t of tasks) files.push(await qb.files(t.hash));
          const was = new Set(
            allFiles(s)
              .filter((f) => f.progress === 1 && f.localExists !== false)
              .map((f) => f.hash + ":" + f.index),
          );
          C.mergeFiles(s, tasks, files, this.state.settings);
          const fresh = allFiles(s).filter(
            (f) =>
              f.progress === 1 &&
              f.localExists !== false &&
              !was.has(f.hash + ":" + f.index),
          );
          if (fresh.length) {
            C.record(this.state, `${s.title}：${fresh.length} 个视频下载完成`);
          }
        }
        this.health.qb = { ok: true, text: "已更新下载状态" };
      } catch (e) {
        this.health.qb = { ok: false, text: e.message };
        C.record(this.state, "下载状态更新失败：" + e.message);
        if (manual) new Notice(e.message);
      }
    }
    await this.sync();
    await this.persist();
    if (manual) new Notice("AniLink 刷新完成");
  }
  async markWatched(s, e, value) {
    s.localRevision = (s.localRevision || 0) + 1;
    e.watched = value;
    if (!s.demo) {
      if (
        !this.state.queue.some((j) => j.key === `collection:${s.id}`) &&
        !s.lastSync
      )
        C.queueJob(this.state, {
          key: `collection:${s.id}`,
          kind: "collection",
          showId: s.id,
          payload: { type: s.status },
        });
      C.queueJob(this.state, {
        key: `episode:${e.id}`,
        kind: "episode",
        showId: s.id,
        episodeId: e.id,
        payload: { type: value ? 2 : 0 },
      });
    }
    C.record(
      this.state,
      `${s.title} 第 ${e.sort} 集${value ? "已看" : "设为未看"}`,
    );
    await this.persist();
    await this.sync();
  }
  subscriptionModal(s) {
    if (s.demo) {
      new Notice("演练模式不创建真实订阅");
      return;
    }
    new Panel(this, "配置字幕组与订阅范围", (el, m) => {
      m.modalEl.addClass("al-custom-rss");
      const form = el.createDiv("al-rss-form");
      const actions = el.createDiv("al-actions al-form-footer");
      const sub = s.subscription;
      const feed = field(form, "RSS 地址", sub.feed);
      const keyword = field(form, "番剧关键词", sub.keyword);
      const group = field(form, "字幕组", sub.group);
      const quality = field(form, "画质关键词", sub.quality);
      const language = field(form, "字幕语言关键词", sub.language);
      const exclude = field(form, "排除关键词，用 | 分隔", sub.exclude);
      const range = form.createDiv("al-two");
      const start = field(range, "起始集", sub.start, "number"),
        end = field(range, "结束集", sub.end, "number");
      const folder = field(
        form,
        "下载目录",
        sub.savePath || this.state.settings.downloadRoot,
      );
      const enabled = select(form, "下载", "1", {
        0: "仅保存配置，不下载",
        1: "自动下载",
      });
      el.createEl("p", {
        text: "多个关键词必须全部命中。首版自动排除合集与范围包；无法识别的文件可手动绑定。qBittorrent 自身集数识别与页面预览可能有差异，请先查看样本。",
        cls: "al-muted",
      });
      const groups = form.createDiv("al-rss-groups");
      const result = form.createDiv("al-results");
      const read = () => ({
        feed: feed.value.trim(),
        keyword: keyword.value.trim(),
        group: group.value.trim(),
        quality: quality.value.trim(),
        language: language.value.trim(),
        exclude: exclude.value.trim(),
        start: Number(start.value),
        end: Number(end.value),
        savePath: folder.value.trim(),
        enabled: enabled.value === "1",
      });
      button(actions, "检查匹配", () =>
        this.run(async () => {
          const draft = read();
          C.buildRule(s, draft);
          result.empty();
          result.createEl("p", {
            text: "正在刷新 RSS，首次获取可能需要稍等后再次预览…",
          });
          const rows = await this.qb().articles(s, draft);
          groups.empty();
          const names = [
            ...new Set(
              rows
                .map((a) => a.title.match(/^\[([^\]]+)\]/)?.[1])
                .filter(Boolean),
            ),
          ];
          if (names.length) {
            const picker = select(groups, "从 RSS 中选择字幕组", "", {
              "": "手动填写 / 不限",
              ...Object.fromEntries(names.map((n) => [n, n])),
            });
            picker.onchange = () => {
              group.value = picker.value;
            };
          }
          result.empty();
          if (!rows.length)
            result.createEl("p", { text: "RSS 暂无条目，请稍后再次预览。" });
          for (const a of rows.slice(0, 50))
            result.createEl("p", {
              text: `${C.previewMatch(a.title, draft) ? "✓" : "—"} ${a.title}`,
            });
        }),
      );
      button(
        actions,
        "保存订阅",
        () =>
          this.run(async () => {
            const draft = read();
            C.buildRule(s, draft);
            await this.installSubscription(s, draft);
            s.subscription = draft;
            C.record(
              this.state,
              `${s.title}：订阅已${draft.enabled ? "启用" : "保存"}`,
            );
            await this.persist();
            m.close();
          }),
        "mod-cta",
      );
    }).open();
  }
  pickFile(s, e, files) {
    if (files.length === 1) this.run(() => this.play(s, e, files[0]));
    else
      new Panel(this, "选择播放版本", (el, m) => {
        for (const f of files)
          button(el, f.name, () => {
            m.close();
            this.run(() => this.play(s, e, f));
          });
      }).open();
  }
  async play(s, e, f) {
    if (s.demo) {
      new Notice("这是演练文件，不会启动真实播放器");
      return;
    }
    await fs.access(f.path);
    const exe = this.state.settings.playerExe;
    if (!exe || !path.isAbsolute(exe))
      throw Error("请先在连接设置中填写弹弹play可执行文件的绝对路径");
    await fs.access(exe);
    await new Promise((resolve, reject) => {
      const child = execFile(exe, [f.path], { windowsHide: true }, (err) => {
        if (err) C.record(this.state, "播放器已退出");
      });
      child.once("error", reject);
      child.once("spawn", resolve);
    });
    C.record(this.state, `已交给弹弹play：${s.title} 第 ${e.sort} 集`);
    await this.persist();
    new Notice("已打开弹弹play");
  }
  filesModal(s, e) {
    new Panel(this, `第 ${e.sort} 集 · 文件管理`, (el, m) => {
      for (const f of e.files || []) {
        const row = el.createDiv("al-file");
        row.createEl("strong", { text: f.name });
        row.createEl("p", { text: f.path, cls: "al-muted" });
        button(row, "打开文件位置", () => {
          if (!s.demo) shell.showItemInFolder(f.path);
        });
        button(
          row,
          "删除下载任务及文件",
          () => {
            m.close();
            const affected = allFiles(s).filter((x) => x.hash === f.hash);
            this.confirm(
              "删除整个下载任务及文件？",
              `任务：${f.taskTitle}\n涉及 ${affected.length} 个视频：${affected.map((x) => x.name).join("、")}。合集的其他文件也会一起删除。观看记录保留；原发布标题将加入排除列表。`,
              () =>
                this.run(async () => {
                  if (!s.demo) {
                    if (!s.blockedTitles.includes(f.taskTitle))
                      s.blockedTitles.push(f.taskTitle);
                    await this.persist();
                    if (s.subscription.feed) await this.qb().setRule(s);
                    await this.qb().delete(f.hash);
                  }
                  for (const ep of s.episodes)
                    ep.files = (ep.files || []).filter(
                      (x) => x.hash !== f.hash,
                    );
                  s.unmatched = (s.unmatched || []).filter(
                    (x) => x.hash !== f.hash,
                  );
                  C.record(
                    this.state,
                    `${s.title}：已删除下载文件，保留观看记录`,
                  );
                  await this.persist();
                }),
            );
          },
          "mod-warning",
        );
      }
    }).open();
  }
  mappingModal(s) {
    new Panel(this, "手动绑定未识别文件", (el, m) => {
      const choices = {
        "": "暂不绑定",
        ...Object.fromEntries(
          s.episodes.map((e) => [
            e.id,
            `${e.type === 0 ? "正片" : "特别篇"} ${e.sort} · ${e.title}`,
          ]),
        ),
      };
      const rows = (s.unmatched || []).map((f) => ({
        f,
        input: select(el, f.name, "", choices),
      }));
      button(
        el,
        "保存绑定",
        () =>
          this.run(async () => {
            for (const { f, input } of rows) {
              const ep = s.episodes.find((e) => e.id === Number(input.value));
              if (ep) {
                f.episodeId = ep.id;
                ep.files.push(f);
              }
            }
            s.unmatched = s.unmatched.filter((f) => !f.episodeId);
            await this.persist();
            m.close();
          }),
        "mod-cta",
      );
    }).open();
  }
  pullModal(s) {
    if (s.demo) return;
    this.confirm(
      "读取 Bangumi 记录？",
      "将以线上收藏、评分、短评及分集状态更新本地记录。有待同步更改时会阻止读取，避免覆盖。",
      () =>
        this.run(async () => {
          if (this.state.queue.some((j) => j.showId === s.id))
            throw Error("该番剧还有待同步任务，请先同步或在任务页撤销");
          const bgm = this.bgm();
          if (!this.state.settings.bgmToken)
            throw Error("请先配置 Bangumi Token");
          const me = await bgm.call("/v0/me"),
            collection = await bgm.call(
              `/v0/users/${encodeURIComponent(me.username)}/collections/${s.id}`,
            );
          const rows = await bgm.pages(
            `/v0/users/-/collections/${s.id}/episodes`,
          );
          s.status = collection.type;
          s.rate = collection.rate || 0;
          s.comment = collection.comment || "";
          s.private = collection.private || false;
          for (const e of s.episodes) {
            const r = rows.find((x) => x.episode.id === e.id);
            if (r) e.watched = r.type === 2;
          }
          s.lastSync = Date.now();
          await this.persist();
        }),
    );
  }
  fankuModal(s) {
    new Panel(this, "番库页面链接", (el, m) => {
      const input = field(el, "粘贴这部番剧的番库详情页地址", s.fankuUrl);
      link(el, "打开番库查找", "https://fankuhub.com/");
      button(
        el,
        "保存",
        () =>
          this.run(async () => {
            const value = input.value.trim();
            if (value) {
              const u = new URL(value);
              if (
                u.protocol !== "https:" ||
                !["fankuhub.com", "www.fankuhub.com"].includes(u.hostname)
              )
                throw Error("请输入 fankuhub.com 的 HTTPS 地址");
            }
            s.fankuUrl = value;
            await this.persist();
            m.close();
          }),
        "mod-cta",
      );
    }).open();
  }
  jobs() {
    new Panel(this, "后台任务与操作记录", (el, m) => {
      el.createEl("p", {
        text: "未配置 Token 的操作先保存在本地，配置后点击重试。撤销队列不会自动回滚本地状态，可重新读取线上记录。",
        cls: "al-muted",
      });
      button(
        el,
        "重试同步",
        () =>
          this.run(async () => {
            if (!this.state.settings.bgmToken)
              throw Error("请先配置 Bangumi Token");
            await this.sync();
            m.close();
            this.jobs();
          }),
        "mod-cta",
      );
      for (const j of this.state.queue) {
        const row = el.createDiv("al-file");
        row.createEl("strong", {
          text: `${this.state.shows.find((s) => s.id === j.showId)?.title || j.showId} · ${j.kind === "episode" ? "分集进度" : "收藏 / 评价"}`,
        });
        row.createEl("p", {
          text: j.error ? `失败 ${j.attempts} 次：${j.error}` : "等待同步",
        });
        button(row, "撤销待同步更改", () =>
          this.confirm(
            "撤销这个待同步任务？",
            "不会撤销本地标记，也不会删除线上已有记录。",
            () =>
              this.run(async () => {
                this.state.queue = this.state.queue.filter((x) => x !== j);
                await this.persist();
                m.close();
                this.jobs();
              }),
          ),
        );
      }
      el.createEl("h3", { text: "下载任务" });
      for (const s of this.state.shows) {
        const files = allFiles(s);
        for (const hash of new Set(files.map((f) => f.hash))) {
          const list = files.filter((f) => f.hash === hash);
          el.createEl("p", {
            text:
              s.title +
              " · " +
              list[0].taskTitle +
              " · " +
              Math.round(
                (list.reduce((n, f) => n + f.progress, 0) / list.length) * 100,
              ) +
              "%",
            cls: "al-muted",
          });
        }
      }
      el.createEl("h3", { text: "最近记录" });
      for (const e of this.state.events.slice(0, 30))
        el.createEl("p", {
          text: `${time(e.at)} · ${e.message}`,
          cls: "al-muted",
        });
    }).open();
  }
  settingsModal() {
    new Panel(this, "连接与下载设置", (el, m) => {
      const s = this.state.settings;
      const inputs = {};
      for (const [key, label, type] of [
        ["qbUrl", "qBittorrent Web UI 地址"],
        ["qbUser", "qBittorrent 用户名"],
        ["qbPassword", "qBittorrent 密码", "password"],
        ["bgmToken", "Bangumi Access Token", "password"],
        ["playerExe", "弹弹play EXE 路径"],
        ["playerUrl", "弹弹play远程访问地址"],
        ["playerToken", "弹弹play远程访问密钥", "password"],
        ["downloadRoot", "默认下载目录（下载器侧）"],
        ["remoteRoot", "路径映射：下载器前缀（可选）"],
        ["localRoot", "路径映射：本机前缀（可选）"],
        ["pollSeconds", "状态刷新间隔（秒，最少30）", "number"],
      ])
        inputs[key] = field(el, label, s[key], type);
      el.createEl("p", {
        text: "凭据保存在本测试库插件 data.json，请勿分享该文件。需在 qBittorrent 开启 Web UI、RSS 获取和自动下载。首版观看进度手动确认。",
        cls: "al-muted",
      });
      link(el, "获取 Bangumi Token", "https://next.bgm.tv/demo/access-token");
      button(
        el,
        "保存并检查连接",
        () =>
          this.run(async () => {
            const next = { ...s };
            for (const [k, i] of Object.entries(inputs))
              next[k] = i.value.trim();
            C.baseUrl(next.qbUrl);
            C.baseUrl(next.playerUrl);
            next.pollSeconds = Math.max(30, Number(next.pollSeconds) || 60);
            this.state.settings = next;
            await this.persist();
            await this.checkConnections();
            m.close();
            new Notice("连接设置已保存");
          }),
        "mod-cta",
      );
    }).open();
  }
  async biliSource(value) {
    let endpoint;
    const text = value.trim(),
      bv = text.match(/BV[\w]+/),
      ss = text.match(/(?:ss)(\d+)/),
      ep = text.match(/(?:ep)(\d+)/);
    if (bv)
      endpoint = "https://api.bilibili.com/x/web-interface/view?bvid=" + bv[0];
    else if (ss || ep)
      endpoint =
        "https://api.bilibili.com/pgc/view/web/season?" +
        (ss ? "season_id=" + ss[1] : "ep_id=" + ep[1]);
    else throw Error("请输入包含 ss / ep / BV 编号的 B站链接");
    const r = await this.http.json(endpoint, "GET", undefined, {
      Referer: "https://www.bilibili.com/",
    });
    if (r.code !== 0)
      throw Error(`B站来源读取失败（${r.code}），可改用手动 CID`);
    return bv
      ? (r.data.pages || []).map((x) => ({
          sort: x.page,
          cid: x.cid,
          title: x.part,
        }))
      : (r.result.episodes || [])
          .map((x) => ({
            sort: Number(x.title),
            cid: x.cid,
            title: x.long_title || x.title,
          }))
          .filter((x) => Number.isFinite(x.sort) && x.cid);
  }
}
class Connections extends PluginSettingTab {
  constructor(app, p) {
    super(app, p);
    this.p = p;
  }
  display() {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("统一追番中心")
      .setDesc("订阅、下载、播放、进度和评价均在 AniLink 页面管理。")
      .addButton((b) =>
        b.setButtonText("打开 AniLink").onClick(() => this.p.open()),
      );
    new Setting(this.containerEl)
      .setName("服务连接")
      .addButton((b) =>
        b.setButtonText("配置连接").onClick(() => this.p.settingsModal()),
      );
  }
}
module.exports = AniLink;
