AniLink.prototype.inspectRemoteShow = async function (s) {
  if (!this.state.settings.bgmToken) throw Error("请先填写 Bangumi Token");
  if (this.state.queue.some((j) => j.showId === s.id))
    throw Error("此番剧还有待推送修改，请先推送");
  const revision = s.localRevision || 0,
    bgm = this.bgm(),
    me = await bgm.call("/v0/me");
  const [collection, rows] = await Promise.all([
    bgm.call(
      `/v0/users/${encodeURIComponent(me.username)}/collections/${s.id}`,
    ),
    bgm.pages(`/v0/users/-/collections/${s.id}/episodes`),
  ]);
  if (
    this.disposed ||
    revision !== (s.localRevision || 0) ||
    this.state.queue.some((j) => j.showId === s.id)
  )
    throw Error("读取期间本地记录已变化，请重新检查");
  s.remoteConflict = {
    status: collection.type,
    rate: collection.rate || 0,
    comment: collection.comment || "",
    private: !!collection.private,
    episodeStates: Object.fromEntries(
      rows.map((r) => [r.episode.id, r.type === 2]),
    ),
  };
  await this.persist();
  return s.remoteConflict;
};
const resolveWithEpisodes = AniLink.prototype.resolveConflict;
AniLink.prototype.resolveConflict = async function (s, remote) {
  const states = s.remoteConflict?.episodeStates;
  if (remote && states) {
    for (const e of s.episodes)
      if (Object.hasOwn(states, e.id)) e.watched = states[e.id];
  }
  if (!remote && states)
    for (const e of s.episodes)
      if (Object.hasOwn(states, e.id))
        C.queueJob(this.state, {
          key: `episode:${e.id}`,
          kind: "episode",
          showId: s.id,
          episodeId: e.id,
          payload: { type: e.watched ? 2 : 0 },
        });
  if (s.remoteConflict) delete s.remoteConflict.episodeStates;
  return resolveWithEpisodes.call(this, s, remote);
};
AniLink.prototype.remoteShowModal = function (s) {
  new Panel(this, "核对远端 · " + s.title, (el, m) => {
    const result = el.createDiv();
    button(
      el,
      "读取此番剧状态与进度",
      () =>
        this.background("核对此番剧", async () => {
          const remote = await this.inspectRemoteShow(s);
          result.empty();
          result.createEl("p", {
            text: `本地 ${C.STATUS[s.status]} · 已看 ${s.episodes.filter((e) => e.watched).length} 集；远端 ${C.STATUS[remote.status]} · 已看 ${Object.values(remote.episodeStates).filter(Boolean).length} 集`,
          });
          button(result, "保留本地并推送", () =>
            this.run(async () => {
              await this.resolveConflict(s, false);
              m.close();
            }),
          );
          button(result, "采用远端", () =>
            this.run(async () => {
              await this.resolveConflict(s, true);
              m.close();
            }),
          );
        }),
      "mod-cta",
    );
  }).open();
};
const renderWorkflow = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  renderWorkflow.call(this, el, s);
  if (this.tab === "review")
    button(
      el.querySelector(".al-tab-body"),
      "核对此番剧远端进度",
      () => this.p.remoteShowModal(s),
      "al-link",
    );
  if (s.ruleError)
    el.querySelector(".al-tab-body")?.createEl("p", {
      text: "订阅暂停待重试：" + s.ruleError,
      cls: "al-error",
    });
};
AniLink.prototype.markThrough = async function (s, target) {
  s.localRevision = (s.localRevision || 0) + 1;
  const affected =
    target.type === 0
      ? s.episodes.filter((e) => e.type === 0 && e.sort <= target.sort)
      : [target];
  if (s.status === 0 || s.status === 1) {
    s.status = 3;
    C.queueJob(this.state, {
      key: `collection:${s.id}`,
      kind: "collection",
      showId: s.id,
      payload: { type: 3 },
    });
  }
  for (const e of affected) {
    if (e.watched) continue;
    e.watched = true;
    C.queueJob(this.state, {
      key: `episode:${e.id}`,
      kind: "episode",
      showId: s.id,
      episodeId: e.id,
      payload: { type: 2 },
    });
  }
  await this.persist();
  const cleanupMode = this.state.settings.cleanupMode ||
    (this.state.settings.cleanupAfterWatch === false ? "none" : "watched");
  if (cleanupMode === "current") await this.cleanupWatched(s, [target]);
  else if (cleanupMode === "watched") await this.cleanupWatched(s, affected);
  C.record(this.state, `${s.title}：已看到第 ${target.ep || target.sort} 集`);
  await this.persist();
  this.background("Bangumi 推送", () => this.sync());
};
AniLink.prototype.cleanupWatched = async function (s, episodes) {
  for (const episode of episodes.filter((item) => item.watched)) {
    for (const file of [...(episode.files || [])]) {
      if (file.progress !== 1 || (file.hash && !file.localOnly)) continue;
      if (file.remotePath) await this.deleteRemoteMedia(file);
      const xml = file.path.slice(0, file.path.lastIndexOf(".")) + ".xml";
      const danmakuPaths = new Set([xml, ...(episode.danmaku?.ownedPaths || [])]);
      for (const target of [...danmakuPaths, file.path]) {
        try { await fs.unlink(target); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
      episode.files = episode.files.filter((item) => item !== file);
      await this.persist();
    }
    // Remove the binding only after every local/remote file belonging to this
    // episode has had its XML companions cleaned up.
    if (!(episode.files || []).some((file) => file.progress === 1))
      delete episode.danmaku;
  }
  const files = allFiles(s),
    hashes = new Set(
      episodes
        .flatMap((e) => e.files || [])
        .filter((f) => f.progress === 1 && f.hash && !f.localOnly)
        .map((f) => f.hash),
    );
  for (const hash of hashes) {
    const group = files.filter((f) => f.hash === hash);
    if (
      group.some(
        (f) =>
          f.progress !== 1 ||
          !s.episodes.some((e) => e.watched && e.id === f.episodeId),
      )
    ) {
      C.record(this.state, "已保留含未看或未识别分集的下载任务");
      continue;
    }
    if (s.subscription.backendId) {
      C.record(
        this.state,
        "已保留外部后端管理的文件，请在后端设置清理与防止补下载",
      );
      continue;
    }
    try {
      const actual = await this.qb().files(hash);
      if (
        !Array.isArray(actual) ||
        !actual.length ||
        actual.some(
          (f) =>
            C.VIDEO.test(f.name) &&
            (!group.some((g) => g.index === f.index) || f.progress !== 1),
        )
      ) {
        C.record(this.state, "下载任务包含尚未核对的视频，已保留文件");
        continue;
      }
      for (const f of group)
        if (f.taskTitle && !s.blockedTitles.includes(f.taskTitle))
          s.blockedTitles.push(f.taskTitle);
      await this.persist();
      if (s.subscription.feed) await this.qb().setRule(s);
      if (this.state.settings.deleteTorrentWithFiles !== false) {
        await this.qb().delete(hash);
      } else {
        await this.qb().call("torrents/stop", { hashes: hash });
        for (const media of group) {
          try { await fs.unlink(media.path); }
          catch (error) { if (error.code !== "ENOENT") throw error; }
        }
      }
      for (const e of s.episodes) {
        for (const f of (e.files || []).filter((f) => f.hash === hash)) {
          const xml = f.path?.replace(/\.[^.]+$/, ".xml");
          if (xml) {
            await fs.unlink(xml).catch(() => {});
            if (e.danmaku?.ownedPaths) e.danmaku.ownedPaths = e.danmaku.ownedPaths.filter(
              (p) => p !== xml,
            );
          }
        }
        e.files = (e.files || []).filter((f) => f.hash !== hash);
      }
    } catch (e) {
      C.record(this.state, "进度已保存，清理失败：" + e.message);
    }
  }
};
AniLink.prototype.downloadMappedDanmaku = async function (
  s,
  { force = false } = {},
) {
  let written = 0,
    skipped = 0;
  const errors = [];
  for (const e of s.episodes.filter((e) => e.danmaku?.cid)) {
    if (!force && Date.now() - (e.danmaku.retryAt || 0) < 3600000) continue;
    for (const f of (e.files || []).filter(
      (f) => f.progress === 1 && f.localExists !== false,
    )) {
      const target = f.path.replace(/\.[^.]+$/, ".xml");
      try {
        await fs.access(f.path);
        try {
          await fs.access(target);
          skipped++;
          continue;
        } catch  { /* Best-effort optional operation; retain the existing state on failure. */ }
        const r = await this.http.request(
          `https://comment.bilibili.com/${e.danmaku.cid}.xml`,
        );
        const xml = new DOMParser().parseFromString(r.text, "text/xml");
        if (
          xml.querySelector("parsererror") ||
          xml.documentElement.tagName !== "i"
        )
          throw Error("弹幕响应格式无效");
        for (const d of xml.querySelectorAll("d")) {
          const attrs = (d.getAttribute("p") || "").split(","),
            at = Number(attrs[0]) + Number(e.danmaku.offset || 0);
          if (!Number.isFinite(at)) throw Error("弹幕时间无效");
          if (at < 0) d.remove();
          else {
            attrs[0] = String(at);
            d.setAttribute("p", attrs.join(","));
          }
        }
        await fs.writeFile(target, new XMLSerializer().serializeToString(xml), {
          flag: "wx",
          encoding: "utf8",
        });
        e.danmaku.ownedPaths = [
          ...new Set([...(e.danmaku.ownedPaths || []), target]),
        ];
        e.danmaku.saved = true;
        e.danmaku.error = "";
        written++;
      } catch (err) {
        e.danmaku.error = err.message;
        e.danmaku.retryAt = Date.now();
        errors.push(`第 ${e.ep || e.sort} 集：${err.message}`);
      }
    }
  }
  await this.persist();
  return { written, skipped, errors };
};
AniLink.prototype.danmakuModal = function (s) {
  new Panel(this, "批量关联 B站弹幕", (el, m) => {
    const source = field(el, "B站整季／BV 分P链接", s.biliSource || "");
    const suggestions = el.createDiv("al-bili-suggestions");
    button(el, "搜索弹幕源", () =>
      this.run(async () => {
        suggestions.empty();
        const response = await this.http.json(
          "https://api.bilibili.com/x/web-interface/search/type?search_type=media_bangumi&keyword=" +
            encodeURIComponent(s.title),
          "GET",
          undefined,
          { Referer: "https://www.bilibili.com/" },
        );
        if (response.code !== 0) throw Error("B站搜索暂不可用，请粘贴来源链接");
        const candidates = response.data?.result || [];
        if (!candidates.length)
          suggestions.createEl("p", { text: "暂无匹配来源" });
        for (const item of candidates) {
          if (
            !Number.isInteger(Number(item.season_id)) ||
            !Number(item.season_id)
          )
            continue;
          const title = new DOMParser().parseFromString(
            item.title || "",
            "text/html",
          ).body.textContent;
          button(suggestions, title || "选择来源", () => {
            source.value =
              "https://www.bilibili.com/bangumi/play/ss" +
              Number(item.season_id);
            new Notice("来源已填入，请核对分集");
          });
        }
      }),
    );
    const numbering = select(el, "来源集数编号", s.biliNumbering || "local", {
      local: "本季编号（1、2、3…）",
      absolute: "累计编号",
    });
    const rows = el.createDiv("al-danmaku-rows");
    let inputs = [],
      candidates = [];
    const draw = () => {
      rows.empty();
      inputs = s.episodes.map((e) => {
        const row = rows.createDiv("al-danmaku-row"),
          n = numbering.value === "local" ? e.ep || e.sort : e.sort;
        row.createSpan({
          text: e.type === 0 ? `第 ${e.ep || e.sort} 集` : "SP " + e.sort,
        });
        const match =
          e.type === 0 ? candidates.find((c) => c.sort === n) : null;
        const cid = field(row, "CID", e.danmaku?.cid || match?.cid || ""),
          offset = field(row, "偏移秒", e.danmaku?.offset || 0, "number");
        if (match) cid.title = match.title;
        return { e, cid, offset };
      });
    };
    draw();
    numbering.onchange = draw;
    const result = el.createDiv();
    button(el, "解析来源", () =>
      this.run(async () => {
        candidates = await this.biliSource(source.value);
        draw();
        result.setText(`已读取 ${candidates.length} 集，请核对对应关系。`);
      }),
    );
    const save = async (write) => {
      for (const { cid, offset } of inputs) {
        if (cid.value && !/^[1-9]\d*$/.test(cid.value))
          throw Error("CID 必须为正整数");
        if (!Number.isFinite(Number(offset.value)))
          throw Error("偏移必须为数字");
      }
      s.biliSource = source.value.trim();
      s.biliNumbering = numbering.value;
      for (const { e, cid, offset } of inputs) {
        if (cid.value)
          e.danmaku = {
            ...e.danmaku,
            cid: cid.value,
            offset: Number(offset.value),
          };
        else delete e.danmaku;
      }
      await this.persist();
      if (write) {
        const r = await this.downloadMappedDanmaku(s, { force: true });
        if (r.errors.length) {
          result.setText(r.errors.join("；"));
          new Notice("部分弹幕下载失败，映射已保留");
          return;
        }
        new Notice(`已写入 ${r.written} 个 XML，保留已有 ${r.skipped} 个`);
      }
      m.close();
    };
    button(el, "保存映射", () => this.run(() => save(false)));
    button(el, "保存并下载弹幕", () => this.run(() => save(true)), "mod-cta");
  }).open();
};
const refreshMapped = AniLink.prototype.refresh;
AniLink.prototype.refresh = async function (manual) {
  await refreshMapped.call(this, manual);
  for (const s of this.state.shows.filter((s) =>
    s.episodes.some((e) => e.danmaku?.cid),
  )) {
    const r = await this.downloadMappedDanmaku(s);
    for (const error of r.errors) C.record(this.state, error);
  }
  await this.persist();
};
AniLink.prototype.checkConnections = async function () {
  for (const [key, fn] of [
    ["bgm", () => this.bgm().call("/v0/me")],
    ["qb", () => this.qb().call("app/version")],
    ["player", () => fs.access(this.state.settings.playerExe)],
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
              : "播放器路径可用",
      };
    } catch (e) {
      this.health[key] = { ok: false, text: e.message };
    }
  }
  return this.health;
};
