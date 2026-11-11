const readyEpisodes = (s) =>
  s.episodes.filter(
    (e) =>
      !e.watched &&
      e.files?.some((f) => f.progress === 1 && f.localExists !== false),
  );
const newestReady = (s) =>
  Math.max(
    0,
    ...readyEpisodes(s).flatMap((e) =>
      e.files
        .filter((f) => f.progress === 1 && f.localExists !== false)
        .map((f) => f.completedAt || 0),
    ),
  );
const fieldsOf = (s) => ({
  status: s.status,
  rate: s.rate || 0,
  comment: s.comment || "",
  private: !!s.private,
});
AniLink.prototype.sync = function () {
  if (this.syncPromise) return this.syncPromise;
  this.syncPromise = (async () => {
    if (!this.state.settings.bgmToken) return;
    for (let pass = 0; pass < 5; pass++) {
      const jobs = [...this.state.queue];
      if (!jobs.length) break;
      for (const job of jobs) {
        if (this.disposed) return;
        const version = job.revision,
          snapshot = JSON.parse(JSON.stringify(job));
        const subject = this.state.shows.find((s) => s.id === job.showId);
        if (subject && job.kind === "collection")
          snapshot.payload = {
            rate: subject.rate || 0,
            comment: subject.comment || "",
            private: !!subject.private,
            type: subject.status,
            ...snapshot.payload,
          };
        try {
          await this.bgm().send(snapshot);
          const s = this.state.shows.find((s) => s.id === job.showId);
          if (job.revision === version)
            this.state.queue = this.state.queue.filter((x) => x !== job);
          if (s) s.lastSync = Date.now();
          if (s && job.kind === "collection") {
            s.syncBase = {
              ...(s.syncBase || {}),
              ...Object.fromEntries(
                Object.entries(snapshot.payload).map(([k, v]) => [
                  k === "type" ? "status" : k,
                  v,
                ]),
              ),
            };
          }
          this.state.lastPush = Date.now();
          this.state.syncError = "";
        } catch (e) {
          job.attempts++;
          job.error = e.message;
          clearTimeout(this.pushRetryTimer);
          this.pushRetryTimer = setTimeout(
            () => {
              if (!this.disposed)
                this.background("重试推送", () => this.sync());
            },
            Math.min(300000, 15000 * 2 ** Math.min(job.attempts - 1, 5)),
          );
          this.pushRetryTimer.unref?.();
          this.register(() => clearTimeout(this.pushRetryTimer));
          this.state.syncError = e.message;
          await this.persist();
          return;
        }
        await this.persist();
      }
    }
  })().finally(() => {
    this.syncPromise = null;
    if (!this.disposed) this.redraw();
  });
  return this.syncPromise;
};
AniLink.prototype.changeStatus = async function (s, status) {
  if (status === 0) return this.cancelWish(s);
  s.localRevision = (s.localRevision || 0) + 1;
  s.status = status;
  s.localChangedAt = Date.now();
  s.cancelRemotePending = false;
  C.queueJob(this.state, {
    key: `collection:${s.id}`,
    kind: "collection",
    showId: s.id,
    payload: { type: status },
  });
  await this.persist();
  this.redraw();
  this.background("Bangumi 推送", () => this.sync());
  if ([2, 4, 5].includes(status) && s.subscription.enabled) {
    s.subscription.enabled = false;
    await this.persist();
    this.background(`订阅暂停 ${s.id}`, async () => {
      try {
        await this.updateSubscriptionRule(s, s.subscription);
        s.ruleError = "";
      } catch (e) {
        s.ruleError = e.message;
        C.record(this.state, "状态已保存；订阅暂停待重试：" + e.message);
      }
      await this.persist();
    });
  }
};
const pullLocalFirst = AniLink.prototype.pullAccount;
AniLink.prototype.pullAccount = async function () {
  if (this.importPolicy === "remote") return pullLocalFirst.call(this);
  if (!this.state.settings.bgmToken) throw Error("请先填写 Bangumi Token");
  await this.sync();
  const bgm = this.bgm(),
    me = await bgm.call("/v0/me"),
    rows = await bgm.pages(
      `/v0/users/${encodeURIComponent(me.username)}/collections?subject_type=2`,
    );
  let added = 0;
  const conflicts = [];
  const hidden = new Set(this.state.hiddenShows || []);
  for (const row of rows) {
    const id = Number(row.subject_id);
    if (hidden.has(id)) continue;
    let s = this.state.shows.find((s) => s.id === id);
    const remote = {
      status: row.type,
      rate: row.rate || 0,
      comment: row.comment || "",
      private: !!row.private,
    };
    if (!s) {
      s = C.newShow({ ...row.subject, id }, []);
      Object.assign(s, remote, { lastSync: Date.now(), syncBase: remote });
      this.state.shows.push(s);
      added++;
    } else if (JSON.stringify(fieldsOf(s)) !== JSON.stringify(remote)) {
      s.remoteConflict = remote;
      conflicts.push(id);
    } else {
      s.remoteConflict = null;
      s.syncBase = remote;
    }
  }
  this.state.lastAccountSync = Date.now();
  this.state.accountSyncError = "";
  await this.persist();
  this.redraw();
  return added;
};
AniLink.prototype.resolveConflict = async function (s, remote) {
  if (remote) {
    Object.assign(s, s.remoteConflict);
    this.state.queue = this.state.queue.filter(
      (j) => j.showId !== s.id || j.kind !== "collection",
    );
    s.localRevision = (s.localRevision || 0) + 1;
  } else {
    const f = fieldsOf(s);
    C.queueJob(this.state, {
      key: `collection:${s.id}`,
      kind: "collection",
      showId: s.id,
      payload: {
        type: f.status,
        rate: f.rate,
        comment: f.comment,
        private: f.private,
      },
    });
  }
  s.remoteConflict = null;
  await this.persist();
  await this.sync();
  this.redraw();
};
AniLink.prototype.syncModal = function () {
  new Panel(this, "同步管理", (el, m) => {
    el.createEl("p", {
      text: `待推送 ${this.state.queue.length} 项 · 上次推送 ${time(this.state.lastPush)}`,
      cls: "al-muted",
    });
    button(
      el,
      "推送本地修改",
      () => this.background("Bangumi 推送", () => this.sync()),
      "mod-cta",
    );
    button(el, "检查远端收藏", () =>
      this.background("检查远端", async () => {
        await this.syncBangumi();
        m.close();
        this.syncModal();
      }),
    );
    if (!this.state.lastAccountSync)
      button(el, "首次导入收藏与进度", () =>
        this.background("导入收藏", async () => {
          this.importPolicy = "remote";
          try {
            await this.syncBangumi();
          } finally {
            this.importPolicy = null;
          }
          m.close();
          this.syncModal();
        }),
      );

    for (const s of this.state.shows.filter((s) => s.remoteConflict)) {
      const row = el.createDiv("al-result");
      row.createEl("strong", { text: s.title });
      row.createEl("p", {
        text: `本地：${C.STATUS[s.status]} · 远端：${C.STATUS[s.remoteConflict.status]}`,
        cls: "al-muted",
      });
      button(row, "保留本地", async () => {
        await this.resolveConflict(s, false);
        row.remove();
      });
      button(row, "采用远端", async () => {
        await this.resolveConflict(s, true);
        row.remove();
      });
    }
    button(el, "查看日志", () => {
      m.close();
      this.logsModal();
    });
  }).open();
};
AniLink.prototype.preferencesModal = function () {
  new Panel(this, "偏好设置", (el, m) => {
    const s = this.state.settings,
      inputs = {};
    if (this.state.schedulePending)
      el.createEl("p", {
        text: "下载调度：配置已保存，自动启动未安装",
        cls: "al-muted",
      });
    const choices = (key, label, defaultValue, options) =>
      (inputs[key] = select(
        el,
        label,
        String(s[key] ?? defaultValue),
        options,
      ));
    choices("autoRefresh", "自动刷新下载与重试推送", true, {
      true: "开启",
      false: "关闭",
    });
    inputs.pollSeconds = field(
      el,
      "下载状态刷新（秒）",
      s.pollSeconds || 60,
      "number",
    );
    inputs.metadataHours = field(
      el,
      "分集资料更新（小时，仅想看／在看）",
      s.metadataHours || 6,
      "number",
    );
    choices("cleanupAfterWatch", "标记看到后清理文件", true, {
      true: "自动清理",
      false: "保留文件",
    });
    choices("downloadNotifications", "下载完成通知", true, {
      true: "显示",
      false: "静默",
    });
    choices("shelfSort", "默认排序", "ready", {
      ready: "待看优先 · 最近下载",
      title: "番剧名称",
      progress: "观看进度",
      added: "最近加入",
    });
    choices("shelfColumns", "书架列数", "auto", {
      auto: "随面板宽度自动切换",
      1: "始终单列",
      2: "双列（空间足够时）",
    });
    choices("cardDensity", "卡片大小", "comfortable", {
      comfortable: "标准",
      compact: "紧凑",
    });
    choices("showOriginalName", "显示原文标题", true, {
      true: "显示",
      false: "隐藏",
    });
    choices("downloadMode", "下载器运行方式（配置）", "off", {
      cycle: "登录启动 · 完成后退出 · 定时唤醒",
      continuous: "登录启动 · 持续订阅",
      off: "不自动启动",
    });
    inputs.wakeMinutes = field(
      el,
      "下载器唤醒间隔（分钟）",
      s.wakeMinutes || 30,
      "number",
    );
    inputs.idleMinutes = field(
      el,
      "完成后等待退出（分钟）",
      s.idleMinutes || 3,
      "number",
    );
    inputs.rssMinutes = field(
      el,
      "RSS 检查间隔（分钟）",
      s.rssMinutes || 15,
      "number",
    );
    button(
      el,
      "保存",
      () =>
        this.run(async () => {
          for (const [k, input] of Object.entries(inputs)) {
            const value = input.value;
            s[k] = ["true", "false"].includes(value) ? value === "true" : value;
          }
          for (const [k, min, max, def] of [
            ["pollSeconds", 30, 3600, 60],
            ["metadataHours", 1, 168, 6],
            ["wakeMinutes", 5, 1440, 30],
            ["idleMinutes", 1, 120, 3],
            ["rssMinutes", 5, 1440, 15],
          ])
            s[k] = Math.min(max, Math.max(min, Number(s[k]) || def));
          await this.persist();
          await this.configureDownloadSchedule();
          try {
            await this.qb().call("app/setPreferences", {
              json: JSON.stringify({ rss_refresh_interval: s.rssMinutes }),
            });
          } catch (e) {
            C.record(this.state, "RSS 间隔未应用：" + e.message);
          }
          m.close();
          this.redraw();
        }),
      "mod-cta",
    );
    button(el, "追番后端", () => this.backendModal());
  }).open();
};
const controlRefresh = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  const beforeReady = new Set(
    this.state.shows.flatMap((s) =>
      readyEpisodes(s).flatMap((e) =>
        e.files.map((f) => f.hash + ":" + f.index),
      ),
    ),
  );
  await controlRefresh.call(this, manual);
  for (const s of this.state.shows) {
    for (const e of s.episodes)
      for (const f of e.files || []) {
        if (f.progress !== 1) continue;
        try {
          await fs.access(f.path);
          f.localExists = true;
          if (!f.completedAt) f.completedAt = Date.now();
        } catch {
          f.localExists = false;
        }
      }
    if (s.ruleError)
      try {
        await this.updateSubscriptionRule(s, s.subscription);
        s.ruleError = "";
      } catch {}
  }
  if (this.state.settings.downloadNotifications !== false)
    for (const s of this.state.shows) {
      const fresh = readyEpisodes(s).filter((e) =>
        e.files.some(
          (f) =>
            f.progress === 1 &&
            f.localExists === true &&
            !beforeReady.has(f.hash + ":" + f.index),
        ),
      );
      s.notifiedDownloads ||= [];
      const unseen = fresh.filter(
        (f) => !s.notifiedDownloads.includes(String(f.id)),
      );
      if (unseen.length) new Notice(`${s.title}：${unseen.length} 集已下载`);
      s.notifiedDownloads = [
        ...new Set([...s.notifiedDownloads, ...fresh.map((f) => String(f.id))]),
      ].slice(-1000);
    }
  await this.persist();
  this.redraw();
};
const removeLocal = AniLink.prototype.removeShow;
AniLink.prototype.removeShow = function (s) {
  const confirm = this.confirm;
  this.confirm = (title, text, fn) =>
    confirm.call(this, title, text, async () => {
      this.state.hiddenShows = [
        ...new Set([...(this.state.hiddenShows || []), s.id]),
      ];
      await fn();
    });
  try {
    return removeLocal.call(this, s);
  } finally {
    this.confirm = confirm;
  }
};
const cardControl = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (cards) {
  const original = this.p.state.shows,
    mode = this.sortMode || this.p.state.settings.shelfSort || "ready";
  const compare = (a, b) =>
    mode === "title"
      ? a.title.localeCompare(b.title, "zh-CN")
      : mode === "progress"
        ? b.episodes.filter((e) => e.watched).length -
          a.episodes.filter((e) => e.watched).length
        : mode === "added"
          ? (b.addedAt || b.id) - (a.addedAt || a.id)
          : newestReady(b) - newestReady(a) ||
            a.title.localeCompare(b.title, "zh-CN");
  this.p.state.shows = [...original].sort(compare);
  try {
    cardControl.call(this, cards);
  } finally {
    this.p.state.shows = original;
  }
  for (const card of cards.querySelectorAll(".al-card")) {
    const s = original.find((s) => s.id === Number(card.dataset.showId));
    if (!s) continue;
    const badge = card.querySelector(".al-unwatched-badge");
    if (badge) badge.textContent = `${readyEpisodes(s).length} 集待看`;
  }
};
const controlRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  controlRender.call(this);
  const root = this.contentEl,
    s = this.p.state.settings;
  root.dataset.columns = s.shelfColumns || "auto";
  root.dataset.density = s.cardDensity || "comfortable";
  root.classList.toggle("al-hide-original", s.showOriginalName === false);
  root.querySelector(".al-services")?.remove();
  const shelf = root.querySelector(".al-shelf");
  if (shelf) {
    const tools = shelf.createDiv("al-shelf-tools");
    shelf.insertBefore(tools, shelf.firstChild);
    const input = shelf.querySelector(".al-search");
    if (input) tools.appendChild(input);
    const sort = tools.createEl("select", {
      attr: { "aria-label": "书架排序" },
    });
    for (const [k, v] of Object.entries({
      ready: "最近更新",
      title: "名称",
      progress: "进度",
      added: "最近加入",
    }))
      sort.createEl("option", { value: k, text: v });
    sort.value = this.sortMode || s.shelfSort || "ready";
    sort.onchange = () => {
      this.sortMode = sort.value;
      this.renderCards(shelf.querySelector(".al-cards"));
    };
  }
  const footer = root.querySelector(".al-footer");
  if (footer) {
    footer.empty();
    const p = this.p,
      failed = p.state.queue.filter((j) => j.error).length;
    footer.createSpan({
      text:
        p.accountProgress || p.backgroundTasks?.size
          ? "后台更新中"
          : failed
            ? `${failed} 项推送失败`
            : p.state.queue.length
              ? `${p.state.queue.length} 项待同步`
              : "本地已保存",
      cls: failed ? "al-error" : "",
    });
    footer.createSpan({
      text: `Bangumi ${p.state.lastPush ? "已推送 " + time(p.state.lastPush) : "待推送"}`,
    });
    button(footer, "同步详情", () => p.syncModal(), "al-link");
  }
};
AniLink.prototype.configureDownloadSchedule = async function () {
  this.state.schedulePending = this.state.settings.downloadMode !== "off";
  await this.persist();
  if (this.state.schedulePending)
    new Notice("调度参数已保存；请按安装文档配置独立调度器");
};
