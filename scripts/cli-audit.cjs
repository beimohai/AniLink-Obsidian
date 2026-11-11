"use strict";
const fs = require("fs"),
  cp = require("child_process"),
  path = require("path");
const vault = process.env.ANILINK_TEST_VAULT || "Obsidian_test";
const cli = (body) => {
  const code = `(async()=>{const p=app.plugins.plugins.anilink;if(!p)throw Error('AniLink 未启用');const s=p.state.shows.find(s=>s.id===665390);${body}})()`;
  const out = cp.execFileSync(
    "obsidian",
    [`vault=${vault}`, "eval", `code=${code}`],
    { encoding: "utf8", windowsHide: true, timeout: 120000 },
  );
  const text = out.slice(out.indexOf("=> ") + 3).trim();
  try {
    return JSON.parse(text);
  } catch {
    throw Error(text.slice(0, 500));
  }
};
const report = [];
function stage(name, body) {
  const start = Date.now();
  try {
    const result = cli(body);
    report.push({ name, ok: true, milliseconds: Date.now() - start, result });
    console.log("PASS " + name);
  } catch (e) {
    report.push({ name, ok: false, error: e.message });
    console.error("FAIL " + name + ": " + e.message);
  }
}
stage(
  "runtime",
  `return JSON.stringify({version:p.manifest.version,busy:p.busy,queued:p.state.queue.length,subjectExists:!!s});`,
);
stage(
  "search UI",
  `p.searchModal();const m=[...document.querySelectorAll('.al-modal')].at(-1);m.querySelector('input').value='665390';await [...m.querySelectorAll('button')].find(b=>b.textContent==='搜索').onclick();const card=m.querySelector('.al-search-card');if(!card?.textContent.includes('665390'))throw Error('搜索结果缺失');const result={cards:m.querySelectorAll('.al-search-card').length,containsSeason:card.textContent.includes('第二季')};for(const modal of p.panels||[])if(modal.title==='搜索番剧')modal.close();return JSON.stringify(result);`,
);
stage(
  "source and release matching",
  `if(!s)throw Error('测试番剧不存在');const sources=await p.findSources(s,'冰之城墙');const group=sources.flatMap(x=>x.groups).find(x=>x.name.includes('LoliHouse'));if(!group)throw Error('字幕组不存在');const releases=await p.readFeed(group.feed);const sample=releases.find(r=>r.title.includes(' - 20 '));if(!sample)throw Error('测试资源不存在');return JSON.stringify({groups:sources.flatMap(x=>x.groups).length,releases:releases.length,feedVerified:true,hasEpisode20:true});`,
);
stage(
  "download and actual local files",
  `await p.refresh(false);const f=s.episodes.flatMap(e=>e.files||[]).find(f=>f.progress===1&&f.localExists);if(!f)throw Error('没有已完成的本地测试文件');const st=await require('fs/promises').stat(f.path);if(st.size<1000000)throw Error('测试视频不完整');return JSON.stringify({bytes:st.size,localExists:f.localExists,completed:!!f.completedAt,watched:s.episodes.filter(e=>e.watched).length});`,
);
stage(
  "single subject remote comparison",
  `const prior=s.remoteConflict;const snapshot=await p.inspectRemoteShow(s);const result={status:snapshot.status,watched:Object.values(snapshot.episodeStates).filter(Boolean).length,rate:snapshot.rate};s.remoteConflict=prior;await p.persist();return JSON.stringify(result);`,
);
stage(
  "review draft retention",
  `await p.open();p.focusShow(s);const v=app.workspace.getLeavesOfType('anilink-dashboard')[0].view;const prior=v.reviewDrafts?.[s.id];v.tab='review';v.render();const input=v.contentEl.querySelector('textarea');const original=input.value;input.value='CLI 本地草稿检查，不提交';input.oninput();v.tab='episodes';v.render();v.tab='review';v.render();const kept=v.contentEl.querySelector('textarea').value==='CLI 本地草稿检查，不提交';if(prior)v.reviewDrafts[s.id]=prior;else delete v.reviewDrafts[s.id];v.tab='episodes';v.render();if(!kept)throw Error('草稿丢失');return JSON.stringify({retained:kept,submitted:false,originalLength:original.length});`,
);
stage(
  "layout and scroll independence",
  `const v=app.workspace.getLeavesOfType('anilink-dashboard')[0].view;p.focusShow(s);const root=v.contentEl;const left=root.querySelector('.al-cards'),right=root.querySelector('.al-tab-body'),header=root.querySelector('.al-top');const start=header.getBoundingClientRect().top;right.scrollTop=0;left.scrollTop=500;const result={columns:getComputedStyle(left).gridTemplateColumns.split(' ').length,leftScrolled:left.scrollTop>0,rightScroll:right.scrollTop,headerStayed:header.getBoundingClientRect().top===start,horizontalOverflow:root.scrollWidth>root.clientWidth+2,statusButtons:root.querySelectorAll('.al-status-buttons button').length};if(!result.headerStayed||result.horizontalOverflow||result.rightScroll!==0)throw Error(JSON.stringify(result));return JSON.stringify(result);`,
);
if (process.argv.includes("--write-unchanged")) {
  stage(
    "real status button push (unchanged)",
    `const before={status:s.status,rate:s.rate,comment:s.comment||'',private:!!s.private};await p.changeStatus(s,s.status);const me=await p.bgm().call('/v0/me'),r=await p.bgm().call('/v0/users/'+encodeURIComponent(me.username)+'/collections/'+s.id);if(r.type!==before.status||r.rate!==before.rate||(r.comment||'')!==before.comment||!!r.private!==before.private)throw Error('远端值与原记录不符');return JSON.stringify({type:r.type,rate:r.rate,queue:p.state.queue.length});`,
  );
  stage(
    "real review submit (unchanged)",
    `const v=app.workspace.getLeavesOfType('anilink-dashboard')[0].view;v.tab='review';v.render();await [...v.contentEl.querySelectorAll('button')].find(b=>b.textContent==='保存并同步评价').onclick();v.tab='episodes';v.render();return JSON.stringify({queue:p.state.queue.length,rate:s.rate,submittedUnchanged:true});`,
  );
}
if (process.argv.includes("--play"))
  stage(
    "actual player launch",
    `const e=s.episodes.find(e=>e.files?.some(f=>f.progress===1&&f.localExists));if(!e)throw Error('没有可播放文件');const before=s.episodes.filter(e=>e.watched).length;await p.play(s,e,e.files.find(f=>f.progress===1&&f.localExists));return JSON.stringify({episode:e.ep,progressUnchanged:before===s.episodes.filter(e=>e.watched).length});`,
  );
fs.mkdirSync("test-results", { recursive: true });
fs.writeFileSync(
  path.join("test-results", "cli-audit.json"),
  JSON.stringify(
    { testedAt: new Date().toISOString(), vault, report },
    null,
    2,
  ),
);
if (report.some((r) => !r.ok)) process.exitCode = 1;
