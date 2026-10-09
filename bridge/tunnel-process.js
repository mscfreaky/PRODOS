import {spawn} from 'node:child_process';

export function explainTunnelError(log) {
  if(/no such host|ENOTFOUND|EAI_AGAIN/i.test(log))return 'Cloudflare DNS resolution failed. Check internet access and corporate DNS, then restart.';
  if(/certificate|x509/i.test(log))return 'Could not verify the Cloudflare certificate. Ask IT to check the system clock and corporate proxy.';
  if(/timeout|timed out|failed to dial|network is unreachable/i.test(log))return 'Cloudflare is unreachable. Check internet access, proxy and firewall, then restart.';
  return log.split(/\r?\n/).filter(Boolean).slice(-2).join(' | ').slice(-500)||'Could not start Cloudflare.';
}

// Keep process state separate from the printed URL: a URL alone is not a connection.
export function createTunnelProcess(command,port,{spawnProcess=spawn,timeoutMs=45000}={}) {
  let child=null,url=null,error=null,log='',status='off',timer,registered=false;
  function stop(){clearTimeout(timer);const old=child;child=null;url=null;error=null;status='off';registered=false;if(old&&old.exitCode===null)old.kill();}
  function start(){
    if(child&&child.exitCode===null&&status!=='error')return;
    stop();log='';status='starting';
    try {
      // HTTP/2 avoids QUIC/UDP restrictions common on managed production networks.
      const p=spawnProcess(command(),['tunnel','--protocol','http2','--url',`http://127.0.0.1:${port}`],{windowsHide:true,stdio:['ignore','pipe','pipe']});child=p;
      let pending='';
      const parse=chunk=>{
        if(child!==p)return;
        log=(log+chunk.toString()).slice(-16000);
        const match=log.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/i);if(match)url=match[0];
        pending+=chunk.toString();const lines=pending.split(/\r?\n/);pending=lines.pop().slice(-16000);
        for(const line of lines){
          if(/Registered tunnel connection/i.test(line)){registered=true;clearTimeout(timer);error=null;status='connected';}
          if(/failed to request quick tunnel|no such host|x509|connection.*(?:closed|terminated)|failed to (?:dial|serve)/i.test(line)){
            error=explainTunnelError(line);status='error';registered=false;
          }
        }
      };
      p.stdout.on('data',parse);p.stderr.on('data',parse);
      p.once('error',e=>{if(child!==p)return;clearTimeout(timer);child=null;url=null;status='error';error=e.code==='ENOENT'?'cloudflared was not found. Check installation or set CLOUDFLARED_EXE.':`Cloudflare: ${e.message}`;});
      p.once('exit',(code,signal)=>{if(child!==p)return;clearTimeout(timer);child=null;url=null;registered=false;status='error';error=error||explainTunnelError(log)+` (Process exited: ${code??signal})`;});
      timer=setTimeout(()=>{if(child!==p||registered)return;child=null;url=null;status='error';error=error||'Tunnel startup stopped after 45 seconds. Check internet access, DNS and firewall, then restart.';p.kill();},timeoutMs);timer.unref?.();
    }catch(e){status='error';error=`Could not start Cloudflare: ${e.message}`;}
  }
  return {start,stop,info:()=>({publicUrl:status==='connected'?url:null,cloudRunning:!!child&&child.exitCode===null,tunnelError:error,tunnelStatus:status,tunnelLog:log})};
}
