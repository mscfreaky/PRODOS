'use strict';
import { LiveTransition, readerSettings, chapterTiming, PushGate, receiptMark } from './ui-state.js';
const $ = id => document.getElementById(id);
const ROLES = ['redaktion','moderation',...Array.from({length:8},(_,i)=>'camera'+(i+1))];
const baseLabel = r => ({regie:'Director',redaktion:'Editorial',moderation:'Presenter',all:'All roles',team:'Production team'})[r] || r.replace('camera','CAM ');
const label=r=>baseLabel(r)+(state?.roleNames?.[r]&&state.roleNames[r]!==baseLabel(r)?' · '+state.roleNames[r]:'');
const privatePage = location.pathname === '/production';
const token = location.hash.slice(1);
let state, role = privatePage?'regie':location.pathname.startsWith('/tally/')?'camera'+location.pathname.split('/')[2]:location.pathname.split('/')[2];
let online=false, busy=false, epoch=0, previousScript, previousQuestions, previousMessages, previousLinks, previousShow, serverBase=0, receivedAt=0;
const clientId=crypto.randomUUID(),liveTransition=new LiveTransition();
let flashTimer,reader,previousPlan,previousRequired,previousNames,pushTimer,pushChannel=false,pushQueue=[];
const pushGate=new PushGate();
function unread(m){return m.canAck;}
function jumpMessages(){document.body.classList.remove('reader-focus');$('focusMode').textContent='Reading mode';$('focusMode').setAttribute('aria-pressed','false');setChannel(false);$('messages').scrollIntoView({block:'center'});const first=$('messages').querySelector('.unread');if(first)$('messages').scrollTop=first.offsetTop-$('messages').offsetTop;else $('messages').scrollTop=$('messages').scrollHeight;}
$('newMessages').onclick=$('globalUnread').onclick=jumpMessages;
function setChannel(push){pushChannel=push&&role==='regie';$('pushPanel').hidden=!pushChannel;$('messages').hidden=pushChannel;$('chatForm').hidden=pushChannel;$('chatAttention').hidden=pushChannel;$('chatChannel').classList.toggle('selected',!pushChannel);$('pushChannel').classList.toggle('selected',pushChannel);}
$('chatChannel').onclick=()=>setChannel(false);$('pushChannel').onclick=()=>setChannel(true);
function showPush(d){
  if(role==='regie')return;
  if(pushGate.accept(d.id,d.pushNotice,d.serverTime)){
    pushQueue.push(d.pushNotice.text);if($('pushOverlay').hidden)nextPush();
  }
}
function nextPush(){
  if(!pushQueue.length)return;
  clearTimeout(flashTimer);$('liveFlash').hidden=true;
  $('pushOverlayText').textContent=pushQueue.shift();$('pushOverlay').hidden=false;
  pushTimer=setTimeout(()=>{$('pushOverlay').hidden=true;nextPush();},3000);
}
async function sendPush(text){if(await act('push',{text}))$('pushText').value='';}
$('pushForm').onsubmit=e=>{e.preventDefault();sendPush($('pushText').value);};
document.querySelectorAll('[data-push]').forEach(b=>b.onclick=()=>sendPush(b.dataset.push));
function loadReader(){try{reader=readerSettings(JSON.parse(localStorage.getItem('PRODOS.reader.'+role)||'{}'));}catch{reader=readerSettings();}renderReader();}
function renderReader(){
  $('readerFont').value=reader.font;$('readerLine').value=reader.line;$('readerWidth').value=reader.width;$('readerTheme').value=reader.theme;
  $('scriptPane').style.setProperty('--reader-font',reader.font+'px');$('scriptPane').style.setProperty('--reader-line',reader.line);$('scriptPane').style.setProperty('--reader-width',reader.width+'ch');$('scriptPane').dataset.theme=reader.theme;
}
function flashLive(){if(!$('pushOverlay').hidden)return;clearTimeout(flashTimer);$('liveFlash').hidden=false;flashTimer=setTimeout(()=>{$('liveFlash').hidden=true;},1000);}
const create=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const options=(select,entries)=>{select.replaceChildren(...entries.map(([value,name])=>{const op=create('option',name);op.value=value;return op;}));};
const fmt=ms=>{const seconds=Math.floor(Math.abs(ms)/1000);return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(n=>String(n).padStart(2,'0')).join(':');};
function notify(text){$('notice').textContent=text;}
async function request(url,data) {
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),url==='/production/preflight'?7000:4500);
  try {
    const response=await fetch(url,{method:data===undefined?'GET':'POST',headers:{'X-Client-Id':clientId,'X-Client-Visibility':document.visibilityState,...(token?{Authorization:'Bearer '+token}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data),cache:'no-store',signal:ctrl.signal});
    const result=await response.json();
    if(!response.ok)throw Object.assign(new Error(result.error||'HTTP '+response.status),{status:response.status});
    return result;
  } finally{clearTimeout(timer);}
}
async function act(action,data={}) {
  if(busy||!state||!online)return;
  busy=true;epoch++;
  try {const next=await request('/production/action',{...data,action,showId:state.id});apply(next);notify('Saved · '+new Date().toLocaleTimeString('en-GB'));return true;}
  catch(e){notify(e.message);if(e.status===401)disconnect(e);}
  finally{busy=false;}
}
function disconnect(error) {
  clearTimeout(pushTimer);pushQueue=[];$('pushOverlay').hidden=true;
  liveTransition.disconnect();clearTimeout(flashTimer);$('liveFlash').hidden=true;
  online=false;$('connection').textContent='● Connection lost';$('tally').className='tally offline';$('tally').textContent='⚠ CONNECTION LOST';
  $('atemStatus').textContent='No current data';$('clockLabel').textContent='TIMING NOT VERIFIED';$('clock').textContent='—';$('remaining').textContent='Reconnecting';
  $('remaining').classList.remove('time-value');
  notify(error.status ? error.message : 'Connection lost. Check the network and director PC.');
  document.querySelectorAll('button').forEach(b=>{if(!['scriptTab','questionsTab','jumpChapter','wake','focusMode'].includes(b.id))b.disabled=true;});
  if(error.status===401){$('script').replaceChildren();$('questions').replaceChildren();$('messages').replaceChildren();$('cameraCue').hidden=true;document.body.classList.remove('cue-active');state=null;}
}
function inline(parent,text) {
  // A deliberately small Markdown subset. Raw HTML and URLs remain inert text.
  const pattern=/(\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;let pos=0;
  for(const m of text.matchAll(pattern)){parent.append(document.createTextNode(text.slice(pos,m.index)));parent.append(create(m[2]?'strong':m[3]?'code':'em',m[2]||m[3]||m[4]));pos=m.index+m[0].length;}
  parent.append(document.createTextNode(text.slice(pos)));
}
function renderScript(markdown){
  const frag=document.createDocumentFragment();let fenced=false,code='',chapter=0,list=null;
  for(const line of markdown.split('\n')){
    if(/^\s*```/.test(line)){if(fenced){frag.append(create('pre',code));code='';}fenced=!fenced;list=null;continue;}
    if(fenced){code+=line+'\n';continue;}
    const heading=/^(#{1,3})\s+(.+)/.exec(line),item=/^\s*(?:[-*]|\d+\.)\s+(.+)/.exec(line);
    if(heading){const h=create('h'+heading[1].length);inline(h,heading[2]);h.dataset.chapter=chapter++;frag.append(h);list=null;}
    else if(item){if(!list){list=create('ul');frag.append(list);}const li=create('li');inline(li,item[1]);list.append(li);}
    else {list=null;if(line.trim()){const e=create(line.startsWith('> ')?'blockquote':'p');inline(e,line.replace(/^> /,''));frag.append(e);}}
  }
  if(fenced)frag.append(create('pre',code));
  $('script').replaceChildren(frag);
}
function showQuestions(data){
  const key=JSON.stringify(data);if(key===previousQuestions)return;previousQuestions=key;
  $('questionCount').textContent=data.filter(q=>!q.done).length;
  $('questions').replaceChildren();
  if(!data.length)$('questions').append(create('p','No questions yet. Editorial staff paste them manually from the external platform.','hint'));
  for(const q of data){const card=create('article',undefined,'question'+(q.done?' done':''));const p=create('p',q.text);const b=create('button',q.done?'↶ Reactivate':'✓ Done');b.onclick=()=>act('question.set',{id:q.id,done:!q.done});card.append(p,b);$('questions').append(card);}
}
function showMessages(allMessages){
  const messages=allMessages.filter(m=>!m.ackFor&&m.channel!=='push');
  const camera=role.startsWith('camera'),cue=camera||role==='moderation'?[...messages].reverse().find(m=>m.canAck&&(camera||m.from==='regie')):null;
  $('cameraCue').hidden=!cue;document.body.classList.toggle('cue-active',!!cue);
  if(cue){$('cameraCueText').textContent=cue.text;$('cameraAck').onclick=()=>act('ack',{id:cue.id});}
  const incoming=messages.filter(unread);for(const id of ['newMessages','globalUnread']){$(id).hidden=!incoming.length;$(id).textContent=`${incoming.length} unacknowledged messages`;}
  const key=JSON.stringify([allMessages,state.roleNames]);if(key===previousMessages)return;previousMessages=key;
  const list=$('messages'),oldScroll=list.scrollTop,bottom=list.scrollHeight-list.scrollTop-list.clientHeight<50;
  list.replaceChildren();
  if(!messages.length)list.append(create('p','Production chat is ready.','hint'));
  for(const m of messages.slice(-100)){
    const card=create('article',undefined,'message'+(m.canAck?' unread':''));
    card.append(create('small',`${label(m.from)} → ${label(m.to)} · ${new Date(m.at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}`),create('p',m.text));
    if(m.canAck&&(!camera||m.id!==cue?.id)){const b=create('button','✓ Understood','understood');b.onclick=()=>act('ack',{id:m.id});card.append(b);}
    const mark=receiptMark(m.receipt);if(mark){const tick=create('span',mark,'receipt');tick.title=`${m.receipt.confirmed} of ${m.receipt.total} recipients pressed Understood`;tick.setAttribute('aria-label',tick.title);card.append(tick);}
    list.append(card);
  }
  if(bottom)list.scrollTop=list.scrollHeight;else list.scrollTop=oldScroll;
  $('pushHistory').replaceChildren(...allMessages.filter(m=>m.channel==='push').slice(-30).reverse().map(m=>{const e=create('article',undefined,'message');e.append(create('small',new Date(m.at).toLocaleTimeString('en-GB')),create('p',m.text));return e;}));
}
const localTime=ms=>{const d=new Date(ms);return new Date(ms-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
function setupRole(){
  const camera=role.startsWith('camera'),admin=role==='regie';
  document.body.classList.toggle('camera-layout',camera);
  document.body.classList.toggle('moderation-layout',role==='moderation');document.body.classList.toggle('redaktion-layout',role==='redaktion');document.body.classList.toggle('regie-layout',admin);
  $('admin').hidden=!admin;$('editor').hidden=camera;$('wake').hidden=!camera;
  $('roleName').textContent=label(role);$('chatRole').textContent=label(role);
  $('addQuestion').hidden=!['regie','redaktion'].includes(role);
  $('setChapter').hidden=!['regie','redaktion','moderation'].includes(role);
  $('chapterPrev').hidden=$('chapterNext').hidden=!['regie','redaktion','moderation'].includes(role);
  $('channelTabs').hidden=!admin;
  $('statusHeading').textContent=role==='moderation'?'PRESENTER · LIVE TALLY':camera?'CAMERA · LIVE TALLY':'STUDIO · ATEM';
  options($('recipient'),(camera?['regie']:['team','all','regie',...ROLES].filter(r=>r!==role)).map(r=>[r,label(r)]));
  if(admin){options($('moderatorCamera'),Array.from({length:8},(_,i)=>[i+1,'HDMI '+(i+1)]));options($('assignmentRole'),ROLES.map(r=>[r,label(r)]));}
  loadReader();
}
function apply(d){
  if(!state||role!==d.role){role=d.role;setupRole();}
  const switched=previousShow!==d.id;state=d;if(switched){clearTimeout(pushTimer);pushQueue=[];$('pushOverlay').hidden=true;setChannel(false);}previousShow=d.id;online=true;serverBase=d.serverTime;receivedAt=performance.now();
  document.querySelectorAll('button').forEach(b=>b.disabled=false);
  $('showName').textContent=d.name;$('connection').textContent='● Production room connected';$('mode').textContent=d.demo?'DEMO · simulated ATEM data':d.assignment||'Live connection';
  const camera=role.startsWith('camera');
  const status=role==='moderation'||camera?d.camera.status:d.connected?'off':'offline';
  if(camera){if(liveTransition.update(d.id+':'+d.camera.number,status))flashLive();}
  $('tally').className='tally '+status;
  $('tally').textContent=role==='moderation'||camera?`CAM ${d.camera.number} · ${{program:'LIVE',preview:'PREVIEW',off:'READY',offline:'OFFLINE'}[status]}`:d.connected?'ATEM CONNECTED':'ATEM OFFLINE';
  $('atemStatus').textContent=role==='moderation'||camera?d.camera.name:`Program ${d.program??'—'}  /  Preview ${d.preview??'—'}`;
  if(!camera){
    if(previousScript!==d.markdown||switched){renderScript(d.markdown);previousScript=d.markdown;options($('chapters'),d.chapters.map((c,i)=>[i,c]));$('chapters').value=d.chapter;}
    $('script').querySelectorAll('[data-chapter]').forEach(e=>e.classList.toggle('current-chapter',Number(e.dataset.chapter)===d.chapter));
    $('chapterBadge').textContent='Current: '+(d.chapters[d.chapter]||'No chapter');
    $('chapters').disabled=false;
    if(document.activeElement!==$('chapters'))$('chapters').value=d.chapter;
    $('setChapter').disabled=!d.chapters.length;$('jumpChapter').disabled=!d.chapters.length;
    $('chapterPrev').disabled=d.chapter<=0||!d.chapters.length;$('chapterNext').disabled=d.chapter>=d.chapters.length-1||!d.chapters.length;
    showQuestions(d.questions);
  }
  const namesKey=JSON.stringify(d.roleNames);if(namesKey!==previousNames){previousNames=namesKey;const selected=$('recipient').value;options($('recipient'),(camera?['regie']:['team','all','regie',...ROLES].filter(r=>r!==role)).map(r=>[r,label(r)]));if(selected)$('recipient').value=selected;previousLinks=null;}
  $('roleName').textContent=label(role);$('chatRole').textContent=label(role);
  showMessages(d.messages);showPush(d);
  if(role==='regie'){
    const showsKey=JSON.stringify(d.shows);if($('shows').dataset.key!==showsKey){options($('shows'),d.shows.map(s=>[s.id,s.name]));$('shows').dataset.key=showsKey;$('shows').value=d.id;}
    if(switched){$('shows').value=d.id;$('newName').value=d.name;$('startTime').value=d.schedule?localTime(d.schedule.startAt):'';$('endTime').value=d.schedule?localTime(d.schedule.endAt):'';$('moderatorCamera').value=d.moderatorCamera;$('assignmentName').value=d.assignments[$('assignmentRole').value]||'';}
    $('actualTimes').textContent=`Actual start: ${d.actualStart===null?'—':new Date(d.actualStart).toLocaleString('en-GB')} · End: ${d.actualEnd===null?'—':new Date(d.actualEnd).toLocaleString('en-GB')}`;
    $('startShow').disabled=d.actualStart!==null;$('endShow').disabled=d.actualStart===null||d.actualEnd!==null;
    $('tunnelState').textContent=d.cloud.error|| (d.cloud.url?'Connected · '+d.cloud.url:d.cloud.running?'Tunnel starting …':'Tunnel off · links work only on this PC');$('tunnelLog').textContent=d.cloud.log||'No startup log yet.';
    const linksKey=JSON.stringify(d.links);if(linksKey!==previousLinks){previousLinks=linksKey;$('links').replaceChildren();for(const l of d.links){const card=create('article');card.append(create('p',label(l.role)));const img=create('img');img.src='/production/qr/'+l.role+'?v='+Date.now();img.alt='QR-Code '+label(l.role);const a=create('a',l.local?'Local preview':'Open role website');a.href=l.url;a.target='_blank';a.rel='noreferrer';card.append(img,a);$('links').append(card);}}
    $('cameraStrip').replaceChildren(...d.cameras.map(c=>create('span',`HDMI ${c.number} · ${c.status.toUpperCase()}`,'tally '+c.status)));
    renderProductionTools(d,switched);
  }
  const pushBusy=!!d.pushNotice;document.querySelectorAll('[data-push],#sendPush').forEach(b=>b.disabled=pushBusy);
  updateClock();
}
function updateClock(){
  if(!state||!online)return;
  const now=serverBase+performance.now()-receivedAt;
  if(!role.startsWith('camera')){
    const t=chapterTiming(state,now);
    $('chapterClock').textContent=t.remaining===null?t.text:`${t.text} ${t.remaining<0?'overrun +':'Remaining '}${fmt(t.remaining)}${t.delta===null?'':Math.abs(t.delta)<1000?' · on schedule':` · ${fmt(t.delta)} ${t.delta>0?'behind schedule':'ahead of schedule'}`}`;
  }
  $('remaining').classList.toggle('time-value',state.actualStart!==null&&state.actualEnd===null&&!!state.schedule);
  if(state.actualEnd!==null){$('clockLabel').textContent='SHOW ENDED';$('clock').textContent=fmt(state.actualEnd-state.actualStart);$('remaining').textContent='Actual show duration';}
  else if(state.actualStart!==null){$('clockLabel').textContent='ON AIR · COUNT-UP';$('clock').textContent='+'+fmt(now-state.actualStart);$('remaining').textContent=state.schedule?(now>state.schedule.endAt?'Overrun +':'Remaining time ')+fmt(state.schedule.endAt-now):'No scheduled end';}
  else if(state.schedule){const delta=state.schedule.startAt-now;$('clockLabel').textContent=delta>=0?'SHOW STARTS IN':'AWAITING START';$('clock').textContent=(delta<0?'+':'')+fmt(delta);$('remaining').textContent='The director starts the show';}
  else{$('clockLabel').textContent='SHOW CLOCK';$('clock').textContent='—';$('remaining').textContent='Ready for the next show';}
}
async function poll(){
  if(!busy){const currentEpoch=epoch;try{const next=await request('/production/state');if(currentEpoch===epoch)apply(next);}catch(e){if(currentEpoch===epoch)disconnect(e);}}
  setTimeout(poll,900);
}
$('scriptTab').onclick=()=>{$('scriptPane').hidden=false;$('questionsPane').hidden=true;$('scriptTab').classList.add('selected');$('questionsTab').classList.remove('selected');};
$('questionsTab').onclick=()=>{$('scriptPane').hidden=true;$('questionsPane').hidden=false;$('questionsTab').classList.add('selected');$('scriptTab').classList.remove('selected');};
$('setChapter').onclick=()=>act('chapter',{index:Number($('chapters').value)});
$('chapterPrev').onclick=()=>act('chapter.step',{step:-1,expectedChapter:state?.chapter});
$('chapterNext').onclick=()=>act('chapter.step',{step:1,expectedChapter:state?.chapter});
$('jumpChapter').onclick=()=>{const h=$('script').querySelector(`[data-chapter="${state?.chapter}"]`);if(h)$('scriptPane').scrollTop=h.offsetTop-$('script').offsetTop;};
$('addQuestion').onsubmit=async e=>{e.preventDefault();if(await act('question.add',{text:$('questionText').value}))$('questionText').value='';};
$('chatForm').onsubmit=async e=>{e.preventDefault();if(await act('chat',{to:$('recipient').value,text:$('chatText').value}))$('chatText').value='';};
$('new').onclick=()=>act('create',{name:$('newName').value});$('duplicate').onclick=()=>act('duplicate',{name:$('newName').value});$('rename').onclick=()=>act('rename',{name:$('newName').value});
$('load').onclick=()=>act('load',{id:$('shows').value});
$('saveSchedule').onclick=()=>act('schedule',{startAt:Date.parse($('startTime').value),endAt:Date.parse($('endTime').value)});
$('clearSchedule').onclick=()=>act('schedule',{clear:true});
$('startShow').onclick=()=>act('start');$('endShow').onclick=()=>act('end');
$('resetShow').onclick=()=>{if(confirm('Reset actual show timing? The existing event log will be kept.'))act('reset');};
$('scriptFile').onchange=async()=>{const f=$('scriptFile').files[0];if(!f)return;if(f.size>800000){notify('Script file too large.');return;}await act('markdown',{text:await f.text()});$('scriptFile').value='';};
$('assignmentRole').onchange=()=>{$('assignmentName').value=state?.assignments[$('assignmentRole').value]||'';};
$('saveAssignment').onclick=()=>act('assign',{moderatorCamera:Number($('moderatorCamera').value),assignments:{[$('assignmentRole').value]:$('assignmentName').value}});
$('rotate').onclick=()=>{if(confirm('Invalidate all existing role links for this show?'))act('rotate');};
for(const id of ['readerFont','readerLine','readerWidth','readerTheme'])$(id).onchange=()=>{
  reader=readerSettings({font:Number($('readerFont').value),line:Number($('readerLine').value),width:Number($('readerWidth').value),theme:$('readerTheme').value});renderReader();try{localStorage.setItem('PRODOS.reader.'+role,JSON.stringify(reader));}catch{}
};
$('focusMode').onclick=()=>{const active=document.body.classList.toggle('reader-focus');$('focusMode').textContent=active?'Exit reading mode':'Reading mode';$('focusMode').setAttribute('aria-pressed',String(active));};
$('importShow').onchange=async()=>{const f=$('importShow').files[0];if(!f)return;try{if(f.size>16*1024*1024)throw Error('Show file limited to 16 MB.');const bundle=JSON.parse(await f.text());if(confirm('Import and activate as a new show? The existing show will be kept.'))await act('import',{bundle});}catch(e){notify(e.message);}finally{$('importShow').value='';}};
$('saveRundown').onclick=()=>act('rundown',{durations:[...$('rundownPlan').querySelectorAll('input')].map(i=>Math.round(Number(i.value)*60))});
$('saveRequired').onclick=()=>act('required',{roles:[...$('requiredRoles').querySelectorAll('input:checked')].map(i=>i.value)});
$('checkPreflight').onclick=async()=>{if(busy)return;busy=true;epoch++;$('checkPreflight').disabled=true;notify('Running preflight …');try{apply(await request('/production/preflight',{}));notify('Preflight updated');}catch(e){notify(e.message);}finally{busy=false;$('checkPreflight').disabled=false;}};
function renderProductionTools(d,switched){
  const statusNames={online:'Reachable',background:'In background',offline:'Connection lost',never:'Not opened yet'};
  $('presence').replaceChildren(...d.presence.map(p=>{const card=create('article',undefined,'presence-item '+p.status);card.append(create('strong',label(p.role)),create('span',statusNames[p.status]+(!p.required?' · optional':' · required')+(p.sessions>1?` · ${p.sessions} devices`:'')));card.append(create('small',p.lastSeen?'Last contact '+new Date(p.lastSeen).toLocaleTimeString('en-GB'):'No contact since server startup'));card.append(create('small',p.lastReply?'Last response '+new Date(p.lastReply).toLocaleTimeString('en-GB'):'No response yet'));return card;}));
  $('preflight').replaceChildren(...d.preflight.map(c=>{const card=create('article',undefined,'check-item '+(c.ok?'ok':'pending'));card.append(create('strong',(c.ok?'✓ ':'○ ')+c.label),create('small',c.detail));return card;}));
  const requiredKey=JSON.stringify(d.requiredRoles);if(switched||requiredKey!==previousRequired){previousRequired=requiredKey;$('requiredRoles').replaceChildren(...ROLES.map(r=>{const l=create('label');const i=create('input');i.type='checkbox';i.value=r;i.checked=d.requiredRoles.includes(r);l.append(i,document.createTextNode(label(r)));return l;}));}
  const planKey=JSON.stringify([d.chapters,d.chapterDurations]);if(switched||planKey!==previousPlan){previousPlan=planKey;$('rundownPlan').replaceChildren(...d.chapters.map((name,i)=>{const l=create('label',`${i+1}. ${name}`);const input=create('input');input.type='number';input.min=0;input.max=360;input.step=0.5;input.value=(d.chapterDurations[i]||0)/60;input.setAttribute('aria-label',name+' – Minutes');l.append(input);return l;}));}
  const total=d.chapterDurations.reduce((a,b)=>a+b,0)*1000;
  $('rundownSummary').textContent=`Planned chapter time ${fmt(total)}${d.schedule?' · Show duration '+fmt(d.schedule.endAt-d.schedule.startAt):''}${d.chapterDurations.some(n=>!n)?' · Some chapters have no target':''}`;
}
for(const [id,action] of [['tunnelStart','start'],['tunnelStop','stop']])$(id).onclick=async()=>{try{await request('/cloud/'+action,{});}catch(e){notify(e.message);}};
let wakeLock;
$('wake').onclick=async()=>{try{wakeLock=await navigator.wakeLock.request('screen');$('wake').textContent='Screen will stay awake';wakeLock.addEventListener('release',()=>{$('wake').textContent='Keep screen awake again';});}catch{$('wake').textContent='Adjust screen lock in device settings';}};
// Browser toolbars and mobile keyboards change the visual viewport independently.
function fitCameraViewport(){if(role.startsWith('camera'))document.body.style.setProperty('--camera-height',(window.visualViewport?.height||window.innerHeight)+'px');}
window.visualViewport?.addEventListener('resize',fitCameraViewport);
window.addEventListener('resize',fitCameraViewport);
setupRole();fitCameraViewport();setInterval(updateClock,250);poll();




