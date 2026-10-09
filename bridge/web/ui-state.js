export class LiveTransition {
  constructor(){this.identity=null;this.status=null;}
  update(identity,status){
    const flash=this.identity===identity&&this.status!==null&&this.status!=='offline'&&this.status!=='program'&&status==='program';
    this.identity=identity;this.status=status;return flash;
  }
  disconnect(){this.status=null;}
}
export function readerSettings(value={}){
  const within=(v,min,max,fallback)=>Number.isFinite(v)&&v>=min&&v<=max?v:fallback;
  return {font:within(value.font,18,36,24),line:within(value.line,1.3,2,1.6),width:within(value.width,45,80,65),theme:value.theme==='light'?'light':'dark'};
}
export function chapterTiming(show,now){
  const durations=show.chapterDurations||[],i=show.chapter;
  if(!durations[i])return {text:'No duration planned for this chapter',remaining:null,delta:null};
  const planned=durations[i]*1000;
  if(show.actualStart===null)return {text:'Planned',remaining:planned,delta:null};
  const elapsed=Math.max(0,(show.actualEnd??now)-(show.chapterStartedAt??show.actualStart));
  const complete=durations.slice(0,i).every(d=>d>0);
  const delta=complete?(show.chapterStartedAt??show.actualStart)-show.actualStart-durations.slice(0,i).reduce((a,b)=>a+b*1000,0)+Math.max(0,elapsed-planned):null;
  return {text:show.actualEnd===null?'Chapter':'Ended',remaining:planned-elapsed,delta};
}

export function receiptMark(receipt){return !receipt?.confirmed?'':receipt.total>0&&receipt.confirmed>=receipt.total?'✓✓':'✓';}
export class PushGate {
  constructor(){this.showId=null;this.lastId=0;}
  accept(showId,notice,now){
    if(this.showId!==showId){this.showId=showId;this.lastId=0;}
    if(!notice||notice.showId!==showId||notice.id<=this.lastId||now>=notice.expiresAt)return false;
    this.lastId=notice.id;return true;
  }
}
