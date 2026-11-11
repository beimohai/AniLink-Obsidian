// API clients for independently installed upstream services; no upstream source is bundled.
class AniRssClient {
  constructor(p) {
    this.p = p;
  }
  async call(endpoint, body = {}, method = "POST") {
    const s = this.p.state.settings;
    if (!s.aniKey) throw Error("ANI-RSS 尚未连接，请打开追番后端配置");
    const r = await this.p.http.json(
      C.baseUrl(s.aniUrl || "http://127.0.0.1:7789") + "/api/" + endpoint,
      method,
      body,
      { "api-key": s.aniKey },
    );
    if (r.code !== 200) throw Error("ANI-RSS：" + (r.message || r.code));
    return r.data;
  }
  list() {
    return this.call("listAni");
  }
  parse(show, sub) {
    return this.call("rssToAni", {
      url: sub.feed,
      type: "mikan",
      bgmUrl: `https://bgm.tv/subject/${show.id}`,
      subgroup: sub.sourceGroup || sub.group,
      enable: false,
    });
  }
  async install(show, sub) {
    const ani = await this.parse(show, sub);
    const rule = C.buildRule(show, sub);
    Object.assign(ani, {
      enable: !!sub.enabled,
      title: show.title,
      jpTitle: show.name,
      bgmUrl: `https://bgm.tv/subject/${show.id}`,
      customDownloadPath: true,
      customDownloadPathTemplate: sub.savePath,
      match: [rule.mustContain],
      exclude: [rule.mustNotContain],
      downloadNew: false,
    });
    if (sub.backendId) ani.id = sub.backendId;
    await this.call(sub.backendId ? "setAni" : "addAni", ani);
    return { backend: "ani", backendId: ani.id };
  }
  enable(id, value) {
    return this.call("batchEnable?value=" + value, [id]);
  }
  remove(id) {
    return this.call("deleteAni?deleteFiles=false", [id]);
  }
}
class AutoBangumiClient {
  constructor(p) {
    this.p = p;
  }
  async call(endpoint, body, method = body === undefined ? "GET" : "POST") {
    const s = this.p.state.settings;
    if (!s.abToken) throw Error("AutoBangumi 尚未连接，请打开追番后端配置");
    const r = await this.p.http.json(
      C.baseUrl(s.abUrl || "http://127.0.0.1:7892") + "/api/v1/" + endpoint,
      method,
      body,
      { Authorization: "Bearer " + s.abToken },
    );
    if (r?.status === false)
      throw Error("AutoBangumi：" + (r.msg_zh || r.msg_en || "操作失败"));
    return r;
  }
  list() {
    return this.call("rss");
  }
  parse(show, sub) {
    return this.call("rss/analysis", {
      url: sub.feed,
      name: show.title,
      aggregate: false,
      parser: "mikan",
    });
  }
  async install(show, sub) {
    if (!sub.enabled)
      throw Error(
        "AutoBangumi 的订阅接口会立即补历史集，不能当作暂停草稿保存。请先解析预览，再在其管理页确认订阅。",
      );
    // Native RSS add starts enabled on the upstream API. Explicit subscription
    // creates a per-show rule; pause before publishing it when saving a draft.
    const data = await this.parse(show, sub);
    const rule = C.buildRule(show, sub);
    Object.assign(data, {
      official_title: show.title,
      save_path: sub.savePath,
      filter: rule.mustNotContain,
      rss_link: sub.feed,
    });
    await this.call("rss/subscribe", {
      data,
      rss: {
        url: sub.feed,
        name: show.title,
        aggregate: false,
        parser: "mikan",
        enabled: !!sub.enabled,
      },
    });
    const rss = (await this.list()).find((r) => r.url === sub.feed);
    if (!rss) throw Error("AutoBangumi 未返回新订阅");
    if (!sub.enabled) await this.enable(rss.id, false);
    return { backend: "ab", backendId: rss.id };
  }
  enable(id, value) {
    return this.call(
      value ? "rss/enable/many" : `rss/disable/${id}`,
      value ? [id] : undefined,
      value ? "POST" : "PATCH",
    );
  }
  remove(id) {
    return this.call(`rss/delete/${id}`, undefined, "DELETE");
  }
}
AniLink.prototype.ani = function () {
  return new AniRssClient(this);
};
AniLink.prototype.ab = function () {
  return new AutoBangumiClient(this);
};
AniLink.prototype.updateSubscriptionRule = async function (s, sub) {
  if (sub.backend === "ani" && sub.backendId)
    return this.ani().enable(sub.backendId, !!sub.enabled);
  if (sub.backend === "ab" && sub.backendId)
    return this.ab().enable(sub.backendId, !!sub.enabled);
  return this.qb().setRule(s, sub);
};
AniLink.prototype.removeManagedSubscription = async function (s) {
  const sub = s.subscription;
  if (sub.backend === "ani" && sub.backendId)
    await this.ani().remove(sub.backendId);
  else if (sub.backend === "ab" && sub.backendId)
    await this.ab().remove(sub.backendId);
  await this.qb().removeSubscription(s);
};
AniLink.prototype.installSubscription = async function (s, sub) {
  await this.ensureDownloader();
  const backend = sub.backend || this.state.settings.defaultBackend || "native";
  if (backend === "native") {
    await this.qb().install(s, sub);
    delete s.rssError;
    delete s.ruleError;
    return;
  }
  if (sub.feed !== s.subscription.feed && s.subscription.backendId)
    throw Error("请先移除旧订阅，再更换来源");
  const native = { ...sub, enabled: false };
  await this.qb().install(s, native);
  const result = await (backend === "ani" ? this.ani() : this.ab()).install(
    s,
    sub,
  );
  Object.assign(sub, result);
  delete s.rssError;
  delete s.ruleError;
};
AniLink.prototype.backendModal = function () {
  new Panel(this, "追番后端", (el, m) => {
    el.createEl("p", {
      text: "每部番剧由一个后端管理。ANI-RSS 提供订阅、备用源和洗版；AutoBangumi 提供解析、整理和媒体库功能。",
    });
    const preferred = select(
      el,
      "新订阅默认后端",
      this.state.settings.defaultBackend || "native",
      { ani: "ANI-RSS", ab: "AutoBangumi", native: "qBittorrent 原生 RSS" },
    );
    button(el, "保存默认后端", () =>
      this.run(async () => {
        this.state.settings.defaultBackend = preferred.value;
        await this.persist();
        new Notice("默认后端已保存");
      }),
    );
    const result = el.createDiv();
    button(
      el,
      "检测本机并导入连接",
      () =>
        this.run(async () => {
          const connection = JSON.parse(
            await fs.readFile(
              "D:\\Application\\AniLink-services\\connection.json",
              "utf8",
            ),
          );
          const credentials = { ...connection };
          delete credentials.defaultBackend;
          Object.assign(this.state.settings, credentials);
          await this.persist();
          result.empty();
          for (const [label, client] of [
            ["ANI-RSS", this.ani()],
            ["AutoBangumi", this.ab()],
          ])
            try {
              await client.list();
              result.createEl("p", { text: `${label} 已连接` });
            } catch (e) {
              result.createEl("p", { text: e.message });
            }
        }),
      "mod-cta",
    );
    button(el, "内嵌 ANI-RSS 完整管理页面", () =>
      this.webPanel(
        "ANI-RSS",
        this.state.settings.aniUrl || "http://127.0.0.1:7789",
      ),
    );
    button(el, "内嵌 AutoBangumi 完整管理页面", () =>
      this.webPanel(
        "AutoBangumi",
        this.state.settings.abUrl || "http://127.0.0.1:7892",
      ),
    );
    button(el, "本机后台登录信息", () =>
      this.run(async () => {
        const c = JSON.parse(
          await fs.readFile(
            "D:\\Application\\AniLink-services\\credentials.json",
            "utf8",
          ),
        );
        new Panel(this, "本机后台账号", (body) => {
          for (const [name, value] of Object.entries(c)) {
            field(body, name + " 用户名", value.username);
            field(body, name + " 密码", value.password, "password");
          }
        }).open();
      }),
    );
    for (const s of this.state.shows.filter((s) => s.subscription.feed)) {
      const row = el.createDiv("al-result");
      row.createEl("strong", { text: s.title });
      row.createEl("p", {
        text: `当前：${s.subscription.backend || "native"} · ${s.subscription.enabled ? "启用" : "暂停"}`,
      });
      for (const [key, label] of [
        ["ani", "ANI-RSS"],
        ["ab", "AutoBangumi"],
      ])
        button(row, "用 " + label + " 解析 RSS", () =>
          this.run(async () => {
            const data = await (key === "ani" ? this.ani() : this.ab()).parse(
              s,
              s.subscription,
            );
            new Panel(this, label + " 解析结果", (body) =>
              body.createEl("pre", { text: JSON.stringify(data, null, 2) }),
            ).open();
          }),
        );
      button(row, "交给默认后端管理", () =>
        this.run(async () => {
          if (s.subscription.backendId)
            throw Error("此订阅已由后端管理，换后端前请先移除订阅");
          const sub = {
            ...s.subscription,
            backend: preferred.value,
            enabled: false,
            backendId: undefined,
          };
          await this.installSubscription(s, sub);
          s.subscription = sub;
          await this.persist();
          new Notice("后端订阅已建立，保持暂停；可在订阅页启用");
        }),
      );
    }
  }).open();
};
