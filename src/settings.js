// Native settings tab, organised by the services and behaviours a user
// configures.  Keeping the controls here avoids a second, inconsistent dialog.
Connections.prototype.display = function () {
  const el = this.containerEl;
  const p = this.p;
  const s = p.state.settings;
  el.empty();
  el.addClass("al-plugin-settings", "al-settings-v2");

  const heading = (name) =>
    new Setting(el).setName(name).setHeading().settingEl.addClass("al-settings-section-header");
  const save = async (key, value) => {
    s[key] = value;
    await p.persist();
    if (["bgmMirror", "bgmMirrorWeb", "bgmMirrorApi", "bgmMirrorData"].includes(key)) p.background("更新番剧数据源", () => p.refreshDisplayMetadata());
    if (key === "rssDefaultQuality" || key === "rssDefaultLanguage" || key === "rssDefaultExclude") await p.applyRssDefaults();
  };
  const text = (name, key, description = "", password = false) => {
    const row = new Setting(el).setName(name).setDesc(description);
    let input;
    row.addText((control) => {
      input = control.inputEl;
      control.setValue(String(s[key] ?? ""));
      input.type = password ? "password" : "text";
      control.onChange((value) => p.run(() => save(key, value.trim())));
    });
    if (password)
      row.settingEl.addClass("al-password-setting");
    if (password)
      row.addExtraButton((control) => {
        const refresh = () => control.setIcon(input.type === "password" ? "eye-off" : "eye");
        refresh();
        control.setTooltip("显示或隐藏密码").onClick(() => {
          input.type = input.type === "password" ? "text" : "password";
          refresh();
        });
      });
    return { row, input: () => input };
  };
  const choice = (name, key, values, fallback, description = "") =>
    new Setting(el).setName(name).setDesc(description).addDropdown((control) =>
      control.addOptions(values).setValue(String(s[key] ?? fallback)).onChange((value) => p.run(() => save(key, value))),
    );
  const toggle = (name, key, fallback, description = "", changed = () => {}) => {
    const row = new Setting(el).setName(name).setDesc(description);
    let input;
    row.addToggle((control) => {
      input = control.toggleEl;
      control.setValue(s[key] ?? fallback).onChange((value) => {
        changed(value);
        p.run(() => save(key, value));
      });
    });
    return { row, input: () => input };
  };
  const picker = (row, getInput, directory) =>
    sideAction(row, "选择路径", () =>
      p.run(async () => {
        const result = await desktop.remote.dialog.showOpenDialog({
          properties: [directory ? "openDirectory" : "openFile"],
          filters: directory || process.platform !== "win32" ? undefined : [{ name: "程序", extensions: ["exe"] }],
        });
        if (!result.canceled && result.filePaths[0]) {
          getInput().value = result.filePaths[0];
          getInput().dispatchEvent(new Event("input", { bubbles: true }));
        }
      }),
    );
  const sideAction = (row, label, action) => {
    row.settingEl.addClass("al-setting-has-side-action");
    row.addButton((control) => control.setButtonText(label).onClick(action));
  };

  heading("通用");
  choice("日期格式", "dateFormat", { "yyyy/mm/dd": "YYYY/MM/DD", "yyyy-mm-dd": "YYYY-MM-DD", "yyyy.mm.dd": "YYYY.MM.DD", "yyyymmdd": "YYYYMMDD",
    "mm/dd/yyyy": "MM/DD/YYYY", "mm-dd-yyyy": "MM-DD-YYYY",
    "dd/mm/yyyy": "DD/MM/YYYY", "dd-mm-yyyy": "DD-MM-YYYY", "dd.mm.yyyy": "DD.MM.YYYY",
    "yyyy年mm月dd日": "YYYY年MM月DD日",
  }, "yyyy/mm/dd").setClass("al-wide-select-setting");
  choice("网页打开方式", "browserMode", { external: "默认浏览器", obsidian: "Obsidian 内置" }, "external").setClass("al-wide-select-setting");
  toggle("默认打开第一个番剧", "openFirstShow", false);
  new Setting(el).setName("运行日志").setClass("al-log-setting").addButton((b) => b.setButtonText("查看日志").onClick(() => p.logsModal()));
  choice("日志记录范围", "logScope", { all: "全量操作", errors: "错误信息" }, "all");
  choice("日志缓存时间", "logRetention", { session: "退出后清除", day: "一天", week: "七天", forever: "长期保留" }, "session");

  toggle("启动通知", "startupNotifications", true);
  if (Platform.isDesktop) toggle("播放准备通知", "playbackNotifications", true);
  toggle("进度与状态通知", "progressNotifications", true);
  if (Platform.isDesktop) toggle("下载完成通知", "downloadNotifications", false);
  toggle("刷新完成通知", "refreshNotifications", true);
  toggle("同步完成通知", "syncNotifications", true);

  heading("页面设置");
  choice("默认季度", "shelfQuarterDefault", { all: "全部季度", current: "当前季度", last: "上次设置" }, "all");
  choice("默认排序", "shelfSort", { ready: "最近更新", title: "名称", progress: "观看进度", added: "最近加入" }, "ready");
  if (Platform.isDesktop) choice("书架列数", "shelfColumns", { auto: "自动", 1: "单列", 2: "双列" }, "auto");
  toggle("显示标题原文", "showOriginalName", true);
  for (const status of [1, 3])
    new Setting(el).setName("搜索界面按钮展示 · " + C.STATUS[status]).addToggle((control) => control.setValue((s.searchStatuses || [3]).includes(status)).onChange((enabled) => p.run(async () => { const selected = new Set(s.searchStatuses || [3]); if (enabled) selected.add(status); else selected.delete(status); s.searchStatuses = [...selected]; await p.persist(); })));
  toggle("显示番剧信息面板", "informationPanel", true, "", (value) => { information.settingEl.hidden = !value; });
  const information = choice("默认番剧信息", "informationPage", { none: "不预览", fanku: "番库", bangumi: "Bangumi", trend: "评分趋势" }, "none");
  information.settingEl.hidden = s.informationPanel === false;

  heading("Bangumi");
  const token = text("访问令牌", "bgmToken", "用于同步收藏、进度与评价。", true);
  sideAction(token.row, "获取 Token", () => p.openWebsite("https://next.bgm.tv/demo/access-token"));
  toggle("使用镜像网站", "bgmMirror", false, "使用 bgm.lat 镜像。", (enabled) => { mirrorControls.hidden = !enabled; });
  const mirrorControls = el.createDiv("al-settings-conditional");
  mirrorControls.hidden = !s.bgmMirror;
  for (const [name, key] of [["网页使用镜像网站", "bgmMirrorWeb"], ["API使用镜像网站", "bgmMirrorApi"], ["数据源使用镜像网站", "bgmMirrorData"]]) {
    const control = toggle(name, key, true);
    mirrorControls.appendChild(control.row.settingEl);
  }
  const syncInterval = text("自动同步间隔（分钟）", "bgmSyncMinutes", "0 为关闭定时同步。");
  syncInterval.row.settingEl.addClass("al-sync-interval-setting");
  syncInterval.input().inputMode = "numeric";
  toggle("启动时自动同步", "bgmSyncStartup", true);
  toggle("退出时自动同步", "bgmSyncExit", true);
  toggle("看到最后一集自动标记看过", "bgmAutoComplete", true);
  choice("冲突处理", "bgmConflictPolicy", { ask: "询问", remote: "以远端为准", local: "以本地为准" }, "ask");
  new Setting(el).setName("同步操作").setClass("al-sync-actions")
    .addButton((b) => b.setButtonText("推送").onClick(() => p.run(async () => { await p.sync(); if (!p.state.syncError) p.notify("sync", "Bangumi 推送完成"); })))
    .addButton((b) => b.setButtonText("拉取").onClick(() => p.run(async () => { await p.pullAccount(); p.notify("sync", "Bangumi 拉取完成"); })));
  for (const show of p.state.shows.filter((show) => show.remoteConflict))
    new Setting(el).setName(show.title).setDesc("本地与远端资料存在差异。")
      .addButton((b) => b.setButtonText("采用远端").onClick(() => p.run(() => p.resolveConflict(show, true))))
      .addButton((b) => b.setButtonText("保留本地").onClick(() => p.run(() => p.resolveConflict(show, false))));

  if (Platform.isDesktop) {
  heading("qBittorrent");
  text("WebUI 地址", "qbUrl");
  text("用户名", "qbUser");
  text("密码", "qbPassword", "", true);
  const qbExe = text("程序路径", "qbExe");
  picker(qbExe.row, qbExe.input, false);
  const root = text("下载目录", "downloadRoot");
  picker(root.row, root.input, true);
  text("空闲后退出（分钟）", "idleMinutes");
  const startupSetting = new Setting(el).setName("开机自动启动").addToggle((control) => {
    const startup = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "AniLink-downloads.lnk");
    control.setValue(fsSync.existsSync(startup));
    control.setDisabled(process.platform !== "win32");
    control.onChange((enabled) => p.run(() => p.configureLoginScheduler(enabled)));
  });
  const connectionSetting = new Setting(el).setName("检查连接").addButton((b) => b.setButtonText("检查连接").onClick(() => p.run(async () => {
    b.setButtonText("检查中…").setDisabled(true);
    connectionSetting.setDesc("正在检查连接…");
    new Notice("正在检查 qBittorrent 连接…");
    try { await p.qb().call("app/version"); connectionSetting.setDesc("qBittorrent 连接正常"); new Notice("qBittorrent 连接正常"); }
    catch (error) { const message = C.qbConnectionMessage(error); connectionSetting.setDesc(message); new Notice(message, 8000); C.record(p.state, "qBittorrent 连接检查失败：" + error.message); await p.persist(); }
    finally { b.setButtonText("检查连接").setDisabled(false); }
  })));
  new Setting(el).setName("RSS 自动配置").setDesc("检查本机下载器并写入 AniLink 的 RSS 规则。").addButton((b) =>
    b.setButtonText("一键配置").onClick(() => p.run(() => p.autoConfigure(false))),
  );

  el.appendChild(startupSetting.settingEl);
  toggle("打开插件自动启动", "downloaderOnStartup", false);
  toggle("自动刷新 RSS 订阅", "autoRefresh", true, "", (value) => { polling.settingEl.hidden = !value; });
  const polling = text("自动刷新 RSS 订阅（分钟）", "rssRefreshMinutes").row;
  polling.settingEl.hidden = s.autoRefresh === false;
  toggle("有 v2 版本自动替换未看视频", "rssUpgradeUnwatched", false);
  toggle("自动清除已完成的任务", "clearCompletedTasks", false, "自动移除下载器中已完成的任务，保留已下载文件。");

  heading("本地管理");
  const library = text("番剧库路径", "libraryRoot", "留空时默认使用 qBittorrent 下载目录。");
  picker(library.row, library.input, true);
  toggle("多路径管理", "multiLibraryEnabled", false, "", (enabled) => { extraLibraries.hidden = !enabled; });
  const extraLibraries = el.createDiv("al-settings-conditional");
  extraLibraries.hidden = !s.multiLibraryEnabled;
  const renderLibraries = () => {
    extraLibraries.empty();
    if (!Array.isArray(s.extraLibraryRoots)) s.extraLibraryRoots = [];
    s.extraLibraryRoots.forEach((value, index) => {
      const row = new Setting(extraLibraries).setName("附加番剧库路径");
      row.settingEl.addClass("al-input-setting", "al-setting-has-side-action");
      let input;
      row.addText((control) => {
        input = control.inputEl;
        control.setValue(value).onChange((next) => p.run(async () => {
          s.extraLibraryRoots[index] = next.trim();
          await p.persist();
        }));
      });
      picker(row, () => input, true);
      row.addButton((control) => control.setButtonText("移除").onClick(() => p.run(async () => {
        s.extraLibraryRoots.splice(index, 1);
        await p.persist();
        renderLibraries();
      })));
    });
    new Setting(extraLibraries).setName("新增路径").addButton((control) => control.setButtonText("新增路径").onClick(() => p.run(async () => {
      s.extraLibraryRoots.push("");
      await p.persist();
      renderLibraries();
    })));
  };
  renderLibraries();

  new Setting(el).setName("手动关联本地番剧").setClass("al-local-association-setting").addButton((control) => control.setButtonText("关联 Bangumi 条目").onClick(() => p.localLibraryModal()));
  choice("点击看到这里", "cleanupMode", { none: "不清理", current: "清理当前文件", watched: "清理已看文件" }, s.cleanupAfterWatch === false ? "none" : "watched").settingEl.addClass("al-cleanup-setting");
  toggle("删除文件时同步删除种子", "deleteTorrentWithFiles", true);

  }

  heading("远程服务");
  const remoteToggle = new Setting(el).setName("启用远程服务").setDesc("开启后使用远程服务管理媒体库。关闭时采用本地目录。");
  let networkControls = [];
  const remoteControls = el.createDiv("al-settings-conditional");
  remoteToggle.addToggle((control) => control.setValue(s.remoteEnabled ?? false).onChange((value) => p.run(async () => {
    remoteControls.hidden = !value;
    for (const node of networkControls) node.hidden = !value;
    await save("remoteEnabled", value);
  })));
  const remoteSetting = (fn) => {
    const before = el.children.length;
    fn();
    const nodes = [...el.children].slice(before);
    for (const node of nodes) remoteControls.appendChild(node);
  };
  remoteSetting(() => choice("服务类型", "remoteProtocol", { webdav: "WebDAV", sftp: "SFTP", ftp: "FTP", ftps: "FTPS", smb: "SMB" }, "webdav"));
  if (Platform.isMobile) {
    remoteToggle.setDesc("开启后通过 WebDAV 管理远程媒体库。");
    const protocols = remoteControls.querySelector("select");
    for (const option of protocols.options) option.disabled = option.value !== "webdav";
  }
  remoteSetting(() => text("服务地址", "remoteAddress"));
  remoteSetting(() => text("用户名", "remoteUser"));
  let remotePassword;
  remoteSetting(() => { remotePassword = text("密码", "remotePassword", "", true); });
  sideAction(remotePassword.row, "检查连接", () => p.run(async () => { await p.remoteDirectories(p.state.settings, p.state.settings.remoteDirectory || "/"); new Notice("远程服务连接正常"); }));
  let remoteDir;
  remoteSetting(() => { remoteDir = text("远程目录", "remoteDirectory"); });
  sideAction(remoteDir.row, "选择路径", () => p.chooseRemoteDirectory(p.state.settings, remoteDir.input()));
  if (Platform.isDesktop) remoteSetting(() => new Setting(el).setName("远程组件 rclone").setDesc("用于访问远程媒体库。").addButton((b) => b.setButtonText("安装组件").onClick(() => p.run(() => p.installRclone()))));
  remoteControls.hidden = !(s.remoteEnabled ?? false);

  if (Platform.isDesktop) {
  heading("播放器与弹幕");
  el.createEl("p", { text: "推荐使用弹弹play；PotPlayer、mpv、VLC等视频播放器，需要安装对应弹幕扩展。", cls: "setting-item-description" });
  const player = text("播放器路径", "playerExe");
  picker(player.row, player.input, false);
  const networkStart = el.children.length;
  choice("网络播放器", "networkPlayer", { local: "本地播放器", kodi: "Kodi", jellyfin: "Jellyfin", emby: "Emby" }, "local");
  text("播放器服务地址", "networkPlayerUrl");
  text("播放器访问密钥", "networkPlayerToken", "", true);
  text("播放会话 ID", "networkPlayerSession", "Jellyfin / Emby 当前在线客户端的会话 ID。");
  text("播放器媒体路径前缀", "networkPlayerRoot", "Kodi 可访问的媒体根目录，Jellyfin / Emby 用于匹配媒体库文件路径。");
  networkControls = [...el.children].slice(networkStart);
  for (const node of networkControls) node.hidden = !s.remoteEnabled;
  toggle("播放前校准弹幕", "calibrateDanmaku", true, "", (value) => { dependency.hidden = !value && !s.calibrationStatus; });
  toggle("启用官方番剧弹幕", "biliOfficialFirst", true);
  toggle("启用港澳台弹幕（需要对应网络环境）", "biliRegional", false);
  toggle("删减番剧弹幕校准", "biliCutAlignment", true);
  const dependency = el.createDiv("al-settings-dependency");
  const dependencyStatus = new Setting(dependency).setName("依赖状态").setDesc("播放前校准弹幕所需的依赖。");
  const installers = dependency.createDiv("al-actions al-calibration-installers");
  const install = {
    python: button(installers, "安装 Python", () => p.openWebsite(process.platform === "win32" ? "https://www.python.org/downloads/windows/" : "https://www.python.org/downloads/")),
    numpy: button(installers, "安装 NumPy", () => p.run(async () => {
      if (!(await p.calibrationDependencies()).python) throw Error("未找到 Python，请先安装 Python 后重新打开 Obsidian");
      await p.installCalibrationNumpy();
      await inspect();
    })),
    ffmpeg: button(installers, "安装 FFmpeg", () => p.openWebsite("https://ffmpeg.org/download.html")),
  };
  const showDependencies = (ready) => {
    dependencyStatus.setDesc(ready
      ? `Python：${ready.python ? "已就绪" : "未找到"}；NumPy：${ready.numpy ? "已就绪" : "未安装"}；FFmpeg：${ready.ffmpeg ? "已就绪" : "未找到"}。`
      : "点击检查依赖以查看状态。");
    for (const [key, control] of Object.entries(install)) {
      control.classList.toggle("al-dependency-unneeded", !ready || !!ready[key]);
      control.disabled = !ready || ready[key];
    }
  };
  const inspect = async () => {
    const ready = await p.calibrationDependencies();
    s.calibrationStatus = ready;
    await p.persist();
    showDependencies(ready);
  };
  dependencyStatus.addButton((b) => b.setButtonText("检查依赖").onClick(() => p.run(inspect)));
  dependency.hidden = !(s.calibrateDanmaku ?? true) && !s.calibrationStatus;
  showDependencies(s.calibrationStatus);

  heading("bilibili");
  p.biliAccountPanel(el);
  new Setting(el).setName("弹幕屏蔽").addButton((b) => b.setButtonText("同步").onClick(() => p.run(() => p.syncBiliFilters()))).addButton((b) => b.setButtonText("屏蔽词库").onClick(() => p.filterRulesModal()));
  const uploaders = text("弹幕来源 UP 主 UID", "biliUploaders", "多个 UID 用英文逗号分隔。");
  uploaders.row.settingEl.addClass("al-uploader-setting");
  const uploaderProfiles = el.createDiv("al-bili-uploaders");
  let uploaderGeneration = 0;
  const renderUploaders = async () => {
    const generation = ++uploaderGeneration;
    uploaderProfiles.empty();
    p.biliUploaderCache ||= new Map();
    const uids = [...new Set(String(s.biliUploaders || "").split(",").map((uid) => uid.trim()).filter((uid) => /^\d+$/.test(uid)))];
    await Promise.all(uids.map(async (uid) => {
      const profile = uploaderProfiles.createDiv("al-bili-profile");
      profile.setText("UID " + uid + " · 正在读取…");
      try {
        let user = p.biliUploaderCache.get(uid);
        if (!user) {
          const response = await p.http.json("https://api.bilibili.com/x/web-interface/card?mid=" + uid, "GET", undefined, { Referer: "https://www.bilibili.com/" });
          if (response.code !== 0 || !response.data?.card) throw Error(response.message || "账号资料不可用");
          user = response.data.card;
          p.biliUploaderCache.set(uid, user);
        }
        if (generation !== uploaderGeneration || !profile.isConnected) return;
        profile.empty();
        if (user.face) profile.createEl("img", { attr: { src: user.face, referrerpolicy: "no-referrer", alt: user.name } });
        profile.createSpan({ text: user.name + " · UID " + uid });
        button(profile, "打开主页", () => p.openWebsite("https://space.bilibili.com/" + uid));
      } catch (error) {
        if (generation === uploaderGeneration) profile.setText("UID " + uid + " · " + error.message);
      }
    }));
  };
  uploaders.input().addEventListener("change", () => { void renderUploaders(); });
  void renderUploaders();


  }

  const openExternal = (url) => Platform.isMobile ? p.openWebsite(url) : shell.openExternal(url);
  const communityStart = el.children.length;
  for (const [kind, name, text, icon] of [["sponsor", "赞助与支持", "打开赞助面板", "heart"], ["feedback", "问题反馈", "打开反馈面板", "message-square-warning"]]) {
    new Setting(el).setName(name).addButton((b) => b.setButtonText(text).setIcon(icon).onClick(() =>
      new Panel(p, name, (body) => {
        body.parentElement.addClass("al-community-modal");
        body.createEl("img", { attr: { src: communityImages[kind], alt: name }, cls: "al-community-image" });
        new Setting(body).setName("作者GitHub主页").addButton((link) => link.setButtonText("打开GitHub").setIcon("github").onClick(() => openExternal("https://github.com/beimohai")));
        new Setting(body).setName("作者B站主页").addButton((link) => link.setButtonText("打开B站").setIcon("external-link").onClick(() => openExternal("https://space.bilibili.com/1065768987")));
        if (kind === "feedback") new Setting(body).setName("问题反馈").addButton((link) => link.setButtonText("打开 GitHub Issues").setIcon("message-square-warning").onClick(() => openExternal("https://github.com/beimohai/AniLink-Obsidian/issues")));
      }).open(),
    ));
  }
  const pageHeader = [...el.children].find((node) => node.classList.contains("setting-item-heading") && node.textContent === "页面设置");
  for (const node of [...el.children].slice(communityStart)) el.insertBefore(node, pageHeader);
  for (const control of el.querySelectorAll(".al-setting-has-side-action .setting-item-control")) {
    const action = control.querySelector("button");
    if (action) control.prepend(action);
  }
  for (const row of el.querySelectorAll(".setting-item")) {
    row.classList.toggle("al-setting-no-description", !row.querySelector(".setting-item-description"));
    row.classList.toggle("al-toggle-setting", !!row.querySelector(".checkbox-container"));
    row.classList.toggle("al-input-setting", !!row.querySelector('input[type="text"], input[type="password"], input[type="number"]'));
    row.classList.toggle("al-select-setting", !!row.querySelector("select"));
  }
  const footer = el.createDiv("al-plugin-footer");
  const logo = new DOMParser().parseFromString(ANI_ICON, "image/svg+xml").documentElement;
  footer.createEl("a", { cls: "al-plugin-footer-logo", attr: { href: "https://github.com/beimohai/AniLink-Obsidian", target: "_blank" } }).appendChild(document.importNode(logo, true));
  const details = footer.createDiv("al-plugin-footer-details");
  for (const [label, url] of [["AniLink", "https://github.com/beimohai/AniLink-Obsidian"], ["作者：北漠海", "https://space.bilibili.com/1065768987"], ["版本号：" + p.manifest.version, "https://github.com/beimohai/AniLink-Obsidian/releases"], ["更新日期：" + ANI_RELEASE_DATE, "https://github.com/beimohai/AniLink-Obsidian/releases"]]) details.createEl("a", { text: label, attr: { href: url, target: "_blank" } });
  footer.createDiv({ text: "本项目基于 MIT License 开源", cls: "al-plugin-footer-license" });
  const authorLinks = el.createDiv("al-author-links");
  for (const [name, label, icon, url] of [
    ["作者GitHub主页", "打开GitHub", "github", "https://github.com/beimohai"],
    ["作者B站主页", "打开B站", "external-link", "https://space.bilibili.com/1065768987"],
  ]) new Setting(authorLinks).setName(name).addButton((control) => control.setButtonText(label).setIcon(icon).onClick(() => openExternal(url)));
  el.insertBefore(authorLinks, footer);
};

const settingsOnlyDashboardRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  settingsOnlyDashboardRender.call(this);
  const toolbar = this.contentEl.querySelector(".al-top > .al-actions");
  for (const control of toolbar?.querySelectorAll("button") || [])
    if (control.textContent === "连接配置") control.remove();
};
