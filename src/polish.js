AniLink.prototype.openFanku = async function (s) {
  let url;
  try {
    url = await this.resolveFanku(s);
  } catch {
    url =
      "https://fankuhub.com/anime?q=" +
      encodeURIComponent(s.title || s.name_cn || s.name);
  }
  await shell.openExternal(url);
};
const priorRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  const shelf = this.contentEl.querySelector(".al-cards"),
    body = this.contentEl.querySelector(".al-tab-body");
  const left = shelf?.scrollTop || 0,
    right = body?.scrollTop || 0;
  priorRender.call(this);
  const a = this.contentEl.querySelector(".al-cards"),
    b = this.contentEl.querySelector(".al-tab-body");
  if (a) a.scrollTop = left;
  if (b) b.scrollTop = right;
};
const priorCards = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (cards) {
  priorCards.call(this, cards);
  for (const card of cards.querySelectorAll(".al-card")) {
    const id = Number(card.dataset.showId),
      s = this.p.state.shows.find((s) => s.id === id);
    if (!s) continue;
    const meta = card.querySelector("div:last-child");
    if (!meta) continue;
    meta.createEl("p", { text: s.name || "", cls: "al-original-name" });
    const eps = s.episodes.filter((e) => e.type === 0),
      count = eps.filter((e) => e.watched).length,
      total = s.total || eps.length;
    const progress = meta.createEl("progress", {
      attr: { max: Math.max(1, total), value: count },
    });
    progress.setAttribute("aria-label", `已看 ${count} / ${total} 集`);
    const ready = eps.filter(
      (e) =>
        !e.watched &&
        e.files?.some((f) => f.progress === 1 && f.localExists !== false),
    ).length;
    if (ready)
      card.createSpan({ text: String(ready), cls: "al-unwatched-badge" });
  }
};
