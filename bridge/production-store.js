import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, copyFileSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { exportShow, importShow } from './show-transfer.js';

export const ROLES = ['redaktion', 'moderation', ...Array.from({ length: 8 }, (_, i) => `camera${i + 1}`)];
const keys = () => Object.fromEntries(ROLES.map(r => [r, randomBytes(24).toString('hex')]));
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const text = (value, max = 2000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`Text required (1–${max} characters).`);
  return value.trim();
};
function newShow(name) {
  return { id: randomUUID(), name: text(name, 100), revision: 0, schedule: null,
    actualStart: null, actualEnd: null, events: [], markdown: "# Welcome\n\n**Camera 1 \u00b7 Presenter**\n\nWelcome to our studio show. Today we explore how teams work together.\n\n> Presenter: start calmly and look at your assigned camera. The director starts the show clock.\n\n# Conversation\n\nWhat helps everyone get the right information at the right time?\n\n- Introduce the guests.\n- Mention the external audience question platform.\n- Editorial staff copy selected questions into PRODOS manually.\n\n**Follow-up**\n\n**Opening question:** What small change improved your teamwork recently?\n\nThe highlighted chapter is a reference point. Scroll at your own pace.\n\n> Read director cues in the chat and press **Understood**.\n\n**Audience questions**\n\nSwitch to the **Audience questions** tab. Mark answered questions as done; they move to the bottom and can be reactivated.\n\n# Closing\n\n- Summarize one key point.\n- Thank the guests and audience.\n- Announce the next show.\n\nThank you for watching!\n\n> Hold the closing shot until the director ends the show.\n",
    chapter: 0, chapterStartedAt:null, chapterDurations:[0,0,0], requiredRoles:[...ROLES], questions: [], messages: [], moderatorCamera: 1,
    assignments: Object.fromEntries(ROLES.map(r => [r, ''])), tokens: keys() };
}
export function chapters(markdown) {
  let fenced = false;
  const result = [];
  for (const line of markdown.split('\n')) {
    if (/^\s*```/.test(line)) { fenced = !fenced; continue; }
    const match = !fenced && /^#{1,3}\s+(.+)/.exec(line);
    if (match) result.push(match[1]);
  }
  return result;
}
export function clockState(show, now = Date.now()) {
  if (show.actualEnd !== null) return { phase: 'ended', elapsed: Math.max(0, show.actualEnd - show.actualStart), remaining: 0 };
  if (show.actualStart !== null) return { phase: 'live', elapsed: Math.max(0, now - show.actualStart), remaining: show.schedule ? show.schedule.endAt - now : null };
  if (show.schedule) return { phase: now < show.schedule.startAt ? 'countdown' : 'waiting', remaining: show.schedule.startAt - now, elapsed: 0 };
  return { phase: 'ready', elapsed: 0, remaining: null };
}
export class ProductionStore {
  constructor(file) {
    this.file = file;
    this.pushNotice=null;
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf8'));
      if (this.data.schema !== 1 || !Array.isArray(this.data.shows) || !this.data.shows.some(s => s.id === this.data.activeId)) throw new Error('Invalid show data file. Original preserved; check the backup.');
    } else {
      const show = newShow('My first show');
      this.data = { schema: 1, activeId: show.id, nextMessageId: 1, shows: [show] };
      this.persist(this.data);
    }
    for(const s of this.data.shows){s.chapterDurations??=Array(chapters(s.markdown).length).fill(0);s.chapterStartedAt??=s.actualStart;s.requiredRoles??=[...ROLES];}
  }
  get active() { return this.data.shows.find(s => s.id === this.data.activeId); }
  export(now=Date.now()){return exportShow(this.active,now);}
  backup(reason){
    const dir=this.file+'.backups';mkdirSync(dir,{recursive:true});
    writeFileSync(path.join(dir,Date.now()+'-'+randomUUID()+'-'+reason+'.json'),JSON.stringify(this.data,null,2),{mode:0o600,flush:true});
    const files=readdirSync(dir).filter(n=>/^\d+-[a-f0-9-]+-[a-z.]+\.json$/.test(n)).sort();
    for(const name of files.slice(0,-20))unlinkSync(path.join(dir,name));
  }
  persist(next) {
    mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    writeFileSync(temp, JSON.stringify(next, null, 2), { mode: 0o600, flush: true });
    if (existsSync(this.file)) copyFileSync(this.file, this.file + '.bak');
    renameSync(temp, this.file);
  }
  authenticate(token) { return ROLES.find(role => this.active.tokens[role] === token) || null; }
  visibleMessages(role, show = this.active) {
    const acknowledgements=new Map();
    for(const m of show.messages)if(m.ackFor){if(!acknowledgements.has(m.ackFor))acknowledgements.set(m.ackFor,new Set());acknowledgements.get(m.ackFor).add(m.from);}
    return show.messages.filter(m => role === 'regie' || m.from === role || m.to === role || m.to === 'all' || (m.to==='team'&&m.recipients?.includes(role))).map(m => {
      const expected=m.recipients|| (m.to==='all'?['regie',...ROLES].filter(r=>r!==m.from):[m.to].filter(r=>r!==m.from));
      const confirmed=expected.filter(r=>acknowledgements.get(m.id)?.has(r));
      return {...m,receipt:{confirmed:confirmed.length,total:expected.length},canAck:!m.ackFor&&m.channel!=='push'&&expected.includes(role)&&!confirmed.includes(role),acknowledged:role===m.from?expected.length>0&&confirmed.length===expected.length:confirmed.includes(role),
        ...(!m.ackFor&&(role==='regie'||role===m.from)?{acknowledgements:{expected,confirmed,missing:expected.filter(r=>!confirmed.includes(r))}}:{})};
    });
  }
  view(role, now = Date.now()) {
    const s = this.active;
    const base = { id: s.id, name: s.name, revision: s.revision, schedule: s.schedule, actualStart: s.actualStart, actualEnd: s.actualEnd,
      pushNotice:this.pushNotice?.showId===s.id&&now<this.pushNotice.expiresAt?this.pushNotice:null,moderatorCamera: s.moderatorCamera, messages: this.visibleMessages(role), clock: clockState(s, now), serverTime: now, role, roleNames:s.assignments, assignment: s.assignments[role] || '' };
    if (!role.startsWith('camera')) Object.assign(base, { markdown: s.markdown, chapters: chapters(s.markdown), chapter: s.chapter,chapterDurations:s.chapterDurations,chapterStartedAt:s.chapterStartedAt,
      questions: [...s.questions].sort((a,b) => Number(a.done) - Number(b.done) || a.createdAt - b.createdAt) });
    if (role === 'regie') Object.assign(base, { requiredRoles:s.requiredRoles,assignments: s.assignments, events: s.events, shows: this.data.shows.map(x => ({ id: x.id, name: x.name })) });
    return base;
  }
  act(role, action, body = {}, now = Date.now()) {
    if (role !== 'regie' && !ROLES.includes(role)) fail('Permission denied.', 403);
    const allowed = role === 'regie' ? ['create','load','duplicate','rename','schedule','start','end','reset','markdown','chapter','chapter.step','rundown','required','import','question.add','question.set','assign','chat','push','ack','rotate']
      : role === 'redaktion' ? ['chapter','chapter.step','question.add','question.set','chat','ack']
      : role === 'moderation' ? ['chapter','chapter.step','question.set','chat','ack'] : ['chat','ack'];
    if (!allowed.includes(action)) fail('This role cannot perform this action.', 403);
    if (body.showId !== this.active.id) fail('The active show has changed. Refresh the page.', 409);
    const next = structuredClone(this.data);
    let s = next.shows.find(x => x.id === next.activeId);
    switch (action) {
      case 'create': if(next.shows.length >= 200) fail('Maximum 200 shows.'); s = newShow(body.name); next.shows.push(s); next.activeId = s.id; break;
      case 'import': {if(next.shows.length>=200)fail('Maximum 200 shows.');const imported=importShow(body.bundle,next.nextMessageId,chapters);s=imported.show;next.nextMessageId=imported.nextMessageId;next.shows.push(s);next.activeId=s.id;break;}
      case 'required': if(!Array.isArray(body.roles)||body.roles.some(r=>!ROLES.includes(r))||new Set(body.roles).size!==body.roles.length)fail('Invalid role list.');s.requiredRoles=[...body.roles];break;
      case 'rundown': if(!Array.isArray(body.durations)||body.durations.length!==chapters(s.markdown).length||body.durations.some(d=>!Number.isInteger(d)||d<0||d>21600))fail('Chapter timing: 0 to 360 minutes per chapter.');s.chapterDurations=[...body.durations];break;
      case 'load': s = next.shows.find(x => x.id === body.id); if (!s) fail('Show not found.', 404); next.activeId = s.id; break;
      case 'duplicate': {
        if(next.shows.length >= 200) fail('Maximum 200 shows.');
        s = structuredClone(s); s.id = randomUUID(); s.name = text(body.name,100); s.tokens = keys();
        s.actualStart = s.actualEnd = s.chapterStartedAt = null; s.events = []; s.messages = []; s.questions.forEach(q => { q.id = randomUUID(); q.done = false; });
        next.shows.push(s); next.activeId = s.id; break;
      }
      case 'rename': s.name = text(body.name,100); break;
      case 'schedule': {
        if (body.clear === true) { s.schedule = null; break; }
        const { startAt, endAt } = body;
        if (!Number.isSafeInteger(startAt) || !Number.isSafeInteger(endAt) || endAt <= startAt || endAt - startAt > 36*3600000 || Math.abs(startAt - now) > 366*86400000) fail('Invalid schedule: end after start, maximum 36 hours, within one year.');
        s.schedule = { startAt, endAt }; break;
      }
      case 'start': if (s.actualStart !== null) fail('The show has already started.',409); s.actualStart = s.chapterStartedAt = now; s.events.push({ type:'start',at:now }); break;
      case 'end': if (s.actualStart === null || s.actualEnd !== null) fail('The show is not live.',409); s.actualEnd = now; s.events.push({ type:'end',at:now }); break;
      case 'reset': s.events.push({type:'reset',at:now}); s.actualStart = s.actualEnd = s.chapterStartedAt = null; break;
      case 'markdown': if (typeof body.text !== 'string' || body.text.length > 200000) fail('Script limited to 200,000 characters.'); s.markdown = body.text;s.chapterDurations=Array(chapters(body.text).length).fill(0); s.chapter = 0;s.chapterStartedAt=s.actualStart!==null&&s.actualEnd===null?now:null;break;
      case 'chapter.step':
        if(![-1,1].includes(body.step))fail('Invalid chapter direction.');
        if(body.expectedChapter!==s.chapter)fail('The chapter has already changed. Please select again.',409);
        body={...body,index:s.chapter+body.step};
        // fall through: manual arrow and direct selection share the same validation.
      case 'chapter':
        if (!Number.isInteger(body.index) || body.index < 0 || body.index >= chapters(s.markdown).length) fail('Chapter not found.');
        if(s.chapter!==body.index){s.chapter=body.index;if(s.actualStart!==null&&s.actualEnd===null){s.chapterStartedAt=now;s.events.push({type:'chapter',chapter:s.chapter,at:now});}}break;
      case 'question.add': if (s.questions.length >= 1000) fail('Maximum 1,000 questions per show.'); s.questions.push({ id:randomUUID(),text:text(body.text),done:false,createdAt:now }); break;
      case 'question.set': {
        const q = s.questions.find(q => q.id === body.id); if (!q) fail('Question not found.',404);
        if (typeof body.done !== 'boolean') fail('Status must be active or done.'); q.done = body.done; break;
      }
      case 'assign':
        if (!Number.isInteger(body.moderatorCamera) || body.moderatorCamera < 1 || body.moderatorCamera > 8) fail('Presenter camera: HDMI 1–8.');
        s.moderatorCamera = body.moderatorCamera;
        for (const r of ROLES) if (body.assignments?.[r] !== undefined) { if (typeof body.assignments[r] !== 'string' || body.assignments[r].length > 80) fail('Role name limited to 80 characters.'); s.assignments[r] = body.assignments[r].trim(); }
        break;
      case 'rotate': s.tokens = keys(); break;
      case 'push': {
        if(this.pushNotice?.showId===s.id&&now<this.pushNotice.expiresAt)fail('A push is still active. Please wait.',429);
        s.messages.push({id:next.nextMessageId++,from:'regie',to:'all',recipients:[...ROLES],text:text(body.text,160).replace(/\s+/g,' '),at:now,ackFor:null,channel:'push'});break;
      }
      case 'chat': {
        const to = body.to;
        if (!['regie','all','team',...ROLES].includes(to) || (role.startsWith('camera') && to !== 'regie')) fail('Invalid recipient.',403);
        const recipients=(to==='team'?['regie',...s.requiredRoles]:to==='all'?['regie',...ROLES]:[to]).filter(r=>r!==role);
        if(!recipients.length)fail('No recipients selected. Select required roles or address a role directly.');
        s.messages.push({ id:next.nextMessageId++,from:role,to,recipients,text:text(body.text,240),at:now,ackFor:null }); break;
      }
      case 'ack': {
        const m = this.visibleMessages(role,s).find(m => m.id === body.id && m.from !== role && !m.ackFor && m.channel!=='push' && (m.recipients||(m.to==='all'?['regie',...ROLES]:[m.to])).includes(role));
        if (!m) fail('Message not found.',404);
        if (!s.messages.some(a => a.ackFor === m.id && a.from === role)) s.messages.push({id:next.nextMessageId++,from:role,to:m.from,text:'Understood',at:now,ackFor:m.id});
        break;
      }
    }
    if(s.messages.length > 10000) fail('Message limit reached. Create a new show.');
    s.revision += 1;
    if(['import','markdown','reset','rotate','load','rundown'].includes(action))this.backup(action);
    this.persist(next); // Publish only after a successful atomic save.
    this.data = next;
    if(action==='push'){const m=s.messages.at(-1);this.pushNotice={id:m.id,showId:s.id,text:m.text,at:now,expiresAt:now+4000};}
    if(['create','load','duplicate','import'].includes(action))this.pushNotice=null;
    return this.view(role,now);
  }
}

