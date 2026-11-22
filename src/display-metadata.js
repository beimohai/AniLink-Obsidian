// Display data is kept separate from Bangumi identity, progress and media paths.
AniLink.prototype.displayMetadata = async function (show) {
  const settings = this.state.settings;
  const base = settings.bgmMirror && settings.bgmMirrorData !== false ? "https://api.bgm.lat" : "https://api.bgm.tv";
  const subject = await new C.Bangumi(this.http, "", base).call("/v0/subjects/" + show.id);
  show.displayMetadata = { title: subject.name_cn || subject.name, name: subject.name, cover: subject.images?.medium || subject.images?.common || "", source: "bangumi" };
};
AniLink.prototype.refreshDisplayMetadata = async function () {
  for (const show of this.state.shows) {
    try { await this.displayMetadata(show); }
    catch (error) { C.record(this.state, `${show.title} · 显示数据读取失败：${error.message}`); }
  }
  await this.persist();
  this.redraw();
};
const sourceEpisodes = AniLink.prototype.updateEpisodes;
AniLink.prototype.updateEpisodes = async function (show) {
  await sourceEpisodes.call(this, show);
  try { await this.displayMetadata(show); }
  catch (error) { C.record(this.state, `${show.title} · 显示数据读取失败：${error.message}`); }
  await this.persist();
};
function displayShow(show, settings) {
  const expected = "bangumi";
  const metadata = show.displayMetadata?.source === expected ? show.displayMetadata : {};
  const cover = metadata.cover || show.cover;
  const mirror = settings.bgmMirror && settings.bgmMirrorData !== false;
  const image = cover?.replace(/^https:\/\/lain\.(?:bgm\.tv|bgm\.lat|bangumi\.lat)\//, mirror ? "https://lain.bgm.lat/" : "https://lain.bgm.tv/");
  return { ...show, title: metadata.title || show.title, name: metadata.name || show.name, cover: image };
}
const sourceCards = Dashboard.prototype.renderCards;
Dashboard.prototype.renderCards = function (cards) {
  const original = this.p.state.shows;
  this.p.state.shows = original.filter((show) => !(this.p.state.hiddenShows || []).includes(show.id)).map((show) => displayShow(show, this.p.state.settings));
  try { sourceCards.call(this, cards); }
  finally { this.p.state.shows = original; }
};
const sourceDetail = Dashboard.prototype.renderDetail;
Dashboard.prototype.renderDetail = function (el, show) {
  sourceDetail.call(this, el, show);
  const metadata = displayShow(show, this.p.state.settings);
  const title = el.querySelector(".al-title-block h2");
  if (title) title.textContent = metadata.title;
};

AniLink.prototype.loadCoverImage = function (address) {
  const url = new URL(address);
  if (url.protocol !== "https:" || !["assets.fankuhub.cn", "img.fankuhub.com", "lain.bgm.tv", "lain.bgm.lat", "lain.bangumi.lat"].includes(url.hostname))
    return Promise.reject(Error("不支持的封面地址"));
  this.coverImageCache ||= new Map();
  if (this.coverImageCache.has(url.href)) return this.coverImageCache.get(url.href);
  if (!this.coverImageCleanupRegistered) {
    this.coverImageCleanupRegistered = true;
    this.register(() => {
      for (const result of this.coverImageCache.values()) result.then((cached) => URL.revokeObjectURL(cached), () => {});
      this.coverImageCache.clear();
    });
  }
  const request = (async () => {
    let timer;
    try {
      const response = Platform.isDesktop
        ? await Promise.race([
          desktop.remote.session.fromPartition("persist:anilink-images").fetch(url.href, { headers: { Referer: url.hostname.includes("fanku") ? "https://fankuhub.com/" : "https://bgm.tv/" } }),
          new Promise((_, reject) => { timer = window.setTimeout(() => reject(Error("封面读取超时")), 12000); }),
        ])
        : await requestUrl({ url: url.href, throw: false });
      const status = response.status;
      const type = Platform.isDesktop ? response.headers.get("content-type") : response.headers["content-type"];
      if (status !== 200 || !/^image\//i.test(type || "")) throw Error("封面响应无效 HTTP " + status);
      const bytes = Platform.isDesktop ? await response.arrayBuffer() : response.arrayBuffer;
      if (bytes.byteLength > 8 * 1024 * 1024 || !bytes.byteLength) throw Error("封面大小无效");
      if (this.disposed) throw Error("插件已退出");
      return URL.createObjectURL(new Blob([bytes], { type }));
    } finally { window.clearTimeout(timer); }
  })().catch((error) => { this.coverImageCache.delete(url.href); throw error; });
  this.coverImageCache.set(url.href, request);
  if (this.coverImageCache.size > 64) {
    const oldest = this.coverImageCache.keys().next().value;
    this.coverImageCache.get(oldest).then((cached) => URL.revokeObjectURL(cached), () => {});
    this.coverImageCache.delete(oldest);
  }
  return request;
};
