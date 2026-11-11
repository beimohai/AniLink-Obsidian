// Background work never owns the foreground interaction lock.
AniLink.prototype.background = function (key, fn) {
  this.backgroundTasks ??= new Map();
  if (this.backgroundTasks.has(key)) return this.backgroundTasks.get(key);
  const task = Promise.resolve()
    .then(fn)
    .catch(async (e) => {
      if (!this.disposed) {
        C.record(this.state, `${key}失败：${e.message}`);
        await this.persist();
      }
    })
    .finally(() => {
      this.backgroundTasks.delete(key);
      if (!this.disposed) this.redraw();
    });
  this.backgroundTasks.set(key, task);
  this.redraw();
  return task;
};
const oldRun = AniLink.prototype.run;
AniLink.prototype.run = function (fn, quiet = false) {
  if (quiet) return this.background("下载刷新", fn);
  return oldRun.call(this, fn, false);
};
AniLink.prototype.syncBangumi = function () {
  if (this.accountPromise) return this.accountPromise;
  this.accountPromise = this.pullAccount().finally(() => {
    this.accountPromise = null;
    this.accountProgress = "";
    if (!this.disposed) this.redraw();
  });
  return this.accountPromise;
};
AniLink.prototype.pullAccount = async function () {
  if (!this.state.settings.bgmToken) throw Error("请先填写 Bangumi Token");
  await this.sync();
  const bgm = this.bgm(),
    me = await bgm.call("/v0/me");
  const rows = await bgm.pages(
    `/v0/users/${encodeURIComponent(me.username)}/collections?subject_type=2`,
  );
  if (this.disposed) return;
  let done = 0;
  const errors = [];
  const pending = (id) => this.state.queue.some((j) => j.showId === id);
  const revision = (s) =>
    JSON.stringify([
      s.status,
      s.rate,
      s.comment,
      s.private,
      s.localRevision || 0,
    ]);
  for (let start = 0; start < rows.length; start += 4) {
    if (this.disposed) return;
    await Promise.all(
      rows.slice(start, start + 4).map(async (row) => {
        const id = Number(row.subject_id);
        if (pending(id)) return;
        let s = this.state.shows.find((s) => s.id === id);
        if (!s) {
          s = C.newShow({ ...row.subject, id }, []);
          this.state.shows.push(s);
        }
        const before = revision(s);
        let states;
        try {
          const due = !s.progressAt || Date.now() - s.progressAt > 5 * 60000;
          if (due) {
            const progress = await bgm.pages(
              `/v0/users/-/collections/${id}/episodes`,
            );
            states = new Map(progress.map((r) => [r.episode.id, r.type]));
          }
          if (!s.episodes.length) await this.updateEpisodes(s);
        } catch (e) {
          errors.push(`${s.title}：${e.message}`);
        }
        if (this.disposed || pending(id) || revision(s) !== before) return;
        Object.assign(s, {
          status: row.type,
          rate: row.rate || 0,
          comment: row.comment || "",
          private: !!row.private,
          lastSync: Date.now(),
          remoteMissing: false,
        });
        if (states) {
          for (const e of s.episodes)
            if (states.has(e.id)) e.watched = states.get(e.id) === 2;
          s.progressAt = Date.now();
        }
        done++;
      }),
    );
    this.accountProgress = `同步 ${Math.min(start + 4, rows.length)} / ${rows.length}`;
    this.redraw();
  }
  if (this.disposed) return;
  const ids = new Set(rows.map((r) => Number(r.subject_id)));
  for (const s of this.state.shows)
    if (!ids.has(s.id) && !pending(s.id) && s.lastSync) {
      s.status = 0;
      s.remoteMissing = true;
    }
  this.state.lastAccountSync = Date.now();
  this.state.accountSyncError = errors.length
    ? `${errors.length} 部分集暂未更新`
    : "";
  C.record(
    this.state,
    `Bangumi 已同步 ${done} 部${errors.length ? "；" + errors.length + " 部分集失败，保留原记录" : ""}`,
  );
  await this.persist();
  return done;
};
const baseTaskOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await baseTaskOnload.call(this);
  this.disposed = false;
  const transport = this.http.transport;
  this.http.transport = async (request) => {
    if (
      (request.method || "GET") !== "GET" &&
      !request.url.includes("/search/subjects")
    )
      return transport(request);
    let timer;
    try {
      return await Promise.race([
        transport(request),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(Error("读取超时（20 秒），可重试")),
            20000,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
};
AniLink.prototype.onunload = function () {
  this.disposed = true;
  for (const panel of this.panels || []) panel.close();
};
const beforePersist = AniLink.prototype.persist;
AniLink.prototype.persist = function () {
  return this.disposed ? Promise.resolve() : beforePersist.call(this);
};
