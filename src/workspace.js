const v02Onload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  await v02Onload.call(this);
  this.state.shows = this.state.shows.filter((s) => !s.demo && s.id > 0);
  this.state.queue = this.state.queue.filter((j) => j.showId > 0);
  for (const s of this.state.shows) {
    const normal = s.episodes.filter((e) => e.type === 0);
    if (
      normal.length &&
      s.total === s.episodes.length &&
      s.episodes.some((e) => e.type !== 0)
    )
      s.total = normal.length;
  }
  if (
    !this.state.settings.downloadRoot ||
    /Application[\\/]qBittorrent[\\/]downloads/i.test(
      this.state.settings.downloadRoot,
    )
  )
    this.state.settings.downloadRoot = path.join(require("os").homedir(), "Videos", "Anime");
  this.app.workspace.onLayoutReady(() =>
    this.run(async () => {
      if (this.state.settings.bgmToken)
        try {
          if (!this.state.lastAccountSync && !this.state.shows.length) {
            this.importPolicy = "remote";
            try {
              await this.syncBangumi();
            } finally {
              this.importPolicy = null;
            }
          } else await this.sync();
        } catch (e) {
          this.state.accountSyncError = e.message;
          C.record(this.state, "启动同步失败，保留本地缓存：" + e.message);
        }
      await this.refresh(false);
    }, true),
  );
};
AniLink.prototype.fankuCandidates = async function (subject) {
  const q = (subject.name || subject.title || subject.name_cn)
    .replace(/第[一二三四五六七八九十0-9]+季|Season\s*\d+/gi, "")
    .trim();
  const doc = await this.mikanDocument(
    "https://fankuhub.com/anime?q=" + encodeURIComponent(q),
  );
  return [
    ...new Set(
      [...doc.querySelectorAll('a[href^="/anime/"]')]
        .sort(
          (a, b) =>
            Number(b.textContent.includes(q)) -
            Number(a.textContent.includes(q)),
        )
        .map((a) => a.getAttribute("href"))
        .filter((h) => /^\/anime\/[a-z0-9]+$/i.test(h)),
    ),
  ];
};
AniLink.prototype.resolveFanku = async function (subject) {
  if (subject.fankuUrl) return subject.fankuUrl;
  const candidates = await this.fankuCandidates(subject);
  for (const candidate of candidates.slice(0, 12)) {
    const doc = await this.mikanDocument("https://fankuhub.com" + candidate);
    let detail = null;
    let flight = "";
    for (const script of doc.querySelectorAll("script")) {
      const text = script.textContent;
      const start = text.indexOf("self.__next_f.push(");
      if (start < 0) continue;
      try {
        const data = JSON.parse(text.slice(start + 19, -1));
        if (typeof data[1] === "string") flight += data[1];
      } catch {}
    }
    const walk = (o) => {
      if (!o || typeof o !== "object") return;
      if (o.detail?.id === candidate.split("/").at(-1)) detail = o.detail;
      for (const v of Object.values(o)) if (typeof v === "object") walk(v);
    };
    for (const line of flight.split("\n"))
      try {
        walk(JSON.parse(line.slice(line.indexOf(":") + 1)));
      } catch {}
    const norm = (v) =>
      String(v || "")
        .normalize("NFKC")
        .replace(/[\s\p{P}\p{S}]/gu, "")
        .toLowerCase();
    // Fanku's public detail intentionally omits upstream subject IDs. Require both
    // Japanese/Chinese names and premiere date instead of guessing from one title.
    const exact =
      detail &&
      norm(detail.titleJa) === norm(subject.name) &&
      subject.date &&
      String(detail.airDate).slice(0, 10) === String(subject.date).slice(0, 10);
    if (
      exact ||
      [...doc.querySelectorAll("a[href]")].some((a) => {
        try {
          const u = new URL(a.getAttribute("href"));
          return (
            ["bgm.tv", "bangumi.tv", "chii.in"].includes(u.hostname) &&
            u.pathname.replace(/\/$/, "") === `/subject/${subject.id}`
          );
        } catch {
          return false;
        }
      })
    ) {
      subject.fankuUrl = "https://fankuhub.com" + candidate;
      const saved = this.state.shows.find((s) => s.id === Number(subject.id));
      if (saved) {
        saved.fankuUrl = subject.fankuUrl;
        await this.persist();
      }
      return subject.fankuUrl;
    }
  }
  throw Error(
    "番库暂未找到可核对 Bangumi ID 的条目，已打开站内检索，可直接选择结果。",
  );
};
AniLink.prototype.webPanel = function (title, url) {
  new Panel(this, title, (el, m) => {
    const bar = el.createDiv("al-actions");
    link(bar, "在浏览器打开", url);
    button(bar, "重新载入", () => guest.reload?.());
    const guest = el.createEl("webview", {
      attr: {
        src: url,
        partition: "persist:anilink-services",
        allowpopups: "true",
      },
    });
    guest.addClass("al-webview");
    guest.addEventListener("did-fail-load", (e) => {
      if (e.errorCode !== -3) new Notice("页面加载失败，可点击在浏览器打开");
    });
    m.modalEl.addClass("al-web-modal");
  }).open();
};
AniLink.prototype.openFanku = async function (s) {
  let url;
  try {
    url = await this.resolveFanku(s);
  } catch (e) {
    url =
      "https://fankuhub.com/anime?q=" +
      encodeURIComponent(s.title || s.name_cn || s.name);
    new Notice(e.message);
  }
  this.webPanel("番库 · " + (s.title || s.name_cn || s.name), url);
};
AniLink.prototype.fankuModal = function (s) {
  return this.run(() => this.openFanku(s));
};
AniLink.prototype.readFeed = async function (url) {
  const r = await this.http.request(url);
  const doc = new DOMParser().parseFromString(r.text, "application/xml");
  if (doc.querySelector("parsererror")) throw Error("RSS 数据格式错误");
  return [...doc.querySelectorAll("item")].map((item) => ({
    title: item.querySelector("title")?.textContent || "",
    date: item.querySelector("pubDate")?.textContent || "",
    url: item.querySelector("enclosure")?.getAttribute("url") || "",
    link: item.querySelector("link")?.textContent || "",
  }));
};
AniLink.prototype.downloadRelease = async function (s, article) {
  if (!article.url) throw Error("资源没有 torrent 地址");
  const url = new URL(article.url);
  if (!["https:", "http:"].includes(url.protocol)) throw Error("无效种子地址");
  const ep = C.resolveEpisode(s, article.title);
  if (!ep) throw Error("无法确定集数，已阻止下载");
  const qb = this.qb(),
    tasks = await qb.torrents(s);
  if (
    tasks.some(
      (t) =>
        t.name === article.title || C.resolveEpisode(s, t.name)?.id === ep.id,
    )
  )
    throw Error("此资源已在下载队列");
  const torrent = await this.http.request(url.href);
  const bytes = Buffer.from(torrent.arrayBuffer);
  if (!bytes.length || bytes[0] !== 100) throw Error("种子文件响应无效");
  const folder = path.join(
    this.state.settings.downloadRoot || path.join(require("os").homedir(), "Videos", "Anime"),
    s.title.replace(/[<>:"/\\|?*]/g, "_"),
  );
  await fs.mkdir(folder, { recursive: true });
  const cats = await qb.call("torrents/categories");
  if (!cats[C.feedPath(s)])
    await qb.call("torrents/createCategory", {
      category: C.feedPath(s),
      savePath: folder,
    });
  const boundary = "AniLink" + Date.now();
  const chunks = [];
  for (const [k, v] of Object.entries({
    savepath: folder,
    category: C.feedPath(s),
    paused: "false",
    stopped: "false",
  }))
    chunks.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
    );
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="torrents"; filename="episode.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );
  const payload = Buffer.concat(chunks);
  if (!qb.cookie) await qb.login();
  const response = await this.http.request(
    C.baseUrl(this.state.settings.qbUrl) + "/api/v2/torrents/add",
    "POST",
    payload.buffer.slice(
      payload.byteOffset,
      payload.byteOffset + payload.byteLength,
    ),
    {
      "Content-Type": "multipart/form-data; boundary=" + boundary,
      Referer: C.baseUrl(this.state.settings.qbUrl),
      Cookie: qb.cookie,
    },
  );
  let accepted = response.text.trim() === "Ok.";
  try {
    const result = JSON.parse(response.text);
    accepted =
      Array.isArray(result.added_torrent_ids) &&
      result.added_torrent_ids.length > 0 &&
      result.failure_count === 0;
  } catch {}
  if (!accepted) throw Error("下载器拒绝种子：" + response.text.slice(0, 100));
  C.record(this.state, `${s.title}：已开始下载本季第 ${ep.ep || ep.sort} 集`);
  await this.persist();
  await this.refresh(false);
  return folder;
};
AniLink.prototype.downloadEpisode = async function (s, e) {
  if (!s.subscription.feed) {
    this.subscriptionModal(s);
    return;
  }
  const rows = (await this.readFeed(s.subscription.feed)).filter(
    (a) =>
      C.resolveEpisode(s, a.title)?.id === e.id &&
      C.previewMatch(a.title, s.subscription),
  );
  if (!rows.length)
    throw Error("选定版本暂无这一集，可在订阅中更换字幕组或版本");
  new Panel(this, `下载本季第 ${e.ep || e.sort} 集`, (el, m) => {
    el.createEl("p", { text: "保存到 " + this.state.settings.downloadRoot });
    for (const row of rows)
      button(el, row.title, () =>
        this.run(async () => {
          await this.downloadRelease(s, row);
          m.close();
        }),
      );
  }).open();
};

