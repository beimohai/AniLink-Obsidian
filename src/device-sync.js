const DeviceModel = require("./sync-model");
const deviceOnload = AniLink.prototype.onload;
AniLink.prototype.onload = async function () {
  const crypto = require("crypto");
  const base = this.app.vault.adapter.getBasePath();
  const id = crypto.createHash("sha256").update(base).digest("hex").slice(0, 24);
  const localFolder = path.join(process.env.LOCALAPPDATA || require("os").homedir(), "AniLink");
  this.legacyDeviceFile = path.join(localFolder, id + ".json");
  this.deviceIdentityFile = path.join(localFolder, id + ".device.json");
  this.deviceFile = path.join(base, this.manifest.dir, "data.json");
  this.records = {};
  this.deviceBaseline = {};
  this.rawLoadData = this.loadData.bind(this);
  this.rawSaveData = this.saveData.bind(this);
  this.loadData = async () => {
    const saved = await this.rawLoadData();
    let local;
    if (saved?.storage !== "vault" && (!saved || saved.deviceStorage === 1)) {
      try { local = JSON.parse(await fs.readFile(this.legacyDeviceFile, "utf8")); }
      catch (error) { if (error.code !== "ENOENT") throw Error("旧版 AniLink 数据读取失败，已停止迁移"); }
    }
    let identity;
    try { identity = JSON.parse(await fs.readFile(this.deviceIdentityFile, "utf8")); }
    catch (error) { if (error.code !== "ENOENT") throw Error("AniLink 设备标识读取失败"); }
    this.deviceId = identity?.deviceId || local?.deviceId || crypto.randomBytes(16).toString("hex");
    await fs.mkdir(localFolder, { recursive: true });
    await fs.writeFile(this.deviceIdentityFile, JSON.stringify({ deviceId: this.deviceId }), "utf8");
    if (saved?.storage === "vault" && (!saved.state || !Array.isArray(saved.state.shows)))
      throw Error("AniLink 库内数据格式无效，已停止加载以免覆盖数据");
    const document = saved?.storage === "vault" ? saved : local;
    this.records = DeviceModel.merge(document?.records);
    const state = document?.state || (saved?.deviceStorage === 1 ? C.defaults() : saved) || C.defaults();
    this.deviceBaseline = DeviceModel.project(state);
    if (saved?.deviceStorage === 1 && !local) state.needsDeviceSetup = true;
    return state;
  };
  this.saveData = async (data) => {
    const after = DeviceModel.project(data);
    this.records = DeviceModel.capture(this.records, Object.keys(this.records).length ? this.deviceBaseline : {}, after, this.deviceId);
    await this.rawSaveData({ version: 3, storage: "vault", records: this.records, state: data });
    this.deviceBaseline = after;
  };
  await deviceOnload.call(this);
  await this.persist();
};

AniLink.prototype.onExternalSettingsChange = async function () {
  await this.saveChain;
  const incoming = await this.rawLoadData();
  if (incoming?.storage !== "vault" || !Array.isArray(incoming.state?.shows)) return;
  const local = DeviceModel.capture(this.records, this.deviceBaseline, DeviceModel.project(this.state), this.deviceId);
  const combined = DeviceModel.merge(local, incoming.records);
  if (JSON.stringify(combined) === JSON.stringify(this.records)) return;
  DeviceModel.apply(this.state, combined, C.newShow);
  this.records = combined;
  this.deviceBaseline = DeviceModel.project(this.state);
  for (const job of this.state.queue) {
    const show = this.state.shows.find((show) => show.id === job.showId);
    if (!show) continue;
    if (job.kind === "collection") C.queueJob(this.state, { ...job, payload: { type: show.status, rate: show.rate, comment: show.comment, private: show.private } });
    if (job.kind === "episode") {
      const episode = show.episodes.find((episode) => episode.id === job.episodeId);
      if (episode) C.queueJob(this.state, { ...job, payload: { type: episode.watched ? 2 : 0 } });
    }
  }
  await this.persist();
  this.redraw();
};
