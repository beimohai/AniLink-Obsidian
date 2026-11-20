// Each navigation owns its events and timers, including delayed recovery.
Dashboard.prototype.bindInformationPreview = function (page, isActive, retry) {
  const guest = page.guest;
  guest.dataset.previewBound = "1";
  let timeout, recovery;
  const listeners = [];
  const current = () => page.guest === guest && guest.isConnected;
  const listen = (name, handler) => {
    guest.addEventListener(name, handler);
    listeners.push([name, handler]);
  };
  const pending = () => {
    guest.classList.add("al-preview-unavailable");
    page.loading.textContent = "加载中…";
    page.loading.hidden = !isActive();
  };
  const fail = (reason, recover = false) => {
    if (!current() || page.failed) return;
    window.clearTimeout(timeout);
    page.failed = true;
    page.ready = false;
    guest.classList.add("al-preview-unavailable");
    page.loading.textContent = "预览加载失败，可重新点击当前页面重试。";
    page.loading.hidden = !isActive();
    C.record(this.p.state, `网页预览 ${page.url} · ${reason}`);
    this.p.persist();
    if (recover && isActive() && !page.recoveryAttempted) {
      page.recoveryAttempted = true;
      recovery = window.setTimeout(() => {
        if (current() && page.failed && isActive())
          retry().catch((error) => new Notice(error.message));
      }, 500);
    }
  };
  const watch = () => {
    window.clearTimeout(timeout);
    timeout = window.setTimeout(() => {
      if (current() && !page.ready && !page.failed) fail("加载超过 30 秒", true);
    }, 30000);
  };
  const ready = () => {
    if (!current() || page.failed) return;
    if (guest.tagName === "WEBVIEW") {
      try { if (!guest.getURL() || guest.getURL() === "about:blank") return; }
      catch { return; }
    }
    window.clearTimeout(timeout);
    page.ready = true;
    page.loading.hidden = true;
    guest.classList.remove("al-preview-unavailable");
  };
  listen("did-start-loading", () => {
    if (!current()) return;
    page.failed = false;
    if (!page.ready) pending();
    watch();
  });
  listen(guest.tagName === "IFRAME" ? "load" : "did-finish-load", ready);
  listen("error", () => fail("网页加载错误"));
  listen("render-process-gone", (event) => fail(event.reason || event.details?.reason || "预览进程退出", true));
  listen("did-fail-load", (event) => {
    if (event.errorCode !== -3 && event.isMainFrame !== false)
      fail(`${event.errorCode} ${event.errorDescription}`);
  });
  pending();
  watch();
  page.dispose = () => {
    window.clearTimeout(timeout);
    window.clearTimeout(recovery);
    for (const [name, handler] of listeners) guest.removeEventListener(name, handler);
  };
  this.register(page.dispose);
};
