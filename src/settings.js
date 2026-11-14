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
        const result = await require("electron").remote.dialog.showOpenDialog({
          properties: [directory ? "openDirectory" : "openFile"],
          filters: directory ? undefined : [{ name: "程序", extensions: ["exe"] }],
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
  choice("日志记录范围", "logScope", { all: "全量操作", errors: "错误信息" }, "all");
  choice("日志缓存时间", "logRetention", { session: "退出插件后清除", day: "一天", week: "七天", forever: "长期保留" }, "session");
  toggle("默认打开第一个番剧", "openFirstShow", false);
  new Setting(el).setName("运行日志").addButton((b) => b.setButtonText("查看日志").onClick(() => p.logsModal()));

  heading("页面设置");
  choice("默认季度", "shelfQuarterDefault", { all: "全部季度", current: "当前季度", last: "上次设置" }, "all");
  choice("默认排序", "shelfSort", { ready: "最近更新", title: "名称", progress: "观看进度", added: "最近加入" }, "ready");
  choice("书架列数", "shelfColumns", { auto: "自动", 1: "单列", 2: "双列" }, "auto");
  toggle("显示标题原文", "showOriginalName", true);
  for (const status of [1, 3])
    new Setting(el).setName("搜索界面按钮展示 · " + C.STATUS[status]).addToggle((control) => control.setValue((s.searchStatuses || [3]).includes(status)).onChange((enabled) => p.run(async () => { const selected = new Set(s.searchStatuses || [3]); if (enabled) selected.add(status); else selected.delete(status); s.searchStatuses = [...selected]; await p.persist(); })));
  toggle("显示番剧信息面板", "informationPanel", true);
  choice("默认番剧信息", "informationPage", { none: "不预览", fanku: "番库", bangumi: "Bangumi", trend: "评分趋势" }, "none");

  heading("Bangumi");
  const token = text("访问令牌", "bgmToken", "用于同步收藏、进度与评价。", true);
  sideAction(token.row, "获取 Token", () => p.openWebsite("https://next.bgm.tv/demo/access-token"));
  toggle("使用镜像网页", "bgmMirror", false, "网页与预览使用 bangumi.tv，账号推送与拉取使用官方 API。");
  text("自动同步间隔（分钟）", "bgmSyncMinutes", "0 为关闭定时同步。");
  toggle("启动时自动同步", "bgmSyncStartup", false);
  toggle("退出时自动推送", "bgmSyncExit", false, "Obsidian 关闭时会尝试推送，未完成任务会保存在本地。");
  choice("冲突处理", "bgmConflictPolicy", { ask: "检测差异并询问", remote: "以远端为准", local: "以本地为准" }, "ask");
  new Setting(el).setName("同步操作")
    .addButton((b) => b.setButtonText("推送").onClick(() => p.run(() => p.sync())))
    .addButton((b) => b.setButtonText("拉取").onClick(() => p.run(() => p.pullAccount())));
  for (const show of p.state.shows.filter((show) => show.remoteConflict))
    new Setting(el).setName(show.title).setDesc("本地与远端资料存在差异。")
      .addButton((b) => b.setButtonText("采用远端").onClick(() => p.run(() => p.resolveConflict(show, true))))
      .addButton((b) => b.setButtonText("保留本地").onClick(() => p.run(() => p.resolveConflict(show, false))));

  heading("qBittorrent");
  text("WebUI 地址", "qbUrl");
  text("用户名", "qbUser");
  text("密码", "qbPassword", "", true);
  const qbExe = text("程序路径", "qbExe");
  picker(qbExe.row, qbExe.input, false);
  const root = text("下载目录", "downloadRoot");
  picker(root.row, root.input, true);
  const profile = text("配置目录（可选）", "qbProfile", "留空使用 qBittorrent 默认配置目录；仅用于登录启动。", false);
  picker(profile.row, profile.input, true);
  choice("运行方式", "downloadMode", { off: "不自动管理", once: "登录后检查一次，完成后退出", cycle: "循环检查（高级）" }, "off", "只管理 AniLink 启动的本机 qBittorrent；不会关闭原本已手动启动的下载器。");
  text("空闲后退出（分钟）", "idleMinutes", "登录检查和修改 RSS 后，下载完成且空闲多久才退出。默认 10 分钟。");
  new Setting(el).setName("Windows 登录自动启动").addToggle((control) => {
    const startup = path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "AniLink-downloads.lnk");
    control.setValue(require("fs").existsSync(startup));
    control.onChange((enabled) => p.run(() => p.configureLoginScheduler(enabled)));
  });
  choice("默认 RSS 分辨率", "rssDefaultQuality", { "": "不限", "1080": "1080p", "2160": "2160p", "720": "720p" }, "");
  choice("默认 RSS 字幕语言", "rssDefaultLanguage", { "": "不限", "简": "简体", "繁": "繁体", "简繁": "简繁" }, "");
  text("默认 RSS 排除关键词", "rssDefaultExclude", "多个关键词用 | 分隔，自动应用于未自定义的订阅。");
  new Setting(el).setName("检查连接").addButton((b) => b.setButtonText("检查连接").onClick(() => p.run(async () => {
    await p.qb().call("app/version");
    new Notice("qBittorrent 连接正常");
  })));
  new Setting(el).setName("RSS 自动配置").setDesc("检查本机下载器并写入 AniLink 的 RSS 规则。").addButton((b) =>
    b.setButtonText("一键配置").onClick(() => p.run(() => p.autoConfigure(false))),
  );

  heading("下载管理");
  toggle("自动刷新下载与同步", "autoRefresh", true);
  text("下载状态刷新秒数", "pollSeconds", "最小 30 秒。");
  text("分集资料更新小时数", "metadataHours", "仅想看和在看的番剧。");
  toggle("下载完成通知", "downloadNotifications", true);

  heading("本地管理");
  const library = text("番剧库路径", "libraryRoot", "本地扫描与整理默认读取此目录。留空时使用 qBittorrent 下载目录。");
  picker(library.row, library.input, true);
  toggle("删除文件时同步删除种子", "deleteTorrentWithFiles", true);
  choice("自动清理", "cleanupMode", { none: "不清理", current: "清理当前文件", watched: "清理已看文件" }, s.cleanupAfterWatch === false ? "none" : "watched", "点击看到这里按钮后的操作。");

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
  remoteSetting(() => text("服务地址", "remoteAddress", "WebDAV 可填写完整 HTTP(S) 地址，其他协议填写主机和端口。"));
  remoteSetting(() => text("用户名", "remoteUser"));
  let remotePassword;
  remoteSetting(() => { remotePassword = text("密码", "remotePassword", "", true); });
  sideAction(remotePassword.row, "检查连接", () => p.run(async () => { await p.remoteDirectories(p.state.settings, p.state.settings.remoteDirectory || "/"); new Notice("远程服务连接正常"); }));
  let remoteDir;
  remoteSetting(() => { remoteDir = text("远程目录", "remoteDirectory"); });
  sideAction(remoteDir.row, "选择路径", () => p.chooseRemoteDirectory(p.state.settings, remoteDir.input()));
  remoteSetting(() => { const rclone = text("rclone 路径", "rcloneExe", "留空时使用插件 tools 目录中的 rclone.exe。"); picker(rclone.row, rclone.input, false); });
  remoteControls.hidden = !(s.remoteEnabled ?? false);

  heading("播放器与弹幕");
  toggle("优先官方番剧弹幕", "biliOfficialFirst", true, "匹配官方正版及港澳台来源，按当前网络可访问的分集获取。");
  el.createEl("p", { text: "弹弹play可加载同名 XML 弹幕。其他播放器展示弹幕所需的扩展与配置，请参照对应播放器说明。", cls: "setting-item-description" });
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
  toggle("播放前校准弹幕", "calibrateDanmaku", true, "", (value) => { dependency.hidden = !value; });
  const dependency = el.createDiv("al-settings-dependency");
  const dependencyStatus = new Setting(dependency).setName("依赖状态").setDesc("播放前校准弹幕所需的依赖。");
  const installers = dependency.createDiv("al-actions al-calibration-installers");
  const install = {
    python: button(installers, "安装 Python", () => p.openWebsite("https://www.python.org/downloads/windows/")),
    numpy: button(installers, "安装 NumPy", () => p.run(async () => {
      if (!(await p.calibrationDependencies()).python) throw Error("未找到 Python，请先安装 Python 后重新打开 Obsidian");
      await p.installCalibrationNumpy();
      await inspect();
    })),
    ffmpeg: button(installers, "安装 FFmpeg", () => p.openWebsite("https://ffmpeg.org/download.html")),
  };
  for (const control of Object.values(install)) control.hidden = true;
  const inspect = async () => {
    const ready = await p.calibrationDependencies();
    dependencyStatus.setDesc(`Python：${ready.python ? "已就绪" : "未找到"}；NumPy：${ready.numpy ? "已就绪" : "未安装"}；FFmpeg：${ready.ffmpeg ? "已就绪" : "未找到"}。`);
    for (const [key, control] of Object.entries(install)) control.hidden = ready[key];
    installers.hidden = Object.values(install).every((control) => control.hidden);
  };
  dependencyStatus.addButton((b) => b.setButtonText("检查依赖").onClick(() => p.run(inspect)));
  dependency.hidden = !(s.calibrateDanmaku ?? true);
  dependencyStatus.setDesc("点击检查依赖以查看状态。");

  heading("bilibili");
  p.biliAccountPanel(el);
  new Setting(el).setName("屏蔽词库").addButton((b) => b.setButtonText("同步屏蔽词库").onClick(() => p.run(() => p.syncBiliFilters())));
  const uploaders = text("弹幕来源 UP 主 UID", "biliUploaders", "多个 UID 用英文逗号分隔。");
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
      } catch (error) {
        if (generation === uploaderGeneration) profile.setText("UID " + uid + " · " + error.message);
      }
    }));
  };
  uploaders.input().addEventListener("change", () => { void renderUploaders(); });
  void renderUploaders();


  const communityStart = el.children.length;
  for (const [kind, name, text, icon] of [["sponsor", "赞助与支持", "打开赞助面板", "heart"], ["feedback", "问题反馈", "打开反馈面板", "message-square-warning"]]) {
    new Setting(el).setName(name).addButton((b) => b.setButtonText(text).setIcon(icon).onClick(() =>
      new Panel(p, name, (body) => {
        body.parentElement.addClass("al-community-modal");
        body.createEl("img", { attr: { src: communityImages[kind], alt: name }, cls: "al-community-image" });
        new Setting(body).setName("作者GitHub主页").addButton((link) => link.setButtonText("打开GitHub").setIcon("github").onClick(() => shell.openExternal("https://github.com/beimohai")));
        new Setting(body).setName("作者B站主页").addButton((link) => link.setButtonText("打开B站").setIcon("external-link").onClick(() => shell.openExternal("https://space.bilibili.com/1065768987")));
        if (kind === "feedback") new Setting(body).setName("问题反馈").addButton((link) => link.setButtonText("打开 GitHub Issues").setIcon("message-square-warning").onClick(() => shell.openExternal("https://github.com/beimohai/AniLink-Obsidian/issues")));
      }).open(),
    ));
  }
  const pageHeader = [...el.children].find((node) => node.classList.contains("setting-item-heading") && node.textContent === "页面设置");
  for (const node of [...el.children].slice(communityStart)) el.insertBefore(node, pageHeader);
  for (const control of el.querySelectorAll(".al-setting-has-side-action .setting-item-control")) {
    const action = control.querySelector("button");
    if (action) control.prepend(action);
  }
  const footer = el.createDiv("al-plugin-footer");
  const logo = new DOMParser().parseFromString(ANI_ICON, "image/svg+xml").documentElement;
  footer.createDiv("al-plugin-footer-logo").appendChild(document.importNode(logo, true));
  const details = footer.createDiv("al-plugin-footer-details");
  for (const label of ["AniLink", "作者：北漠海", "版本号：" + p.manifest.version, "更新日期：2026-11-14"]) details.createDiv({ text: label });
  footer.createDiv({ text: "本项目基于 MIT License 开源", cls: "al-plugin-footer-license" });
  const authorLinks = el.createDiv("al-author-links");
  for (const [name, label, icon, url] of [
    ["作者GitHub主页", "打开GitHub", "github", "https://github.com/beimohai"],
    ["作者B站主页", "打开B站", "external-link", "https://space.bilibili.com/1065768987"],
  ]) new Setting(authorLinks).setName(name).addButton((control) => control.setButtonText(label).setIcon(icon).onClick(() => shell.openExternal(url)));
  el.insertBefore(authorLinks, footer);
};

const settingsOnlyDashboardRender = Dashboard.prototype.render;
Dashboard.prototype.render = function () {
  settingsOnlyDashboardRender.call(this);
  const toolbar = this.contentEl.querySelector(".al-top > .al-actions");
  for (const control of toolbar?.querySelectorAll("button") || [])
    if (control.textContent === "连接配置") control.remove();
};
