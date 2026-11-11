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
  this.deviceFile = path.join(
    process.env.LOCALAPPDATA || require("os").homedir(),
    "AniLink",
    `${id}.json`,
  );
  this.records = {};
  this.deviceBaseline = {};
  this.rawLoadData = this.loadData.bind(this);
  this.rawSaveData = this.saveData.bind(this);
  this.loadData = async () => {
    const saved = await this.rawLoadData();
    this.markerWritten = saved?.deviceStorage === 1;
    let local;
    try {
      local = JSON.parse(await fs.readFile(this.deviceFile, "utf8"));
    } catch (e) {
      if (e.code !== "ENOENT")
        throw Error("AniLink 本机配置读取失败，已停止加载以免覆盖原数据");
    }
    this.deviceId = local?.deviceId || crypto.randomBytes(16).toString("hex");
    this.records = DeviceModel.merge(local?.records);
    this.recordGroup = local?.recordGroup || "";
    const state =
      local?.state ||
      (saved?.deviceStorage === 1 ? C.defaults() : saved) ||
      C.defaults();
    this.deviceBaseline = DeviceModel.project(state);
    if (saved?.deviceStorage === 1 && !local) state.needsDeviceSetup = true;
    return state;
  };
  this.saveData = async (data) => {
    const after = DeviceModel.project(data);
    if (data.settings.deviceSync === true) {
      const initial =
        this.recordGroup !== data.settings.syncGroup ||
        !Object.keys(this.records).length;
      this.records = DeviceModel.capture(
        initial ? {} : this.records,
        initial ? {} : this.deviceBaseline,
        after,
        this.deviceId,
      );
      this.recordGroup = data.settings.syncGroup;
    }
    this.deviceBaseline = after;
    await fs.mkdir(path.dirname(this.deviceFile), { recursive: true });
    const temp = this.deviceFile + ".tmp";
    await fs.writeFile(
      temp,
      JSON.stringify({
        version: 1,
        deviceId: this.deviceId,
        recordGroup: this.recordGroup,
        records: this.records,
        state: data,
      }),
      "utf8",
    );
    await fs.rename(temp, this.deviceFile);
    if (!this.markerWritten) {
      await this.rawSaveData({ version: 2, deviceStorage: 1 });
      this.markerWritten = true;
    }
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
