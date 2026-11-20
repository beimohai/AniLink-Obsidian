AniLink.prototype.notify = function (kind, message, duration) {
  const keys = { startup: "startupNotifications", playback: "playbackNotifications", progress: "progressNotifications", download: "downloadNotifications", refresh: "refreshNotifications", sync: "syncNotifications" };
  const fallback = kind !== "download";
  if ((this.state.settings[keys[kind]] ?? fallback) === false) return { hide() {}, setMessage() {} };
  return new Notice(message, duration);
};
