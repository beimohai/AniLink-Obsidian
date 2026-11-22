const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(){
 class AniLink{};AniLink.prototype.updateEpisodes=async()=>{};
 class Dashboard{};Dashboard.prototype.renderCards=function(){this.rendered=this.p.state.shows.map(s=>({id:s.id,title:s.title,cover:s.cover}));};Dashboard.prototype.renderDetail=()=>{};
 vm.runInNewContext(fs.readFileSync('src/display-metadata.js','utf8'),{AniLink,Dashboard,C:{},URL});
 const p=new AniLink();p.state={settings:{},hiddenShows:[],shows:[{id:1,title:'Canonical',name:'Original',cover:'https://lain.bgm.tv/cover.jpg',displayMetadata:{title:'Fanku title',cover:'https://assets.fankuhub.cn/i/anime/one/cover.webp',source:'fanku'}}]};
 const v=new Dashboard();v.p=p;return {p,v};
}
test('legacy Fanku preference restores canonical Bangumi metadata',()=>{
 const {p,v}=fixture();p.state.settings.animeDataSource='fanku';v.renderCards({});assert.equal(v.rendered[0].title,'Canonical');assert.equal(p.state.shows[0].title,'Canonical');
});
test('cover mirrors follow the data flag independently of the API flag',()=>{
 const {p,v}=fixture();Object.assign(p.state.settings,{bgmMirror:true,bgmMirrorApi:false,bgmMirrorData:true});v.renderCards({});assert.equal(v.rendered[0].cover,'https://lain.bgm.lat/cover.jpg');p.state.settings.bgmMirrorData=false;v.renderCards({});assert.equal(v.rendered[0].cover,'https://lain.bgm.tv/cover.jpg');
});
test('removed associations stay hidden after field records restore their metadata',()=>{
 const {p,v}=fixture();p.state.hiddenShows=[1];v.renderCards({});assert.equal(v.rendered.length,0);assert.equal(p.state.shows.length,1);
});

test('isolated cover requests are shared and reject non-image responses',async()=>{
 class AniLink{};class Dashboard{};Dashboard.prototype.renderCards=()=>{};Dashboard.prototype.renderDetail=()=>{};AniLink.prototype.updateEpisodes=async()=>{};
 let calls=0;
 const transport=async()=>{calls++;return {status:200,headers:{get:()=> 'image/webp'},arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer};};
 vm.runInNewContext(fs.readFileSync('src/display-metadata.js','utf8'),{AniLink,Dashboard,C:{},URL,Blob,Platform:{isDesktop:true},window:{setTimeout,clearTimeout},desktop:{remote:{session:{fromPartition:()=>({fetch:transport})}}}});
 const p=new AniLink();p.register=()=>{};
 const url='https://assets.fankuhub.cn/i/anime/fixture/cover.webp';
 const first=p.loadCoverImage(url),second=p.loadCoverImage(url);
 assert.equal(first,second);
 const value=await first;assert.ok(value.startsWith('blob:'));assert.equal(calls,1);
 URL.revokeObjectURL(value);
 await assert.rejects(p.loadCoverImage('https://example.com/cover.jpg'),/不支持/);
});
