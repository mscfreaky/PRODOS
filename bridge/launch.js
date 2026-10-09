import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const child=spawn(process.execPath,['server.js','--reuse-existing',...process.argv.slice(2)],{cwd:fileURLToPath(new URL('.',import.meta.url)),stdio:['inherit','pipe','inherit'],windowsHide:true});
let opened=false,buffer='';
child.stdout.on('data',chunk=>{
  process.stdout.write(chunk);buffer=(buffer+chunk).slice(-4000);
  const match=/PRODUCTION (http:\/\/127\.0\.0\.1:\d+\/production)/.exec(buffer);
  if(match&&!opened){opened=true;if(process.platform==='win32'){const browser=spawn('explorer.exe',[match[1]],{windowsHide:true,stdio:'ignore'});browser.on('error',()=>console.log('Open the URL manually in your browser.'));}}
});
child.on('error',e=>{console.error(e.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
process.on('SIGINT',()=>child.kill());process.on('SIGTERM',()=>child.kill());
