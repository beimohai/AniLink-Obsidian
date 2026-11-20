const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('startup notifications default on and quiet persistent notices remain safe to update',()=>{
 class AniLink{};const notices=[];
 vm.runInNewContext(fs.readFileSync('src/notifications.js','utf8'),{AniLink,Notice:class{constructor(message,duration){notices.push({message,duration});}}});
 const p=new AniLink();p.state={settings:{}};p.notify('startup','loaded');assert.equal(notices.length,1);
 p.state.settings.startupNotifications=false;p.notify('startup','loaded');assert.equal(notices.length,1);
 p.state.settings.playbackNotifications=false;const notice=p.notify('playback','preparing',0);notice.setMessage('ready');notice.hide();assert.equal(notices.length,1);
 p.notify('progress','watched');assert.equal(notices.length,2);
});
