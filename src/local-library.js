AniLink.prototype.libraryRoots = function () {
  const settings = this.state.settings;
  const configured = [C.isLocalPath(settings.libraryRoot) ? settings.libraryRoot : settings.downloadRoot,
    ...(settings.multiLibraryEnabled && Array.isArray(settings.extraLibraryRoots) ? settings.extraLibraryRoots : [])];
  const roots = new Map();
  for (const value of configured) {
    if (typeof value !== "string" || !value.trim() || !C.isLocalPath(value.trim())) continue;
    const resolved = path.resolve(value.trim());
    const key = process.platform === "win32" ? resolved.toLowerCase() : resolved;
    roots.set(key, resolved);
  }
  return [...roots.values()];
};
AniLink.prototype.libraryDirectories = async function (show) {
  const roots = this.libraryRoots();
  const directories = new Set();
  if (roots.length) directories.add(await this.showFolder(show, roots[0]));
  for (const root of roots) {
    directories.add(path.join(root, C.folderName(show.title, show.id)));
    directories.add(path.join(root, show.title.replace(/[<>:"/\\|?*]/g, "_")));
  }
  return [...directories].filter((directory) => path.isAbsolute(directory));
};
const libraryFolder = AniLink.prototype.showFolder;
AniLink.prototype.showFolder = function (show, root) {
  if (C.isLocalPath(show.localLibraryPath) && show.status > 0) return Promise.resolve(show.localLibraryPath);
  return libraryFolder.call(this, show, root);
};
AniLink.prototype.attachLocalLibrary = async function (subject, directory, status) {
  if (!this.state.settings.bgmToken) throw Error("请先配置 Bangumi 访问令牌");
  const allowed = this.libraryRoots().some((root) => {
    const relative = path.relative(root, path.resolve(directory));
    return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
  });
  if (!allowed || !(await fs.stat(directory)).isDirectory()) throw Error("请选择已启用番剧库内的番剧目录");
  const me = await this.bgm().call("/v0/me");
  let remote;
  try { remote = await this.bgm().call(`/v0/users/${encodeURIComponent(me.username)}/collections/${subject.id}`); }
  catch (error) { if (!/404/.test(error.message)) throw error; }
  if (!remote?.type) {
    if (![1,2,3,4,5].includes(status)) throw Error("请选择收藏状态");
    await this.bgm().call(`/v0/users/-/collections/${subject.id}`, "POST", { type: status });
  }
  let show = this.state.shows.find((item) => item.id === Number(subject.id));
  if (!show) {
    show = C.newShow(subject);
    show.status = remote?.type || status;
    if (remote) Object.assign(show, { rate: remote.rate || 0, comment: remote.comment || "", private: !!remote.private });
    await this.updateEpisodes(show);
    this.state.shows.push(show);
  }
  show.status = remote?.type || status;
  show.localLibraryPath = directory;
  this.state.hiddenShows = (this.state.hiddenShows || []).filter((id) => id !== show.id);
  await this.scanLocalVideos();
  await this.persist();
  this.redraw();
  new Notice("已收藏并关联本地目录");
};
AniLink.prototype.localLibraryModal = function () {
  new Panel(this, "手动关联本地番剧", (el, modal) => {
    const query = field(el, "Bangumi 条目 ID 或番剧名称");
    const directory = field(el, "本地番剧目录");
    button(el, "选择目录", () => this.run(async () => {
      const result = await require("electron").remote.dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (!result.canceled) directory.value = result.filePaths[0] || "";
    }));
    const status = select(el, "未收藏时加入", "3", { 1: "想看", 3: "在看", 2: "看过" });
    const results = el.createDiv("al-results");
    button(el, "搜索条目", () => this.run(async () => {
      const value = query.value.trim();
      if (!value) throw Error("请输入 Bangumi 条目 ID 或名称");
      const response = /^\d+$/.test(value) ? { data: [await this.bgm().call("/v0/subjects/" + value)] } : await this.bgm().search(value);
      results.empty();
      for (const subject of response.data || []) {
        if (subject.type !== 2) continue;
        new Setting(results).setName(subject.name_cn || subject.name).setDesc(`${subject.id} · ${subject.date || "日期未定"}`)
          .addButton((control) => control.setButtonText("关联并收藏").onClick(() => this.run(async () => {
            await this.attachLocalLibrary(subject, directory.value.trim(), Number(status.value));
            modal.close();
          })));
      }
    }));
  }).open();
};
