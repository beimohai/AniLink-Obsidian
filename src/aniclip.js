// AniClip data remains remote and carries CC BY-NC-SA 4.0 attribution.
AniLink.prototype.officialCuts = async function (show, episode, sourceCid) {
  if (!show.date) return [];
  const date = new Date(show.date);
  if (!Number.isFinite(date.getTime())) return [];
  const quarter = date.getUTCFullYear() + "." + (Math.floor(date.getUTCMonth() / 3) * 3 + 1);
  this.aniclipCache ||= new Map();
  try {
    if (!this.aniclipCache.has(quarter)) this.aniclipCache.set(quarter, await this.http.json("https://aniclip.xrzyun.eu.org/timeline/" + quarter + ".json"));
    const document = this.aniclipCache.get(quarter);
    const names = [show.title, show.name, ...(show.title === "异世界舅舅" ? ["奇幻世界舅舅"] : [])];
    const entry = Object.values(document.data?.[quarter] || {}).find((item) => item && names.includes(item.title));
    const seconds = (value) => String(value || "").split(":").reduce((total, part) => total * 60 + Number(part), 0);
    const cuts = [];
    for (const cut of entry?.list?.[String(episode)] || []) {
      if (cut.type !== "v_l" || !cut.t || !cut.source || !/b23\.tv|bilibili\.com/.test(cut.source)) continue;
      const sourceEpisode = cut.source.match(/ep(\d+)/)?.[1];
      if (!sourceEpisode) continue;
      const response = await this.http.json("https://api.bilibili.com/pgc/view/web/season?ep_id=" + sourceEpisode);
      const matched = response.result?.episodes?.find((item) => String(item.id) === sourceEpisode);
      if (Number(matched?.cid) !== Number(sourceCid)) continue;
      const duration = seconds(cut.t), at = seconds(cut.ss);
      if (duration > 0 && Number.isFinite(at)) cuts.push({ at, duration, source: cut.source, attribution: "AniClip / 汇总酱 · CC BY-NC-SA 4.0" });
    }
    return cuts;
  } catch (error) {
    C.record(this.state, "删减时间数据读取失败：" + error.message);
    return [];
  }
};
