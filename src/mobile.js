// Mobile uses Obsidian storage and Bangumi without loading desktop services.
class MobileAniLink extends Plugin {
  async onload() {
    this.document = await this.loadData();
    this.state = this.document?.state || this.document || C.defaults();
    this.state.settings ||= {};
    this.state.shows ||= [];
    this.mobileBaseline = DeviceModel.project(this.state);
    this.mobileDeviceId = window.localStorage.getItem("anilink-mobile-device") || "mobile-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    window.localStorage.setItem("anilink-mobile-device", this.mobileDeviceId);
    this.http = new C.Http(requestUrl);
    this.registerView(VIEW, (leaf) => new MobileDashboard(leaf, this));
    this.addRibbonIcon("tv", "打开 AniLink", () => this.open());
    this.addCommand({ id: "open", name: "打开", callback: () => this.open() });
    const plugin = this;
    this.addSettingTab(new class extends PluginSettingTab {
      display() {
        this.containerEl.empty();
        new Setting(this.containerEl).setName("Bangumi 访问令牌").addText((input) => input.setValue(plugin.state.settings.bgmToken || "").onChange(async (value) => { plugin.state.settings.bgmToken = value.trim(); await plugin.persistMobile(); }));
        new Setting(this.containerEl).setName("使用镜像网站").addToggle((input) => input.setValue(!!plugin.state.settings.bgmMirror).onChange(async (value) => { plugin.state.settings.bgmMirror = value; await plugin.persistMobile(); }));
        new Setting(this.containerEl).setName("同步收藏与进度").addButton((control) => control.setButtonText("同步").onClick(() => plugin.syncMobile()));
      }
    }(this.app, this));
  }
  bgm() { return new C.Bangumi(this.http, this.state.settings.bgmToken, this.state.settings.bgmMirror ? "https://api.bangumi.lat" : "https://api.bgm.tv"); }
  async persistMobile() {
    if (this.document?.storage === "vault") {
      this.document.state = this.state;
      this.document.records = DeviceModel.capture(this.document.records || {}, this.mobileBaseline, DeviceModel.project(this.state), this.mobileDeviceId);
      this.mobileBaseline = DeviceModel.project(this.state);
      await this.saveData(this.document);
    } else await this.saveData(this.state);
  }
  async open() {
    const leaf = this.app.workspace.getLeavesOfType(VIEW)[0] || this.app.workspace.getLeaf("tab");
    await leaf.setViewState({ type: VIEW, active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
  async syncMobile() {
    try {
      const bgm = this.bgm();
      const me = await bgm.call("/v0/me");
      const rows = await bgm.pages(`/v0/users/${encodeURIComponent(me.username)}/collections?subject_type=2`);
      for (const row of rows) {
        let show = this.state.shows.find((item) => item.id === row.subject_id);
        if (!show) { show = C.newShow(row.subject); this.state.shows.push(show); }
        Object.assign(show, { status: row.type, rate: row.rate || 0, comment: row.comment || "", private: !!row.private });
      }
      await this.persistMobile();
      for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) await leaf.view.render();
      new Notice("收藏已同步");
    } catch (error) { new Notice(error.message); }
  }
}
class MobileDashboard extends ItemView {
  constructor(leaf, plugin) { super(leaf); this.p = plugin; }
  getViewType() { return VIEW; }
  getDisplayText() { return "AniLink"; }
  getIcon() { return "tv"; }
  async onOpen() { await this.render(); }
  async render() {
    const el = this.contentEl;
    el.empty();
    el.addClass("al-mobile-dashboard");
    const top = el.createDiv("al-actions");
    button(top, "同步", () => this.p.syncMobile());
    const query = field(el, "搜索番剧", "");
    const results = el.createDiv();
    button(el, "搜索", async () => {
      try {
        const response = await this.p.bgm().search(query.value.trim());
        results.empty();
        for (const subject of response.data || []) {
          new Setting(results).setName(subject.name_cn || subject.name).addButton((control) => control.setButtonText("加入想看").onClick(async () => {
            try {
              await this.p.bgm().call(`/v0/users/-/collections/${subject.id}`, "POST", { type: 1 });
              let show = this.p.state.shows.find((item) => item.id === subject.id);
              if (!show) { show = C.newShow(subject); this.p.state.shows.push(show); }
              show.status = 1;
              await this.p.persistMobile();
              await this.render();
            } catch (error) { new Notice(error.message); }
          }));
        }
      } catch (error) { new Notice(error.message); }
    });
    for (const show of this.p.state.shows) {
      const row = el.createDiv("al-mobile-show");
      const open = button(row, show.title, () => this.show(show));
      open.addClass("al-mobile-show-title");
      row.createSpan({ text: C.STATUS[show.status] || "未收藏" });
    }
  }
  async show(show) {
    const el = this.contentEl;
    el.empty();
    button(el, "返回书架", () => this.render());
    el.createEl("h2", { text: show.title });
    const status = select(el, "收藏状态", String(show.status), C.STATUS);
    const rate = select(el, "评分", String(show.rate || 0), Object.fromEntries(Array.from({ length: 11 }, (_, index) => [index, index ? index + "分" : "未评分"])));
    const comment = field(el, "短评", show.comment, "textarea");
    button(el, "保存评价", async () => {
      try {
        const payload = { type: Number(status.value), rate: Number(rate.value), comment: comment.value, private: !!show.private };
        await this.p.bgm().call(`/v0/users/-/collections/${show.id}`, "POST", payload);
        Object.assign(show, { status: payload.type, rate: payload.rate, comment: payload.comment });
        await this.p.persistMobile();
        new Notice("评价已同步");
      } catch (error) { new Notice(error.message); }
    });
    const list = el.createDiv("al-mobile-episodes");
    try {
      const episodes = await this.p.bgm().pages(`/v0/users/-/collections/${show.id}/episodes`);
      for (const entry of episodes) {
        const episode = entry.episode;
        if (episode.type !== 0) continue;
        const row = new Setting(list).setName(`第${episode.sort}集 ${episode.name_cn || episode.name || ""}`);
        row.addToggle((toggle) => toggle.setValue(entry.type === 2).onChange(async (watched) => {
          try {
            await this.p.bgm().call(`/v0/users/-/collections/-/episodes/${episode.id}`, "PUT", { type: watched ? 2 : 0 });
            const local = show.episodes?.find((item) => item.id === episode.id);
            if (local) local.watched = watched;
            await this.p.persistMobile();
          } catch (error) { toggle.setValue(!watched); new Notice(error.message); }
        }));
      }
    } catch (error) { list.createEl("p", { text: error.message }); }
  }
}
