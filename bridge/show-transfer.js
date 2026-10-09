import { randomUUID, randomBytes } from 'node:crypto';
const roles=['redaktion','moderation',...Array.from({length:8},(_,i)=>'camera'+(i+1))];
const bad=()=>{throw Object.assign(new Error('Invalid or unsupported show file. Nothing was imported.'),{status:400});};
const str=(s,n,empty=false)=>{if(typeof s!=='string'||s.length>n||(!empty&&!s.trim()))bad();return s;};
const num=(v,min,max)=>{if(!Number.isSafeInteger(v)||v<min||v>max)bad();return v;};
const timestamp=v=>v===null?null:num(v,0,8640000000000000);
const list=(a,max)=>{if(!Array.isArray(a)||a.length>max)bad();return a;};
export function exportShow(show,now=Date.now()) {
  const {tokens,...portable}=structuredClone(show);
  return {format:'PRODOS-show',version:1,exportedAt:now,show:portable};
}
export function importShow(bundle,nextMessageId,chapterNames) {
  if((typeof bundle?.format!=='string'||!/^[A-Z]+-show$/.test(bundle.format))||bundle.version!==1||!bundle.show||typeof bundle.show!=='object')bad();
  const s=bundle.show;
  const markdown=str(s.markdown,200000,true),count=chapterNames(markdown).length;
  const actualStart=timestamp(s.actualStart),actualEnd=timestamp(s.actualEnd);
  if(actualEnd!==null&&(actualStart===null||actualEnd<actualStart))bad();
  let schedule=null;
  if(s.schedule!==null){const startAt=timestamp(s.schedule?.startAt),endAt=timestamp(s.schedule?.endAt);if(startAt===null||endAt===null||endAt<=startAt||endAt-startAt>36*3600000)bad();schedule={startAt,endAt};}
  const assignments=Object.fromEntries(roles.map(r=>[r,str(s.assignments?.[r]??'',80,true)]));
  const requiredRoles=list(s.requiredRoles??['redaktion','moderation',...roles.filter(r=>r.startsWith('camera'))],10);
  if(requiredRoles.some(r=>!roles.includes(r))||new Set(requiredRoles).size!==requiredRoles.length)bad();
  const chapterDurations=list(s.chapterDurations??Array(count).fill(0),Math.max(count,1)).map(d=>num(d,0,21600));
  if(chapterDurations.length!==count)bad();
  const questions=list(s.questions,1000).map(q=>{if(typeof q.done!=='boolean')bad();return{id:randomUUID(),text:str(q.text,2000),done:q.done,createdAt:timestamp(q.createdAt)??0};});
  const rawMessages=list(s.messages,10000),idMap=new Map();
  for(const m of rawMessages){num(m.id,1,Number.MAX_SAFE_INTEGER);if(idMap.has(m.id))bad();idMap.set(m.id,nextMessageId++);}
  const messages=rawMessages.map(m=>{
    if(!['regie',...roles].includes(m.from)||!['regie','all','team',...roles].includes(m.to))bad();
    if(m.ackFor!==null&&!idMap.has(m.ackFor))bad();
    if(m.to==='team'&&!Array.isArray(m.recipients))bad();
    if(m.recipients!==undefined&&(!Array.isArray(m.recipients)||m.recipients.length>11||m.recipients.some(r=>!['regie',...roles].includes(r)||r===m.from)||new Set(m.recipients).size!==m.recipients.length))bad();
    if(m.channel!==undefined&&!['chat','push'].includes(m.channel))bad();
    if(m.channel==='push'&&(m.from!=='regie'||m.ackFor!==null))bad();
    return{...(m.channel?{channel:m.channel}:{}),...(m.recipients?{recipients:[...m.recipients]}:{}),id:idMap.get(m.id),from:m.from,to:m.to,text:str(m.text,240),at:timestamp(m.at)??0,ackFor:m.ackFor===null?null:idMap.get(m.ackFor)};
  });
  const events=list(s.events,10000).map(e=>{if(!['start','end','reset','chapter'].includes(e.type))bad();return{type:e.type,at:timestamp(e.at)??0,...(e.type==='chapter'?{chapter:num(e.chapter,0,Math.max(0,count-1))}:{})};});
  const chapterStartedAt=timestamp(s.chapterStartedAt??null);
  if(chapterStartedAt!==null&&(actualStart===null||chapterStartedAt<actualStart||(actualEnd!==null&&chapterStartedAt>actualEnd)))bad();
  return {nextMessageId,show:{id:randomUUID(),name:str(s.name,100),revision:0,schedule,actualStart,actualEnd,events,markdown,
    chapter:num(s.chapter,0,Math.max(0,count-1)),chapterStartedAt,chapterDurations,requiredRoles:[...requiredRoles],questions,messages,
    moderatorCamera:num(s.moderatorCamera,1,8),assignments,tokens:Object.fromEntries(roles.map(r=>[r,randomBytes(24).toString('hex')]))}};
}
