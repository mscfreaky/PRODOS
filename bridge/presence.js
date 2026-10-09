export class Presence {
  constructor(){this.sessions=new Map();this.opened=new Map();}
  touch(showId,role,client,visible,now=Date.now()){
    if(typeof client!=='string'||!/^[a-zA-Z0-9-]{8,80}$/.test(client))return;
    const key=showId+':'+role+':'+client;
    this.opened.set(showId+':'+role,now);
    this.sessions.set(key,{showId,role,visible:visible!=='hidden',lastSeen:now});
    for(const [k,v] of this.sessions)if(now-v.lastSeen>120000)this.sessions.delete(k);
    while(this.sessions.size>500)this.sessions.delete(this.sessions.keys().next().value);
  }
  view(showId,roles,required,now=Date.now()){
    return roles.map(role=>{
      const sessions=[...this.sessions.values()].filter(s=>s.showId===showId&&s.role===role&&now-s.lastSeen<8000);
      const lastSeen=this.opened.get(showId+':'+role)??null;
      return {role,required:required.includes(role),lastSeen,open: lastSeen!==null,sessions:sessions.length,
        status:sessions.some(s=>s.visible)?'online':sessions.length?'background':lastSeen===null?'never':'offline'};
    });
  }
}
export function preflight(show,status,presence,tunnel,now=Date.now()){
  const missing=presence.filter(p=>p.required&&p.status!=='online').map(p=>p.role);
  return [
    {id:'atem',ok:!!status.connected&&!status.demo,label:'ATEM connection',detail:status.demo?'Demo: no physical ATEM checked':status.connected?'ATEM reachable':'No ATEM connection'},
    {id:'tunnel',ok:tunnel.ok&&now-tunnel.checkedAt<60000,label:'External tunnel check',detail:tunnel.checkedAt?`${tunnel.detail} · ${new Date(tunnel.checkedAt).toLocaleTimeString('en-GB')}`:'Not checked yet'},
    {id:'camera',ok:!!status.state?.inputs?.[show.moderatorCamera],label:'Presenter camera',detail:'HDMI '+show.moderatorCamera},
    {id:'script',ok:!!show.markdown.trim(),label:'Script',detail:show.markdown.trim()?'Script available':'No script imported'},
    {id:'schedule',ok:!!show.schedule&&show.schedule.endAt>show.schedule.startAt&&show.schedule.endAt>now,label:'Show schedule',detail:show.schedule?(show.schedule.endAt>now?'Start/end set':'Scheduled end is in the past'):'No scheduled times'},
    {id:'roles',ok:missing.length===0,label:'Required roles',detail:missing.length?'Not connected in the foreground: '+missing.map(r=>({regie:'Director',redaktion:'Editorial',moderation:'Presenter'})[r]||r.replace('camera','CAM ')).join(', '):'All required roles are connected'}
  ];
}
