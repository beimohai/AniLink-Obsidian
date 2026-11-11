"use strict";
const clone = (v) => JSON.parse(JSON.stringify(v));
function project(state) {
  const out = {};
  for (const s of state.shows) {
    const root = `s:${s.id}:`;
    out[root + "meta"] = Object.fromEntries(
      ["id", "title", "name", "cover", "date", "total"]
        .filter((k) => s[k] !== undefined)
        .map((k) => [k, s[k]]),
    );
    for (const k of ["status", "rate", "comment", "private"])
      out[root + k] =
        s[k] ?? (k === "comment" ? "" : k === "private" ? false : 0);
    out[`h:${s.id}`] = (state.hiddenShows || []).includes(s.id);
    for (const e of s.episodes || []) {
      out[`e:${s.id}:${e.id}:meta`] = Object.fromEntries(
        ["id", "sort", "ep", "title", "type", "airdate"]
          .filter((k) => e[k] !== undefined)
          .map((k) => [k, e[k]]),
      );
      out[`e:${s.id}:${e.id}:watched`] = !!e.watched;
      out[`e:${s.id}:${e.id}:danmaku`] = e.danmaku
        ? Object.fromEntries(
            ["cid", "offset"]
              .filter((k) => e.danmaku[k] !== undefined)
              .map((k) => [k, e.danmaku[k]]),
          )
        : null;
    }
  }
  for (const id of state.hiddenShows || []) out[`h:${id}`] = true;
  return clone(out);
}
function valid(key, value) {
  if (/^h:\d+$/.test(key) || /^e:\d+:\d+:watched$/.test(key))
    return typeof value === "boolean";
  if (/^s:\d+:(status|rate)$/.test(key))
    return (
      Number.isFinite(value) &&
      (key.endsWith("status")
        ? value >= 0 && value <= 5
        : value >= 0 && value <= 10)
    );
  if (/^s:\d+:private$/.test(key)) return typeof value === "boolean";
  if (/^s:\d+:comment$/.test(key))
    return typeof value === "string" && value.length <= 100000;
  const fields = /^s:\d+:meta$/.test(key)
    ? ["id", "title", "name", "cover", "date", "total"]
    : /^e:\d+:\d+:meta$/.test(key)
      ? ["id", "sort", "ep", "title", "type", "airdate"]
      : /^e:\d+:\d+:danmaku$/.test(key)
        ? ["cid", "offset"]
        : null;
  return (
    !!fields &&
    (value === null
      ? key.endsWith(":danmaku")
      : typeof value === "object" &&
        !Array.isArray(value) &&
        Object.entries(value).every(
          ([k, v]) =>
            fields.includes(k) &&
            ["string", "number"].includes(typeof v) &&
            String(v).length <= 10000,
        ))
  );
}
function merge(...maps) {
  const out = {};
  for (const map of maps)
    for (const [key, r] of Object.entries(map || {})) {
      if (
        !r ||
        !Number.isSafeInteger(r.n) ||
        r.n < 1 ||
        !/^[a-f0-9]{32}$/.test(r.device) ||
        !valid(key, r.value)
      )
        continue;
      const old = out[key];
      if (!old || r.n > old.n || (r.n === old.n && r.device > old.device))
        out[key] = clone(r);
    }
  return out;
}
function capture(records, before, after, device) {
  const out = merge(records);
  let n = Math.max(0, ...Object.values(out).map((r) => r.n));
  for (const [key, value] of Object.entries(after))
    if (
      JSON.stringify(value) !== JSON.stringify(before[key]) &&
      valid(key, value)
    )
      out[key] = { n: ++n, device, value: clone(value) };
  return out;
}
function apply(state, records, makeShow) {
  for (const [key, r] of Object.entries(records)) {
    const match = key.match(/^s:(\d+):meta$/);
    if (match && !state.shows.some((s) => s.id === Number(match[1])))
      state.shows.push(
        makeShow(
          { ...r.value, id: Number(match[1]), name_cn: r.value.title },
          [],
        ),
      );
  }
  for (const [key, r] of Object.entries(records)) {
    const p = key.split(":"),
      s = state.shows.find((s) => s.id === Number(p[1]));
    if (p[0] === "h") {
      const ids = new Set(state.hiddenShows || []);
      if (r.value) ids.add(Number(p[1]));
      else ids.delete(Number(p[1]));
      state.hiddenShows = [...ids];
      continue;
    }
    if (!s) continue;
    if (p[0] === "s") {
      if (p[2] === "meta") Object.assign(s, r.value, { id: Number(p[1]) });
      else s[p[2]] = clone(r.value);
    }
    if (p[0] === "e" && p[3] === "meta") {
      let e = s.episodes.find((e) => e.id === Number(p[2]));
      if (!e) {
        e = { id: Number(p[2]), watched: false, files: [] };
        s.episodes.push(e);
      }
      Object.assign(e, r.value, { id: Number(p[2]) });
    }
  }
  for (const [key, r] of Object.entries(records)) {
    const p = key.split(":"),
      s = state.shows.find((s) => s.id === Number(p[1]));
    if (p[0] !== "e" || p[3] === "meta") continue;
    const e = s?.episodes.find((e) => e.id === Number(p[2]));
    if (e) e[p[3]] = clone(r.value);
  }
}
module.exports = { project, merge, capture, apply };
