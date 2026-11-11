const DeviceModel = require("./sync-model");
const deviceOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  const crypto = require("crypto");
  const base = this.app.vault.adapter.getBasePath();
  const id = crypto
    .createHash("sha256")
    .update(base)
    .digest("hex")
    .slice(0, 24);
  const localFolder = path.join(
    process.env.LOCALAPPDATA || require("os").homedir(),
    "AniLink",
  );
  this.legacyDeviceFile = path.join(localFolder, `${id}.json`);
  this.deviceIdentityFile = path.join(localFolder, `${id}.device.json`);
  this.deviceFile = path.join(base, this.manifest.dir, "data.json");
  this.records = {};
  this.deviceBaseline = {};
  this.rawLoadData = this.loadData.bind(this);
  this.rawSaveData = this.saveData.bind(this);
  this.loadData = async () => {
    const saved = await this.rawLoadData();
    let local;
    if (saved?.storage !== "vault" && (!saved || saved.deviceStorage === 1)) {
      try {
        local = JSON.parse(await fs.readFile(this.legacyDeviceFile, "utf8"));
      } catch (error) {
        if (error.code !== "ENOENT")
          throw Error("旧版 AniLink 数据读取失败，已停止迁移");
      }
    }
    let identity;
    try {
      identity = JSON.parse(await fs.readFile(this.deviceIdentityFile, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw Error("AniLink 设备标识读取失败");
    }
    this.deviceId =
      identity?.deviceId ||
      local?.deviceId ||
      crypto.randomBytes(16).toString("hex");
    await fs.mkdir(localFolder, { recursive: true });
    await fs.writeFile(
      this.deviceIdentityFile,
      JSON.stringify({ deviceId: this.deviceId }),
      "utf8",
    );
    if (
      saved?.storage === "vault" &&
      (!saved.state || !Array.isArray(saved.state.shows))
    )
      throw Error("AniLink 库内数据格式无效，已停止加载以免覆盖数据");
    const document = saved?.storage === "vault" ? saved : local;
    this.records = DeviceModel.merge(document?.records);
    this.recordGroup = document?.recordGroup || "";
    const state =
      document?.state ||
      (saved?.deviceStorage === 1 ? C.defaults() : saved) ||
      C.defaults();
    this.deviceBaseline = DeviceModel.project(state);
    if (saved?.deviceStorage === 1 && !local) state.needsDeviceSetup = true;
    return state;
  };
  this.saveData = async (data) => {
    const after = DeviceModel.project(data);
    this.records = DeviceModel.capture(
      this.records,
      Object.keys(this.records).length ? this.deviceBaseline : {},
      after,
      this.deviceId,
    );
    if (data.settings.deviceSync === true)
      this.recordGroup = data.settings.syncGroup;
    await this.rawSaveData({
      version: 3,
      storage: "vault",
      recordGroup: this.recordGroup,
      records: this.records,
      state: data,
    });
    this.deviceBaseline = after;
  };
  await deviceOnload.call(this);
  await this.persist();
  this.registerInterval(
    window.setInterval(() => {
      if (this.state.settings.deviceSync === true)
        this.background("跨设备合并", () => this.exchangeDevices());
    }, 15000),
  );
  if (this.state.settings.deviceSync === true)
    this.background("跨设备合并", () => this.exchangeDevices());
};
AniLink.prototype.exchangeDevices = function () {
  if (this.deviceExchange) return this.deviceExchange;
  this.deviceExchange = this.mergeDeviceFiles().finally(() => {
    this.deviceExchange = null;
  });
  return this.deviceExchange;
};
AniLink.prototype.mergeDeviceFiles = async function () {
  if (!this.state.settings.deviceSync || !this.deviceId) return;
  const group = this.state.settings.syncGroup;
  if (!/^[a-zA-Z0-9_-]{1,48}$/.test(group || ""))
    throw Error("请先设置同步分组");
  // Persist pending local intent before reading other devices. Never export credentials,
  // downloads, paths, backend credentials or executable configuration.
  await this.persist();
  if (!Object.keys(this.records).length)
    this.records = DeviceModel.capture(
      {},
      {},
      DeviceModel.project(this.state),
      this.deviceId,
    );
  const adapter = this.app.vault.adapter,
    folder = `AniLink-sync/${group}`;
  for (const dir of ["AniLink-sync", folder])
    if (!(await adapter.exists(dir))) {
      try {
        await adapter.mkdir(dir);
      } catch (e) {
        if (!(await adapter.exists(dir))) throw e;
      }
    }
  const listing = await adapter.list(folder),
    maps = [];
  for (const file of listing.files) {
    if (
      !/\/[a-f0-9]{32}\.json$/.test(file) ||
      file.endsWith(`/${this.deviceId}.json`)
    )
      continue;
    try {
      const stat = await adapter.stat(file);
      if (!stat || stat.size > 10000000) throw Error("同步文件过大");
      const doc = JSON.parse(await adapter.read(file));
      if (doc.version !== 1 || doc.group !== group) continue;
      maps.push(DeviceModel.merge(doc.records));
    } catch (e) {
      C.record(this.state, `同步文件暂未合并：${file}（${e.message}）`);
    }
  }
  // Reads above may overlap a local click. Capture it after awaits, then merge.
  await this.persist();
  const combined = DeviceModel.merge(this.records, ...maps);
  DeviceModel.apply(this.state, combined, C.newShow);
  this.records = combined;
  this.deviceBaseline = DeviceModel.project(this.state);
  // Refresh queued payloads to the merged intent; imported changes do not create
  // duplicate remote writes and never trigger local downloads or file deletion.
  for (const job of this.state.queue) {
    const s = this.state.shows.find((s) => s.id === job.showId);
    if (!s) continue;
    if (job.kind === "collection")
      C.queueJob(this.state, {
        ...job,
        payload: {
          type: s.status,
          rate: s.rate,
          comment: s.comment,
          private: s.private,
        },
      });
    if (job.kind === "episode") {
      const e = s.episodes.find((e) => e.id === job.episodeId);
      if (e)
        C.queueJob(this.state, {
          ...job,
          payload: { type: e.watched ? 2 : 0 },
        });
    }
  }
  await this.persist();
  await adapter.write(
    `${folder}/${this.deviceId}.json`,
    JSON.stringify({ version: 1, group, records: this.records }),
  );
  this.redraw();
};

AniLink.prototype.onExternalSettingsChange = async function () {
  await this.saveChain;
  const incoming = await this.rawLoadData();
  if (incoming?.storage !== "vault" || !Array.isArray(incoming.state?.shows))
    return;
  // Capture clicks made while the external file was being read before merging.
  const local = DeviceModel.capture(
    this.records,
    this.deviceBaseline,
    DeviceModel.project(this.state),
    this.deviceId,
  );
  const combined = DeviceModel.merge(local, incoming.records);
  if (JSON.stringify(combined) === JSON.stringify(this.records)) return;
  DeviceModel.apply(this.state, combined, C.newShow);
  this.records = combined;
  this.deviceBaseline = DeviceModel.project(this.state);
  for (const job of this.state.queue) {
    const show = this.state.shows.find((show) => show.id === job.showId);
    if (!show) continue;
    if (job.kind === "collection")
      C.queueJob(this.state, {
        ...job,
        payload: {
          type: show.status,
          rate: show.rate,
          comment: show.comment,
          private: show.private,
        },
      });
    if (job.kind === "episode") {
      const episode = show.episodes.find(
        (episode) => episode.id === job.episodeId,
      );
      if (episode)
        C.queueJob(this.state, {
          ...job,
          payload: { type: episode.watched ? 2 : 0 },
        });
    }
  }
  await this.persist();
  this.redraw();
};

const storageSettings = Connections.prototype.display;
Connections.prototype.display = function () {
  storageSettings.call(this);
  new Setting(this.containerEl)
    .setName("数据存储")
    .setDesc(
      "完整数据保存在插件目录 data.json，包含账号凭据。复制插件目录即可迁移，请使用私人同步空间。",
    )
    .addButton((button) =>
      button
        .setButtonText("打开目录")
        .onClick(() => shell.openPath(path.dirname(this.p.deviceFile))),
    );
};
