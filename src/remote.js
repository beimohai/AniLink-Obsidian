// Remote protocol operations use rclone's backend implementations. Credentials
// are passed in the child environment and never embedded in command arguments.
AniLink.prototype.remoteCommand = async function (settings, args, input) {
  let executable = settings.rcloneExe;
  if (!executable) {
    const bundled = path.join(this.app.vault.adapter.getBasePath(), this.manifest.dir, "tools", "rclone.exe");
    try { await fs.access(bundled); executable = bundled; }
    catch { executable = "rclone"; }
  }
  const execute = (parameters, env, stdin) => new Promise((resolve, reject) => {
    const child = execFile(executable, parameters, {
      windowsHide: true, timeout: 120000, maxBuffer: 32 * 1024 * 1024, env,
    }, (error, stdout) => error
      ? reject(Error(error.code === "ENOENT" ? "请先安装远程组件 rclone" : "远程操作失败，请检查地址、账号、目录及连接"))
      : resolve(stdout));
    child.stdin?.end(stdin || "");
  });
  const env = { ...process.env };
  const prefix = "RCLONE_CONFIG_ANILINKREMOTE_";
  const protocol = settings.remoteProtocol || "webdav";
  if (!["webdav", "sftp", "ftp", "ftps", "smb"].includes(protocol)) throw Error("请选择远程协议");
  const address = String(settings.remoteAddress || "").trim();
  if (!address) throw Error("请填写远程服务地址");
  const url = new URL(address.includes("://") ? address : protocol + "://" + address);
  if (url.username || url.password) throw Error("账号和密码请填写在对应输入框中");
  env[prefix + "TYPE"] = protocol === "ftps" ? "ftp" : protocol;
  env[prefix + "USER"] = settings.remoteUser || "";
  if (protocol === "webdav") {
    if (!["http:", "https:"].includes(url.protocol)) throw Error("WebDAV 地址应使用 HTTP(S)");
    env[prefix + "URL"] = url.href;
    env[prefix + "VENDOR"] = "other";
  } else {
    env[prefix + "HOST"] = url.hostname;
    if (url.port) env[prefix + "PORT"] = url.port;
    if (protocol === "ftps") env[prefix + "EXPLICIT_TLS"] = "true";
    if (protocol === "sftp") env[prefix + "KNOWN_HOSTS_FILE"] = path.join(require("os").homedir(), ".ssh", "known_hosts");
  }
  if (settings.remotePassword) {
    env[prefix + "PASS"] = (await execute(["obscure", "-"], env, settings.remotePassword)).trim();
  }
  return execute([...args, "--retries", "1", "--low-level-retries", "1", "--contimeout", "15s"], env, input);
};
AniLink.prototype.remoteTarget = function (directory) {
  const value = String(directory || "").replace(/\\/g, "/");
  if (value.split("/").includes("..") || /[\r\n\0]/.test(value)) throw Error("远程目录无效");
  return "anilinkremote:" + value;
};
AniLink.prototype.remoteDirectories = async function (settings, directory) {
  return JSON.parse(await this.remoteCommand(settings, ["lsjson", this.remoteTarget(directory), "--dirs-only"]));
};
AniLink.prototype.scanRemoteVideos = async function () {
  const settings = this.state.settings;
  if (!settings.remoteEnabled) return;
  const rows = JSON.parse(await this.remoteCommand(settings, ["lsjson", this.remoteTarget(settings.remoteDirectory), "--recursive", "--max-depth", "3", "--files-only"]));
  const normalize = (text) => String(text).normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "").toLowerCase();
  for (const row of rows.filter((item) => C.VIDEO.test(item.Name))) {
    const subjects = this.state.shows.filter((show) => [show.title, show.name].filter(Boolean).some((name) => normalize(row.Path).includes(normalize(name))));
    if (subjects.length !== 1) continue;
    const show = subjects[0];
    const episode = C.resolveEpisode(show, row.Name);
    if (!episode) continue;
    const remotePath = path.posix.join(settings.remoteDirectory || "/", row.Path);
    const cache = path.join(this.app.vault.adapter.basePath, this.manifest.dir, "media-cache", String(show.id), path.basename(row.Name));
    const existing = episode.files.find((file) => file.remotePath === remotePath);
    const file = { name: row.Name, path: cache, remotePath, progress: 1, localExists: true, episodeId: episode.id };
    if (existing) Object.assign(existing, file);
    else episode.files.push(file);
  }
};
AniLink.prototype.cacheRemoteVideo = async function (file) {
  if (!file.remotePath) return;
  await fs.mkdir(path.dirname(file.path), { recursive: true });
  try { await fs.access(file.path); }
  catch { await this.remoteCommand(this.state.settings, ["copyto", this.remoteTarget(file.remotePath), file.path]); }
  const remoteXml = file.remotePath.replace(/\.[^.]+$/, ".xml");
  const localXml = file.path.replace(/\.[^.]+$/, ".xml");
  try { await fs.access(localXml); }
  catch {
    const rows = JSON.parse(await this.remoteCommand(this.state.settings, ["lsjson", this.remoteTarget(path.posix.dirname(remoteXml)), "--files-only"]));
    if (rows.some((row) => row.Name === path.posix.basename(remoteXml)))
      await this.remoteCommand(this.state.settings, ["copyto", this.remoteTarget(remoteXml), localXml]);
  }
};
AniLink.prototype.deleteRemoteMedia = async function (file) {
  const xml = file.remotePath.slice(0, file.remotePath.lastIndexOf(".")) + ".xml";
  const rows = JSON.parse(await this.remoteCommand(this.state.settings, ["lsjson", this.remoteTarget(path.posix.dirname(xml)), "--files-only"]));
  if (rows.some((row) => row.Name === path.posix.basename(xml)))
    await this.remoteCommand(this.state.settings, ["deletefile", this.remoteTarget(xml)]);
  await this.remoteCommand(this.state.settings, ["deletefile", this.remoteTarget(file.remotePath)]);
};
AniLink.prototype.chooseRemoteDirectory = function (settings, input) {
  new Panel(this, "选择远程目录", (el, modal) => {
    let current = input.value || "/";
    const location = el.createEl("p");
    const listing = el.createDiv("al-results");
    const load = async () => {
      location.setText(current);
      listing.empty();
      const rows = await this.remoteDirectories(settings, current);
      for (const row of rows) button(listing, row.Name, () => this.run(async () => {
        current = path.posix.join(current, row.Name);
        await load();
      }));
    };
    const actions = el.createDiv("al-actions");
    button(actions, "上一级", () => this.run(async () => { current = path.posix.dirname(current); await load(); }));
    button(actions, "选择此目录", () => { input.value = current; input.dispatchEvent(new Event("input", { bubbles: true })); modal.close(); });
    this.run(load);
  }).open();
};
