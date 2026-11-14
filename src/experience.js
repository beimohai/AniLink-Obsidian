const fullDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, s) {
  fullDetail.call(this, el, s);
  if (this.tab !== "episodes") return;
  const p = this.p,
    body = el.querySelector(".al-tab-body");
  body.empty();
  const normal = s.episodes
    .filter((e) => e.type === 0)
    .sort((a, b) => a.sort - b.sort);
  const watched = normal.filter((e) => e.watched).length,
    ready = normal.filter(
      (e) =>
        !e.watched &&
        e.files?.some((f) => f.progress === 1 && f.localExists !== false),
    ).length;
  body.createEl("p", {
    text: `已看 ${watched} / ${s.total || normal.length || "待定"} 集 · ${ready} 集待看`,
    cls: "al-episode-summary",
  });
  if (normal.length && watched === normal.length && s.status !== 2)
    button(
      body,
      "本季已看完 · 标记完成",
      () => p.run(() => p.changeStatus(s, 2)),
      "mod-cta",
    );

  const grid = body.createDiv("al-episode-grid");
  const selected =
    s.episodes.find((e) => e.id === this.episodeFocus) ||
    normal.find(
      (e) =>
        !e.watched &&
        e.files?.some((f) => f.progress === 1 && f.localExists !== false),
    ) ||
    normal.find((e) => !e.watched) ||
    normal.at(-1);
  const special = s.episodes.filter((e) => e.type !== 0);
  let spGrid;
  if (special.length) {
    const details = body.createEl("details", { cls: "al-specials" });
    details.createEl("summary", { text: `特别篇（${special.length}）` });
    spGrid = details.createDiv("al-episode-grid");
  }
  for (const e of s.episodes) {
    const downloaded = e.files?.some(
        (f) => f.progress === 1 && f.localExists !== false,
      ),
      future = e.airdate && e.airdate > new Date().toLocaleDateString("sv-SE");
    const tile = button(
      e.type === 0 ? grid : spGrid,
      "",
      () => {
        this.episodeFocus = e.id;
        this.renderDetail(this.contentEl.querySelector(".al-detail"), s);
      },
      "al-episode-tile" +
        (future && !e.watched && !downloaded ? " is-future" : "") +
        (downloaded && !e.watched ? " is-ready" : "") +
        (e.watched ? " is-watched" : "") +
        (e.id === selected?.id ? " is-current" : ""),
    );
    tile.title = `${e.type === 0 ? "正篇" : "特别篇"} ${e.ep || e.sort} · ${e.title || "标题未公布"}`;
    tile.createEl("strong", {
      text: e.type === 0 ? String(e.ep || e.sort) : "SP " + e.sort,
    });
    tile.createSpan({
      text: e.watched
        ? "已看"
        : downloaded
          ? "待看"
          : e.files?.length
            ? e.files.every((f) => f.localExists === false)
              ? "文件缺失"
              : "下载中"
            : future
              ? "未播"
              : "未下载",
    });
  }
  if (!selected) {
    body.createEl("p", {
      text: s.metadataError
        ? "分集读取失败，将自动重试"
        : "分集尚未公布，稍后自动更新",
    });
    return;
  }
  const e = selected,
    focus = body.createDiv("al-episode-focus");
  focus.createEl("h3", {
    text: `${e.type === 0 ? "第 " + (e.ep || e.sort) + " 集" : "特别篇 " + e.sort} · ${e.title || "标题未公布"}`,
  });
  focus.createEl("p", {
    text: [e.airdate, e.watched ? "已看" : "未看"].filter(Boolean).join(" · "),
    cls: "al-muted",
  });
  const actions = focus.createDiv("al-actions"),
    files = (e.files || []).filter(
      (f) => f.progress === 1 && f.localExists !== false,
    ),
    future = e.airdate && e.airdate > new Date().toLocaleDateString("sv-SE");
  if (files.length)
    button(actions, "播放", () => p.pickFile(s, e, files), "mod-cta");
  else if (!future)
    button(
      actions,
      "下载本集",
      () => p.run(() => p.downloadEpisode(s, e)),
      "mod-cta",
    );
  const mark = button(
    actions,
    e.watched ? "已看到这里" : "看到这里",
    () => p.run(() => p.markThrough(s, e)),
  );
  mark.disabled =
    !!future ||
    e.watched;
  if (e.watched)
    button(actions, "设为未看", () => p.run(() => p.markWatched(s, e, false)));
  if (files.length) {
    button(actions, "打开文件位置", () =>
      shell.showItemInFolder(files[0].path),
    );
    button(actions, "删除文件", () => p.deleteEpisodeFiles(s, e));
  }
};
// Use stable subject IDs, not titles, for card metadata (different seasons can share titles).
const renderExperience = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  renderExperience.call(this);
  const refreshButton = [...this.contentEl.querySelectorAll("button")].find(
    (b) => b.textContent === "刷新",
  );
  if (refreshButton)
    refreshButton.onclick = () =>
      this.p.background("下载刷新", () => this.p.refresh(true));
  const syncButton = [...this.contentEl.querySelectorAll("button")].find(
    (b) => b.textContent === "同步 Bangumi",
  );
  if (syncButton) {
    syncButton.onclick = () =>
      this.p.background("Bangumi 同步", () => this.p.syncBangumi());
    syncButton.textContent = this.p.accountPromise ? "同步中…" : "同步 Bangumi";
    syncButton.disabled = !!this.p.accountPromise;
  }
};
