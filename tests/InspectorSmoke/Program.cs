using System.Reflection;
using System.Diagnostics;
using System.Text.Json;
using System.Windows.Forms;

static class Smoke
{
    [STAThread]
    static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var type = Assembly.Load("PRODOS").GetType("AtemInspector.InspectorForm")!;
        var form = (Form)Activator.CreateInstance(type, new object[]{false})!;
        form.Opacity = 0;
        form.ShowInTaskbar = false;
        int code = 0;
        var flags = BindingFlags.Instance | BindingFlags.NonPublic;
        var start = type.GetMethod("StartBridge", flags)!;
        var stop = type.GetMethod("Disconnect", flags)!;
        var portField = type.GetField("port", flags)!;
        var bridgeField = type.GetField("bridge", flags)!;
        using var http = new HttpClient();
        form.Shown += async (_,_) => {
            Process? owner = null;
            try {
                string? showId = null;
                for (int i=0;i<4;i++) {
                    await (Task)start.Invoke(form,new object[]{true})!;
                    int port=(int)portField.GetValue(form)!;
                    if(port==0)throw new Exception("Inspector did not connect");
                    var state=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/production/state"));
                    var id=state.RootElement.GetProperty("id").GetString();
                    if(showId!=null&&showId!=id)throw new Exception("Show lost during native restart");
                    showId=id;
                    Console.WriteLine($"PASS native Demo start/restart {i+1}: same show, connected");
                }
                await (Task)type.GetMethod("RefreshCloud", flags)!.Invoke(form,null)!;
                int chapterPort=(int)portField.GetValue(form)!;
                int before=(int)type.GetField("currentChapter", flags)!.GetValue(form)!;
                await (Task)type.GetMethod("StepChapter", flags)!.Invoke(form,new object[]{1})!;
                var stepped=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{chapterPort}/production/state"));
                if(stepped.RootElement.GetProperty("chapter").GetInt32()!=before+1)throw new Exception("Native next chapter failed");
                await (Task)type.GetMethod("StepChapter", flags)!.Invoke(form,new object[]{-1})!;
                var returned=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{chapterPort}/production/state"));
                if(returned.RootElement.GetProperty("chapter").GetInt32()!=before)throw new Exception("Native previous chapter failed");
                Console.WriteLine("PASS native chapter next and previous");
                await (Task)type.GetMethod("SendPush",flags)!.Invoke(form,new object[]{"Audio is off"})!;
                var pushed=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{chapterPort}/production/state"));
                if(pushed.RootElement.GetProperty("pushNotice").GetProperty("text").GetString()!="Audio is off")throw new Exception("Native push failed");
                var cameraLink=pushed.RootElement.GetProperty("links").EnumerateArray().First(x=>x.GetProperty("role").GetString()=="camera1").GetProperty("url").GetString()!;
                var cameraUri=new Uri(cameraLink);
                using var incoming=new HttpRequestMessage(HttpMethod.Post,cameraUri.GetLeftPart(UriPartial.Authority)+"/production/action");
                incoming.Headers.Authorization=new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer",cameraUri.Fragment[1..]);
                incoming.Content=new StringContent(JsonSerializer.Serialize(new {action="chat",showId,text="Camera ready",to="regie"}),System.Text.Encoding.UTF8,"application/json");
                using var incomingResponse=await http.SendAsync(incoming);incomingResponse.EnsureSuccessStatusCode();
                var received=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{chapterPort}/production/state"));
                var replyId=received.RootElement.GetProperty("messages").EnumerateArray().Last().GetProperty("id").GetInt32();
                await (Task)type.GetMethod("SendProductionAction",flags)!.Invoke(form,new object[]{"ack",new {id=replyId}})!;
                var confirmed=JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{chapterPort}/production/state"));
                var reply=confirmed.RootElement.GetProperty("messages").EnumerateArray().First(x=>x.GetProperty("id").GetInt32()==replyId);
                if(reply.GetProperty("receipt").GetProperty("confirmed").GetInt32()!=1)throw new Exception("Native understanding action failed");
                Console.WriteLine("PASS native push and understanding acknowledgement");
                stop.Invoke(form,null);
                var psi=new ProcessStartInfo("node") { WorkingDirectory=Path.Combine(AppContext.BaseDirectory,"bridge"),UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,RedirectStandardError=true };
                psi.ArgumentList.Add("server.js");psi.ArgumentList.Add("--demo");
                owner=Process.Start(psi)!;
                string? line;int ownerPort=0;
                while((line=await owner.StandardOutput.ReadLineAsync())!=null){if(line.StartsWith("READY ")){ownerPort=int.Parse(line[6..]);break;}}
                if(ownerPort==0)throw new Exception("External demo startup failed");
                await (Task)start.Invoke(form,new object[]{true})!;
                if((int)portField.GetValue(form)! !=ownerPort)throw new Exception("Inspector did not reuse demo");
                stop.Invoke(form,null);
                if(owner.HasExited)throw new Exception("Inspector killed shared owner");
                await http.GetStringAsync($"http://127.0.0.1:{ownerPort}/production/state");
                Console.WriteLine("PASS native Inspector reuses existing demo; disconnect preserves original owner");
            }
            catch(Exception ex){Console.Error.WriteLine(ex);code=1;}
            finally {if(owner!=null&&!owner.HasExited){owner.Kill(true);owner.WaitForExit();}form.Close();Application.Exit();}
        };
        Application.Run(form);
        Environment.ExitCode=code;
    }
}

