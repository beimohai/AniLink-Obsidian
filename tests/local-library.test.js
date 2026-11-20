const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const vm=require('node:vm');
const C=require('../core');
async function fixture(t) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'anilink-library-'));
 t.after(async()=>{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep+'anilink-library-'));await fs.rm(root,{recursive:true,force:true});});
 class AniLink {}
 AniLink.prototype.showFolder=async(show,library)=>path.join(library,show.title);
 vm.runInNewContext(await fs.readFile('src/local-library.js','utf8'),{AniLink,C,fs,path,process,Notice:class{}});
 const p=new AniLink();p.state=C.defaults();p.state.settings.libraryRoot=root;
 p.persist=async()=>{};p.redraw=()=>{};p.updateEpisodes=async()=>{};p.scanLocalVideos=async()=>{};
 return {p,root};
}
test('local libraries require manual association and keep conditional root deduplication',async(t)=>{
 const {p,root}=await fixture(t);
 assert.equal(p.discoverLocalLibrary,undefined);
 p.state.settings.extraLibraryRoots=[root,root,path.join(root,'other')];
 assert.equal(p.libraryRoots().length,1);
 p.state.settings.multiLibraryEnabled=true;
 assert.equal(p.libraryRoots().length,2);
 await assert.rejects(p.attachLocalLibrary({id:1},path.join(root,'Anime'),3),/访问令牌/);
});
test('manual association collects the selected Bangumi subject before enabling its directory',async(t)=>{
 const {p,root}=await fixture(t);const folder=path.join(root,'Anime');await fs.mkdir(folder);
 p.state.settings.bgmToken='fixture';const writes=[];
 p.bgm=()=>({call:async(url,method,body)=>{
  if(url==='/v0/me')return {username:'fixture'};
  if(method==='POST'){writes.push({url,body});return {};}
  throw Error('HTTP 404');
 }});
 await p.attachLocalLibrary({id:123,name:'Anime'},folder,3);
 assert.equal(writes.length,1);
 assert.equal(writes[0].body.type,3);
 assert.equal(p.state.shows[0].status,3);
 assert.equal(p.state.shows[0].localLibraryPath,folder);
 assert.equal(p.state.queue.length,0);
});
test('failed Bangumi collection never enables local directory',async(t)=>{
 const {p,root}=await fixture(t);const folder=path.join(root,'Anime');await fs.mkdir(folder);
 p.state.settings.bgmToken='fixture';p.bgm=()=>({call:async(url,method)=>{if(url==='/v0/me')return {username:'fixture'};throw Error(method==='POST'?'write failed':'HTTP 404');}});
 await assert.rejects(p.attachLocalLibrary({id:123,name:'Anime'},folder,3),/write failed/);
 assert.equal(p.state.shows.length,0);
});
