using System.Diagnostics;
using System.Drawing;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Windows.Forms;

namespace AtemInspector;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        System.Globalization.CultureInfo.DefaultThreadCurrentUICulture = System.Globalization.CultureInfo.GetCultureInfo("en-US");
        ApplicationConfiguration.Initialize();
        Application.Run(new InspectorForm(args.Contains("--demo", StringComparer.OrdinalIgnoreCase)));
    }
}

internal sealed class InspectorForm : Form
{
    private readonly TextBox ip = new() { Width = 148, Text = "192.168.1.240" };
    private readonly Button connect = new() { Text = "Connect", Width = 105 };
    private readonly Button demo = new() { Text = "Demo", Width = 78 };
    private readonly Button stop = new() { Text = "Disconnect", Width = 82 };
    private readonly Button export = new() { Text = "Save JSON", Width = 130 };
    private readonly TextBox filter = new() { Width = 270, PlaceholderText = "Filter path or value ..." };
    private readonly Label connectionStatus = new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold) };
    private readonly Label detailStatus = new() { AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169) };
    private readonly Label program = new() { AutoSize = true, Font = new Font("Segoe UI", 15, FontStyle.Bold), ForeColor = Color.FromArgb(255, 87, 114) };
    private readonly Label preview = new() { AutoSize = true, Font = new Font("Segoe UI", 15, FontStyle.Bold), ForeColor = Color.FromArgb(69, 204, 133) };
    private readonly Label info = new() { AutoSize = true, Font = new Font("Segoe UI", 10) };
    private readonly Label lastUpdate = new() { AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169) };
    private readonly TabControl tabs = new() { Dock = DockStyle.Fill };
    private readonly TextBox json = new() { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Both, ReadOnly = true, WordWrap = false, Font = new Font("Consolas", 9) };
    private readonly TextBox logs = new() { Dock = DockStyle.Fill, Multiline = true, ScrollBars = ScrollBars.Both, ReadOnly = true, WordWrap = true, Font = new Font("Consolas", 9) };
    private readonly Dictionary<TabPage, (DataGridView Grid, string[] Prefixes)> grids = new();
    private readonly System.Windows.Forms.Timer timer = new() { Interval = 800 };
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(3) };
    private Process? bridge;
    private int port;
    private bool busy;
    private bool starting;
    private bool closing;
    private long renderedVersion = -1;
    private JsonElement state;
    private bool hasState;
    private string lastJson = "";
    private bool isConnected;
    private string? bridgeError;
    private bool isDemo;
    private readonly Label cloudStatus = new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold) };
    private readonly Label cloudUrl = new() { AutoSize = true, ForeColor = Color.FromArgb(30, 80, 160) };
    private readonly Button cloudStart = new() { Text = "Start cloud tally", Width = 166, Height = 33 };
    private readonly Button cloudStop = new() { Text = "Stop cloud tally", Width = 160, Height = 33 };
    private readonly Button cloudAdmin = new() { Text = "Open Production Suite", Width = 190, Height = 33 };
    private readonly Dictionary<int, (PictureBox Picture, Label Name, Label Status, LinkLabel Link)> tallyCards = new();
    private string shownCloudUrl = "";
    private string shownAccessVersion = "";
    private string activeShowId = "";
    private bool refreshingCloud;
    private int cloudTicks;

    // Production show clock + director-to-camera messaging (control APIs remain localhost only).
    private readonly DateTimePicker showStart = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd HH:mm", Width = 175, ShowUpDown = false };
    private readonly DateTimePicker showEnd = new() { Format = DateTimePickerFormat.Custom, CustomFormat = "yyyy-MM-dd HH:mm", Width = 175, ShowUpDown = false };
    private readonly Button showApply = new() { Text = "Apply schedule", Width = 160, Height = 33 };
    private readonly Button showClear = new() { Text = "Reset clock", Width = 150, Height = 33 };
    private readonly Label showClockInfo = new() { AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169), Margin = new Padding(5, 7, 0, 9) };
    private readonly ComboBox chatTarget = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 135 };
    private readonly TextBox chatInput = new() { Width = 580, MaxLength = 240, PlaceholderText = "Message to a camera or all phones ..." };
    private readonly Button chatSend = new() { Text = "Send message", Width = 155, Height = 32 };
    private readonly ListBox chatHistory = new() { Height = 125, Width = 1115, HorizontalScrollbar = true, Font = new Font("Segoe UI", 10) };
    private readonly Label chatInfo = new() { AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169) };
    private bool loadedShowClock;

    private readonly List<int> nativeMessageIds = new();
    private readonly List<bool> nativeCanAck = new();
    private string nativeMessageKey = "";
    private readonly Button nativeMarkRead = new() { Text = "✓ Understood", AutoSize = true, Height = 34 };
    private readonly Label nativeUnread = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Color.FromArgb(255,87,114) };
    private readonly Button chapterPrevious = new() { Text = "← Chapter", Width = 105, Height = 32, Enabled = false };
    private readonly Button chapterNext = new() { Text = "Chapter →", Width = 105, Height = 32, Enabled = false };
    private readonly Label chapterInfo = new() { AutoSize = true, Margin = new Padding(10, 8, 0, 0) };
    private readonly Label productionHealth = new() { AutoSize = true };
    private int currentChapter;


    public InspectorForm(bool openDemo)
    {
        Text = "PRODOS Production Suite | ATEM Inspector 1.3";
        Width = 1360;
        Height = 860;
        MinimumSize = new Size(900, 600);
        Font = new Font("Segoe UI", 9);
        BackColor = Color.White;

        var header = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 54, WrapContents = false, Padding = new Padding(12, 10, 0, 0), BackColor = Color.FromArgb(243, 246, 249) };
        header.Controls.Add(new Label { Text = "ATEM-IP", AutoSize = true, Margin = new Padding(0, 7, 8, 0) });
        header.Controls.AddRange(new Control[] { ip, connect, demo, stop, export });
        var productionButton = new Button { Text = "Production Suite", Width = 150, Height = 28 };
        productionButton.Click += (_, _) => OpenCloudAdmin();
        header.Controls.Add(productionButton);
        Controls.Add(header);

        var statusBar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 54, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(14, 5, 0, 0) };
        statusBar.Controls.Add(connectionStatus);
        statusBar.Controls.Add(detailStatus);
        Controls.Add(statusBar);

        var toolBar = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 42, BackColor = Color.FromArgb(250, 250, 250), Padding = new Padding(12, 6, 0, 0) };
        toolBar.Controls.Add(new Label { Text = "Search", AutoSize = true, Margin = new Padding(0, 6, 8, 0) });
        toolBar.Controls.Add(filter);
        toolBar.Controls.Add(new Label { Text = "Only values in the active tab. 'All values' searches the entire ATEM state.", AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169), Margin = new Padding(14, 6, 0, 0) });
        Controls.Add(toolBar);

        var overview = new TabPage("Overview");
        var summary = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, Padding = new Padding(22, 24, 8, 0), AutoScroll = true, WrapContents = false };
        summary.Controls.Add(new Label { Text = "LIVE SWITCHER STATUS", AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Color.FromArgb(178, 181, 169), Margin = new Padding(0, 0, 0, 20) });
        summary.Controls.Add(program);
        summary.Controls.Add(preview);
        summary.Controls.Add(new Label { Height = 20 });
        summary.Controls.Add(info);
        summary.Controls.Add(lastUpdate);
        summary.Controls.Add(new Label { Height = 20 });
        summary.Controls.Add(new Label { Text = "Detail tabs show values reported by the ATEM protocol.\nThe JSON view contains the complete decoded state.\nThis application sends no control commands to the ATEM.", AutoSize = true, ForeColor = Color.FromArgb(178, 181, 169) });
        overview.Controls.Add(summary);
        tabs.TabPages.Add(overview);

        AddGridTab("Inputs", "inputs");
        AddGridTab("Video", "video");
        AddGridTab("Audio", "audio", "fairlight");
        AddGridTab("Media", "media");
        AddGridTab("Keyers & macros", "macro", "video.mixEffects", "video.downstreamKeyers");
        AddGridTab("Streaming & recording", "streaming", "recording");
        AddGridTab("System", "info", "settings", "status", "power", "time");
        AddGridTab("All values", "");

        CreateCloudTab();

        var jsonTab = new TabPage("JSON");
        jsonTab.Controls.Add(json);
        tabs.TabPages.Add(jsonTab);
        var logTab = new TabPage("Log");
        logTab.Controls.Add(logs);
        tabs.TabPages.Add(logTab);
        Controls.Add(tabs);
        tabs.BringToFront();

        ip.Text = PropertiesSettings.LoadIp();
        connect.Click += async (_, _) => await StartBridge(false);
        demo.Click += async (_, _) => await StartBridge(true);
        stop.Click += (_, _) => Disconnect();
        export.Click += (_, _) => ExportJson();
        tabs.SelectedIndexChanged += (_, _) => DrawActiveTab();
        filter.TextChanged += (_, _) => DrawActiveTab();
        timer.Tick += async (_, _) =>
        {
            await RefreshState();
            if (++cloudTicks % 3 == 0) await RefreshCloud();
        };
        FormClosing += (_, _) => { closing = true; timer.Stop(); StopBridge(); http.Dispose(); };
        connectionStatus.Text = "○ Not connected";
        detailStatus.Text = "Enter the ATEM IP address or start the demo.";
        program.Text = "PROGRAM   –";
        preview.Text = "PREVIEW    –";
        info.Text = "No ATEM data yet";
        lastUpdate.Text = "";
        ApplyStudioTheme(this);
        program.ForeColor = Color.FromArgb(255, 87, 114);
        preview.ForeColor = Color.FromArgb(69, 204, 133);
        if (openDemo) Shown += async (_, _) => await StartBridge(true);
    }

    private static void ApplyStudioTheme(Control root)
    {
        var background = Color.FromArgb(21, 22, 20);
        var panel = Color.FromArgb(29, 30, 27);
        var ink = Color.FromArgb(240, 240, 231);
        var accent = Color.FromArgb(255, 87, 114);
        root.BackColor = background;
        root.ForeColor = ink;
        if (root is TextBox or ComboBox or ListBox or DateTimePicker) root.BackColor = panel;
        if (root is Button button)
        {
            button.FlatStyle = FlatStyle.Flat;
            button.FlatAppearance.BorderColor = Color.FromArgb(80, 83, 72);
            button.BackColor = panel;
            button.ForeColor = ink;
            if (button.Text.Contains("Production Suite")) { button.BackColor = accent; button.ForeColor = background; }
        }
        if (root is LinkLabel link) { link.LinkColor = accent; link.ActiveLinkColor = ink; link.VisitedLinkColor = accent; }
        if (root is DataGridView grid)
        {
            grid.BackgroundColor = background;
            grid.GridColor = Color.FromArgb(80, 83, 72);
            grid.EnableHeadersVisualStyles = false;
            grid.DefaultCellStyle.BackColor = background;
            grid.DefaultCellStyle.ForeColor = ink;
            grid.DefaultCellStyle.SelectionBackColor = accent;
            grid.DefaultCellStyle.SelectionForeColor = background;
            grid.ColumnHeadersDefaultCellStyle.BackColor = panel;
            grid.ColumnHeadersDefaultCellStyle.ForeColor = ink;
        }
        foreach (Control child in root.Controls) ApplyStudioTheme(child);
    }

    private void CreateCloudTab()
    {
        var page = new TabPage("Cloud-Tally");
        var content = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true,
            Padding = new Padding(16, 18, 0, 12)
        };
        content.Controls.Add(new Label
        {
            Text = "PHONE TALLY  |  QR CODES FOR 8 CAMERAS",
            Font = new Font("Segoe UI", 13, FontStyle.Bold),
            AutoSize = true,
            Margin = new Padding(3, 2, 0, 12)
        });
        var buttons = new FlowLayoutPanel { Height = 47, Width = 1160, WrapContents = false };
        buttons.Controls.AddRange(new Control[] { cloudStart, cloudStop, cloudAdmin });
        content.Controls.Add(buttons);
        cloudStatus.Text = "Connect to an ATEM or start the demo first.";
        content.Controls.Add(cloudStatus);
        cloudUrl.Text = "No public address. Click 'Start cloud tally'.";
        cloudUrl.Margin = new Padding(3, 7, 0, 7);
        content.Controls.Add(cloudUrl);

        var showHeading = new Label { Text = "SHOW CLOCK · START / END", AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), Margin = new Padding(3, 19, 0, 9) };
        content.Controls.Add(showHeading);
        var today = DateTime.Now;
        showStart.Value = new DateTime(today.Year, today.Month, today.Day, today.Hour, today.Minute, 0).AddMinutes(10);
        showEnd.Value = showStart.Value.AddMinutes(90);
        var showControls = new FlowLayoutPanel { Height = 42, Width = 1140, WrapContents = false };
        showControls.Controls.Add(new Label { Text = "Start", AutoSize = true, Margin = new Padding(0, 8, 7, 0) });
        showControls.Controls.Add(showStart);
        showControls.Controls.Add(new Label { Text = "End", AutoSize = true, Margin = new Padding(14, 8, 7, 0) });
        showControls.Controls.Add(showEnd);
        showControls.Controls.Add(showApply);
        showControls.Controls.Add(showClear);
        content.Controls.Add(showControls);
        showClockInfo.Text = "Before start: countdown · on air: elapsed and remaining time · after scheduled end: overrun";
        content.Controls.Add(showClockInfo);
        var chapterControls = new FlowLayoutPanel { Height = 43, Width = 1140, WrapContents = false };
        chapterControls.Controls.AddRange(new Control[] { chapterPrevious, chapterNext, chapterInfo });
        content.Controls.Add(chapterControls);
        content.Controls.Add(productionHealth);
        chapterPrevious.Click += async (_, _) => await StepChapter(-1);
        chapterNext.Click += async (_, _) => await StepChapter(1);

        content.Controls.Add(new Label { Text = "DIRECTOR CHAT · CUES AND RESPONSES", AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), Margin = new Padding(3, 15, 0, 9) });
        chatTarget.Items.Add("Production team");
        for (int c = 1; c <= 8; c++) chatTarget.Items.Add($"CAM {c}");
        chatTarget.SelectedIndex = 0;
        var chatControls = new FlowLayoutPanel { Height = 43, Width = 1140, WrapContents = false };
        chatControls.Controls.AddRange(new Control[] { chatTarget, chatInput, chatSend });
        content.Controls.Add(chatControls);
        var quickCommands = new FlowLayoutPanel { Height = 40, Width = 1140 };
        foreach (var command in new[] { "Audio is off", "Audio is going live" })
        {
            var quick = new Button { Text = command, AutoSize = true, Height = 30 };
            quick.BackColor = Color.FromArgb(0,83,255); quick.ForeColor = Color.White;
            quick.Click += async (_, _) => await SendPush(command);
            quickCommands.Controls.Add(quick);
        }
        var freePush = new Button { Text = "Send input text as push", AutoSize = true, Height = 30 };
        freePush.Click += async (_,_) => await SendPush(chatInput.Text);
        quickCommands.Controls.Add(freePush);
        content.Controls.Add(quickCommands);
        content.Controls.Add(nativeUnread);
        content.Controls.Add(nativeMarkRead);
        nativeUnread.Text = "✓ acknowledged by at least one recipient · ✓✓ acknowledged by all recipients";
        nativeMarkRead.Enabled = false;
        chatHistory.SelectedIndexChanged += (_,_) => { var i=chatHistory.SelectedIndex; nativeMarkRead.Enabled=i>=0&&i<nativeCanAck.Count&&nativeCanAck[i]; };
        nativeMarkRead.Click += async (_,_) => {
            var i=chatHistory.SelectedIndex;if(i<0||i>=nativeMessageIds.Count)return;
            await SendProductionAction("ack",new {id=nativeMessageIds[i]});
        };
        content.Controls.Add(chatHistory);
        chatInfo.Text = "Messages are saved with the show. Open Production Suite for roles, scripts and show management.";
        chatInfo.Margin = new Padding(4, 5, 0, 0);
        content.Controls.Add(chatInfo);

        showApply.Click += async (_, _) => await SetShowSchedule(false);
        showClear.Click += async (_, _) => await SetShowSchedule(true);
        chatSend.Click += async (_, _) => await SendDirectorMessage();
        chatInput.KeyDown += async (_, e) => { if (e.KeyCode == Keys.Enter) { e.SuppressKeyPress = true; await SendDirectorMessage(); } };

        content.Controls.Add(new Label
        {
            AutoSize = true,
            ForeColor = Color.FromArgb(178, 181, 169),
            Text = "QR codes contain secret role links. Scan again after switching shows or renewing links. Open Production Suite for current codes."
        });
        var cards = new FlowLayoutPanel
        {
            Width = 1160,
            Height = 680,
            WrapContents = true,
            FlowDirection = FlowDirection.LeftToRight,
            Margin = new Padding(0, 14, 0, 0),
            AutoScroll = false
        };
        for (int i = 1; i <= 8; i++)
        {
            var camera = i;
            var group = new GroupBox { Text = $"CAM {camera}", Size = new Size(218, 286), Margin = new Padding(4, 0, 8, 12) };
            var picture = new PictureBox
            {
                Location = new Point(23, 29), Size = new Size(168, 168),
                SizeMode = PictureBoxSizeMode.Zoom, BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(245, 247, 250)
            };
            var name = new Label { Text = $"Camera {camera}", AutoEllipsis = true, Location = new Point(15, 201), Size = new Size(190, 20), Font = new Font("Segoe UI", 9, FontStyle.Bold) };
            var status = new Label { Text = "OFFLINE", Location = new Point(15, 225), Size = new Size(190, 20), ForeColor = Color.DarkOrange };
            var link = new LinkLabel { Text = "Open phone link", Location = new Point(15, 252), Size = new Size(190, 21), Visible = false };
            link.LinkClicked += (_, _) => OpenCloudCamera(camera);
            group.Controls.AddRange(new Control[] { picture, name, status, link });
            cards.Controls.Add(group);
            tallyCards.Add(camera, (picture, name, status, link));
        }
        content.Controls.Add(cards);
        page.Controls.Add(content);
        tabs.TabPages.Add(page);
        cloudStart.Click += async (_, _) => await ChangeCloud(true);
        cloudStop.Click += async (_, _) => await ChangeCloud(false);
        cloudAdmin.Click += (_, _) => OpenCloudAdmin();
    }

    private static string RoleLabel(string role) => role switch { "regie" => "DIRECTOR", "redaktion" => "EDITORIAL", "moderation" => "PRESENTER", "team" => "PRODUCTION TEAM", "all" => "ALL", _ => role.ToUpperInvariant() };

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
    }

    private async Task SendProductionAction(string action, object fields)
    {
        if(port==0)return;
        try {
            var values=JsonSerializer.Deserialize<Dictionary<string,JsonElement>>(JsonSerializer.Serialize(fields))!;
            values["action"]=JsonSerializer.SerializeToElement(action);values["showId"]=JsonSerializer.SerializeToElement(activeShowId);
            using var body=new StringContent(JsonSerializer.Serialize(values),Encoding.UTF8,"application/json");
            using var response=await http.PostAsync($"http://127.0.0.1:{port}/production/action",body);
            if(!response.IsSuccessStatusCode){using var err=JsonDocument.Parse(await response.Content.ReadAsStringAsync());throw new Exception(err.RootElement.GetProperty("error").GetString());}
            await RefreshCloud();
        }catch(Exception ex){AppendLog("Production message: "+ex.Message);chatInfo.Text=ex.Message;}
    }
    private Task SendPush(string text) => SendProductionAction("push",new {text});

    private async Task StepChapter(int step)
    {
        if (port == 0) return;
        chapterPrevious.Enabled = chapterNext.Enabled = false;
        try
        {
            using var body = new StringContent(JsonSerializer.Serialize(new { action = "chapter.step", step, expectedChapter = currentChapter, showId = activeShowId }), Encoding.UTF8, "application/json");
            using var response = await http.PostAsync($"http://127.0.0.1:{port}/production/action", body);
            if (!response.IsSuccessStatusCode) { using var error = JsonDocument.Parse(await response.Content.ReadAsStringAsync()); throw new Exception(error.RootElement.GetProperty("error").GetString()); }
            await RefreshCloud();
        }
        catch (Exception ex) { AppendLog("Chapter change: " + ex.Message); }
    }

    private void OpenCloudCamera(int camera)
    {
        if (string.IsNullOrWhiteSpace(shownCloudUrl)) return;
        try { OpenBrowser($"http://127.0.0.1:{port}/cloud/open/{camera}"); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not open link"); }
    }

    private void OpenCloudAdmin()
    {
        if (port == 0) { MessageBox.Show(this, "Connect to ATEM or demo first."); return; }
        try { OpenBrowser($"http://127.0.0.1:{port}/production"); }
        catch (Exception ex) { MessageBox.Show(this, ex.Message, "Could not open browser"); }
    }

    private async Task ChangeCloud(bool start)
    {
        if (port == 0) { MessageBox.Show(this, "Connect to ATEM or demo first."); return; }
        cloudStart.Enabled = cloudStop.Enabled = false;
        try
        {
            using var body = new ByteArrayContent(Array.Empty<byte>());
            var response = await http.PostAsync($"http://127.0.0.1:{port}/cloud/" + (start ? "start" : "stop"), body);
            response.EnsureSuccessStatusCode();
            await RefreshCloud();
        }
        catch (Exception ex)
        {
            cloudStatus.Text = "Cloud-Tally: " + ex.Message;
            AppendLog("Cloud-Tally: " + ex);
        }
        finally { cloudStart.Enabled = cloudStop.Enabled = true; }
    }

    private static long LocalTimestamp(DateTime dateTime) =>
        new DateTimeOffset(DateTime.SpecifyKind(dateTime, DateTimeKind.Local)).ToUnixTimeMilliseconds();

    private async Task SetShowSchedule(bool clear)
    {
        if (port == 0) { MessageBox.Show(this, "Connect to ATEM or demo first."); return; }
        var start = LocalTimestamp(showStart.Value);
        var end = LocalTimestamp(showEnd.Value);
        if (!clear && end <= start)
        {
            MessageBox.Show(this, "Show end must be after the start.", "Invalid show time");
            return;
        }
        showApply.Enabled = showClear.Enabled = false;
        try
        {
            var payload = clear ? new { clear = true } as object : new { startAt = start, endAt = end };
            using var body = new StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json");
            using var response = await http.PostAsync($"http://127.0.0.1:{port}/cloud/schedule", body);
            var result = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadApiError(result));
            showClockInfo.Text = clear ? "Show clock reset." : "Show schedule saved and sent to all phones.";
            await RefreshCloud();
        }
        catch (Exception ex) { showClockInfo.Text = "Clock error: " + ex.Message; AppendLog(showClockInfo.Text); }
        finally { showApply.Enabled = showClear.Enabled = true; }
    }

    private static string ReadApiError(string response)
    {
        try { using var doc = JsonDocument.Parse(response); return Value(doc.RootElement, "error") ?? response; }
        catch { return response; }
    }

    private async Task SendDirectorMessage()
    {
        if (port == 0) { MessageBox.Show(this, "Connect to ATEM or demo first."); return; }
        var message = chatInput.Text.Trim();
        if (message.Length == 0) return;
        var destination = chatTarget.SelectedIndex == 0 ? "all" : chatTarget.SelectedIndex.ToString();
        chatSend.Enabled = false;
        try
        {
            using var body = new StringContent(JsonSerializer.Serialize(new { to = destination, text = message }), Encoding.UTF8, "application/json");
            using var response = await http.PostAsync($"http://127.0.0.1:{port}/cloud/chat", body);
            var result = await response.Content.ReadAsStringAsync();
            if (!response.IsSuccessStatusCode) throw new InvalidOperationException(ReadApiError(result));
            chatInput.Clear();
            chatInfo.Text = destination == "all" ? "Message sent to the production team." : $"Message sent to CAM {destination}.";
            await RefreshCloud();
        }
        catch (Exception ex) { chatInfo.Text = "Message not sent: " + ex.Message; AppendLog(chatInfo.Text); }
        finally { chatSend.Enabled = true; }
    }

    private async Task RefreshCloud()
    {
        if (refreshingCloud || port == 0 || closing) return;
        refreshingCloud = true;
        try
        {
            var response = await http.GetStringAsync($"http://127.0.0.1:{port}/cloud/info");
            using var doc = JsonDocument.Parse(response);
            var root = doc.RootElement;
            using var productionDoc = JsonDocument.Parse(await http.GetStringAsync($"http://127.0.0.1:{port}/production/state"));
            var production = productionDoc.RootElement;
            currentChapter = production.GetProperty("chapter").GetInt32();
            var chapterNames = production.GetProperty("chapters").EnumerateArray().Select(c => c.GetString()).ToArray();
            chapterInfo.Text = chapterNames.Length == 0 ? "No chapter" : $"{currentChapter + 1}/{chapterNames.Length} · {chapterNames[currentChapter]}";
            chapterPrevious.Enabled = currentChapter > 0;
            chapterNext.Enabled = currentChapter < chapterNames.Length - 1;
            var required = production.GetProperty("requiredRoles").EnumerateArray().Select(p => p.GetString()).ToHashSet();
            var reachable = production.GetProperty("presence").EnumerateArray().Count(p => required.Contains(p.GetProperty("role").GetString()) && p.GetProperty("status").GetString() == "online");
            productionHealth.Text = $"Required roles reachable: {reachable}/{required.Count} · Open Production Suite for preflight, chapter timing, reading mode and show export";
            var newShowId = Value(root, "showId") ?? "";
            if (newShowId != activeShowId) { activeShowId = newShowId; loadedShowClock = false; nativeMessageKey = ""; }
            if (!loadedShowClock)
            {
                loadedShowClock = true;
                if (root.TryGetProperty("schedule", out var saved) && saved.ValueKind == JsonValueKind.Object &&
                    saved.TryGetProperty("startAt", out var s) && saved.TryGetProperty("endAt", out var e))
                {
                    showStart.Value = DateTimeOffset.FromUnixTimeMilliseconds(s.GetInt64()).LocalDateTime;
                    showEnd.Value = DateTimeOffset.FromUnixTimeMilliseconds(e.GetInt64()).LocalDateTime;
                }
            }
            if (root.TryGetProperty("chat",out var chat) && chat.ValueKind == JsonValueKind.Array)
            {
                var key=chat.GetRawText()+production.GetProperty("roleNames").GetRawText();
                if(key!=nativeMessageKey){
                    nativeMessageKey=key;
                    var oldTop=chatHistory.TopIndex;var selected=chatHistory.SelectedIndex;
                    var bottom=chatHistory.Items.Count==0||oldTop+Math.Max(1,chatHistory.ClientSize.Height/chatHistory.ItemHeight)>=chatHistory.Items.Count;
                    chatHistory.BeginUpdate();chatHistory.Items.Clear();nativeMessageIds.Clear();nativeCanAck.Clear();
                    foreach(var msg in chat.EnumerateArray()){
                        if(msg.TryGetProperty("ackFor",out var ack)&&ack.ValueKind==JsonValueKind.Number)continue;
                        var sender=Value(msg,"from")??"?";var from=sender=="camera"?"CAM "+Value(msg,"camera"):RoleLabel(sender);
                        var roleKey=sender=="camera"?"camera"+Value(msg,"camera"):sender;
                        if(production.GetProperty("roleNames").TryGetProperty(roleKey,out var named)&&!string.IsNullOrWhiteSpace(named.GetString()))from+=" · "+named.GetString();
                        var recipient=Value(msg,"to")??"?";var to=int.TryParse(recipient,out var cameraNumber)?"CAM "+cameraNumber:RoleLabel(recipient);
                        var ticks="";if(Value(msg,"channel")!="push"&&msg.TryGetProperty("receipt",out var receipt)){
                            var count=receipt.GetProperty("confirmed").GetInt32();var total=receipt.GetProperty("total").GetInt32();ticks=count==0?"":count>=total?"  ✓✓":"  ✓";
                        }
                        var time=DateTimeOffset.FromUnixTimeMilliseconds(msg.GetProperty("at").GetInt64()).LocalDateTime.ToString("HH:mm:ss");
                        var prefix=Value(msg,"channel")=="push"?"PUSH · ":"";
                        chatHistory.Items.Add($"{time}  {prefix}{from} → {to}: {Value(msg,"text")}{ticks}");
                        nativeMessageIds.Add(msg.GetProperty("id").GetInt32());nativeCanAck.Add(Bool(msg,"canAck"));
                    }
                    chatHistory.EndUpdate();
                    if(selected>=0&&selected<chatHistory.Items.Count)chatHistory.SelectedIndex=selected;
                    if(chatHistory.Items.Count>0)chatHistory.TopIndex=bottom?chatHistory.Items.Count-1:Math.Min(oldTop,chatHistory.Items.Count-1);
                }
            }
            var publicUrl = Value(root, "publicUrl") ?? "";
            var error = Value(root, "tunnelError") ?? "";
            var running = Bool(root, "cloudRunning");
            cloudStatus.Text = !string.IsNullOrEmpty(error) ? "ERROR: " + error :
                !string.IsNullOrEmpty(publicUrl) ? "● Cloud tally active · phones can scan QR codes" :
                running ? "◌ Cloud tunnel starting ..." : "○ Cloud tally off";
            cloudStatus.ForeColor = !string.IsNullOrEmpty(error) ? Color.FromArgb(255, 87, 114) :
                !string.IsNullOrEmpty(publicUrl) ? Color.FromArgb(69, 204, 133) : Color.FromArgb(178, 181, 169);
            cloudUrl.Text = !string.IsNullOrEmpty(publicUrl) ? publicUrl : "No public address yet";
            var accessVersion = Value(root, "accessVersion") ?? "";
            if (publicUrl != shownCloudUrl || accessVersion != shownAccessVersion)
            {
                shownCloudUrl = publicUrl;
                shownAccessVersion = accessVersion;
                foreach (var entry in tallyCards)
                {
                    var card = entry.Value;
                    var oldImage = card.Picture.Image;
                    card.Picture.Image = null;
                    oldImage?.Dispose();
                    card.Link.Visible = publicUrl.Length != 0;
                    if (publicUrl.Length == 0) continue;
                    try
                    {
                        var bytes = await http.GetByteArrayAsync($"http://127.0.0.1:{port}/cloud/qr/{entry.Key}.png");
                        using var stream = new MemoryStream(bytes);
                        using var temp = new Bitmap(stream);
                        card.Picture.Image = new Bitmap(temp);
                    }
                    catch (Exception ex) { AppendLog($"QR-Code CAM {entry.Key}: {ex.Message}"); }
                }
            }
            if (root.TryGetProperty("cameras", out var cameras) && cameras.ValueKind == JsonValueKind.Array)
                foreach (var camera in cameras.EnumerateArray())
                {
                    var num = camera.GetProperty("number").GetInt32();
                    if (!tallyCards.TryGetValue(num, out var card)) continue;
                    var status = Value(camera, "status") ?? "offline";
                    card.Name.Text = Value(camera, "name") ?? $"Camera {num}";
                    card.Status.Text = status switch
                    {
                        "program" => "● PROGRAM / LIVE",
                        "preview" => "● PREVIEW",
                        "off" => "○ OFF",
                        _ => "⚠ OFFLINE"
                    };
                    card.Status.ForeColor = status switch
                    {
                        "program" => Color.FromArgb(255, 87, 114),
                        "preview" => Color.FromArgb(69, 204, 133),
                        "off" => Color.FromArgb(178, 181, 169),
                        _ => Color.DarkOrange
                    };
                }
        }
        catch (Exception ex) { cloudStatus.Text = "Cloud tally unreachable: " + ex.Message; }
        finally { refreshingCloud = false; }
    }


    private void AddGridTab(string title, params string[] prefixes)
    {
        var page = new TabPage(title);
        var grid = new DataGridView
        {
            Dock = DockStyle.Fill,
            ReadOnly = true,
            RowHeadersVisible = false,
            AllowUserToAddRows = false,
            AllowUserToDeleteRows = false,
            AllowUserToResizeRows = false,
            AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill,
            SelectionMode = DataGridViewSelectionMode.FullRowSelect,
            MultiSelect = false,
            BackgroundColor = Color.White,
            BorderStyle = BorderStyle.None
        };
        grid.Columns.Add("path", "Value path");
        grid.Columns.Add("value", "Value");
        grid.Columns[0].FillWeight = 55;
        grid.Columns[1].FillWeight = 45;
        page.Controls.Add(grid);
        grids.Add(page, (grid, prefixes));
        tabs.TabPages.Add(page);
    }

    private async Task StartBridge(bool startDemo)
    {
        if (starting || closing) return;
        if (!startDemo && (!IPAddress.TryParse(ip.Text.Trim(), out var addr) || addr.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork))
        {
            MessageBox.Show(this, "Enter a valid IPv4 address, e.g. 192.168.1.240.", "Invalid ATEM IP", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }
        starting = true;
        connect.Enabled = demo.Enabled = false;
        Disconnect();
        var folder = Path.Combine(AppContext.BaseDirectory, "bridge");
        if (!File.Exists(Path.Combine(folder, "server.js")))
        {
            MessageBox.Show(this, "The 'bridge' folder is missing beside the executable. Run setup again.", "Missing file");
            starting = false;
            connect.Enabled = demo.Enabled = true;
            return;
        }
        try
        {
            var psi = new ProcessStartInfo("node")
            {
                WorkingDirectory = folder,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                CreateNoWindow = true
            };
            psi.ArgumentList.Add("server.js");
            psi.ArgumentList.Add("--reuse-existing");
            if (startDemo) psi.ArgumentList.Add("--demo");
            else
            {
                psi.ArgumentList.Add("--host");
                psi.ArgumentList.Add(ip.Text.Trim());
                PropertiesSettings.SaveIp(ip.Text.Trim());
            }
            var ready = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            string? startupError = null;
            var p = new Process { StartInfo = psi, EnableRaisingEvents = true };
            p.OutputDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data == null) return;
                if (eventArgs.Data.StartsWith("READY ") && int.TryParse(eventArgs.Data[6..], out int newPort)) ready.TrySetResult(newPort);
                else AppendLog("BRIDGE: " + eventArgs.Data);
            };
            p.ErrorDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data?.StartsWith("START_ERROR: ") == true) startupError = eventArgs.Data[13..];
                if (eventArgs.Data != null) AppendLog("ERROR: " + eventArgs.Data);
            };
            p.Exited += (_, _) => ready.TrySetException(new InvalidOperationException(startupError ?? "The bridge process exited. See the log."));
            if (!p.Start()) throw new InvalidOperationException("Could not start Node.js.");
            bridge = p;
            p.BeginOutputReadLine();
            p.BeginErrorReadLine();
            connectionStatus.Text = "◌ Starting local bridge ...";
            port = await ready.Task.WaitAsync(TimeSpan.FromSeconds(12));
            isDemo = startDemo;
            renderedVersion = -1;
            timer.Start();
            AppendLog(startDemo ? "Demo mode started" : "Connecting to ATEM " + ip.Text.Trim());
            await RefreshState();
            await RefreshCloud();
        }
        catch (Exception ex)
        {
            StopBridge();
            connectionStatus.Text = "○ Startup failed";
            detailStatus.Text = ex.Message;
            AppendLog("Startup failed: " + ex);
            MessageBox.Show(this, "Startup failed:\n" + ex.Message + "\n\nCheck Node.js and the 'bridge' folder. See the log for details.", "ATEM Inspector", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            starting = false;
            connect.Enabled = demo.Enabled = true;
        }
    }

    private async Task RefreshState()
    {
        if (busy || closing || port == 0) return;
        busy = true;
        try
        {
            var payload = await http.GetStringAsync($"http://127.0.0.1:{port}/state");
            using var doc = JsonDocument.Parse(payload);
            var root = doc.RootElement;
            isConnected = Bool(root, "connected");
            bridgeError = Value(root, "lastError");
            var version = Long(root, "version");
            connectionStatus.Text = isConnected ? (isDemo ? "● Demo running" : "● ATEM connected") : "○ ATEM disconnected / Connecting ...";
            connectionStatus.ForeColor = isConnected ? Color.FromArgb(69, 204, 133) : Color.DarkOrange;
            detailStatus.Text = bridgeError ?? (isDemo ? "Simulation without ATEM" : "Monitoring ATEM connection; reconnecting automatically.");
            if (version != renderedVersion && root.TryGetProperty("state", out var nextState) && nextState.ValueKind == JsonValueKind.Object)
            {
                state = nextState.Clone();
                hasState = true;
                renderedVersion = version;
                lastJson = JsonSerializer.Serialize(state, new JsonSerializerOptions { WriteIndented = true });
                UpdateSummary(root);
                DrawActiveTab();
            }
            else if (!isConnected && hasState)
            {
                lastUpdate.Text = "Showing the last received state (possibly outdated).";
            }
        }
        catch (Exception ex)
        {
            connectionStatus.Text = "○ Local bridge unreachable";
            connectionStatus.ForeColor = Color.FromArgb(255, 87, 114);
            detailStatus.Text = ex.Message;
        }
        finally { busy = false; }
    }

    private void UpdateSummary(JsonElement root)
    {
        var mixer = Find(state, "video.mixEffects[0]");
        var pgm = mixer is { } m ? Value(m, "programInput") : null;
        var pvw = mixer is { } n ? Value(n, "previewInput") : null;
        program.Text = "PROGRAM   " + SourceLabel(pgm);
        preview.Text = "PREVIEW    " + SourceLabel(pvw);
        var model = Find(state, "info.model")?.ToString() ?? "ATEM";
        info.Text = $"Model: {model}   |   {(isDemo ? "Demo" : ip.Text.Trim())}";
        lastUpdate.Text = "Last data change: " + (Value(root, "lastUpdate") ?? "unknown");
    }

    private string SourceLabel(string? id)
    {
        if (string.IsNullOrWhiteSpace(id)) return "–";
        var name = Find(state, $"inputs.{id}.longName")?.ToString();
        return string.IsNullOrWhiteSpace(name) ? $"Input {id}" : $"Input {id} · {name}";
    }

    private void DrawActiveTab()
    {
        if (!hasState) return;
        if (tabs.SelectedTab == null) return;
        if (tabs.SelectedTab.Text == "JSON") { if (json.Text != lastJson) json.Text = lastJson; return; }
        if (!grids.TryGetValue(tabs.SelectedTab, out var definition)) return;
        var grid = definition.Grid;
        var allRows = new List<(string Path, string Value)>();
        foreach (var prefix in definition.Prefixes)
        {
            var part = prefix.Length == 0 ? state : Find(state, prefix);
            if (part.HasValue) Flatten(part.Value, prefix, allRows, 0);
        }
        var term = filter.Text.Trim();
        grid.SuspendLayout();
        try
        {
            grid.Rows.Clear();
            int rendered = 0;
            foreach (var item in allRows)
            {
                if (term.Length != 0 && !item.Path.Contains(term, StringComparison.OrdinalIgnoreCase) && !item.Value.Contains(term, StringComparison.OrdinalIgnoreCase)) continue;
                grid.Rows.Add(item.Path, item.Value);
                if (++rendered >= 12000) break; // prevent WinForms freezing on enormous states
            }
        }
        finally { grid.ResumeLayout(); }
    }

    private static void Flatten(JsonElement element, string path, List<(string Path, string Value)> results, int depth)
    {
        if (results.Count >= 12000) return;
        if (depth > 32) { results.Add((path, "[Maximum depth reached]")); return; }
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                    Flatten(property.Value, path.Length == 0 ? property.Name : $"{path}.{property.Name}", results, depth + 1);
                break;
            case JsonValueKind.Array:
                int i = 0;
                foreach (var entry in element.EnumerateArray()) Flatten(entry, $"{path}[{i++}]", results, depth + 1);
                break;
            default:
                results.Add((path, element.ValueKind == JsonValueKind.Null ? "null" : element.ToString()));
                break;
        }
    }

    private static JsonElement? Find(JsonElement root, string path)
    {
        if (path.Length == 0) return root;
        var current = root;
        foreach (var token in path.Replace("[", ".[" ).Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            if (token.StartsWith('[') && token.EndsWith(']') && int.TryParse(token[1..^1], out var index))
            {
                if (current.ValueKind != JsonValueKind.Array || index < 0 || index >= current.GetArrayLength()) return null;
                current = current[index];
            }
            else
            {
                if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(token, out var value)) return null;
                current = value;
            }
        }
        return current;
    }

    private static string? Value(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var value) || value.ValueKind == JsonValueKind.Null) return null;
        return value.ToString();
    }
    private static bool Bool(JsonElement obj, string key) => obj.TryGetProperty(key, out var element) && element.ValueKind == JsonValueKind.True;
    private static long Long(JsonElement obj, string key) => obj.TryGetProperty(key, out var element) && element.TryGetInt64(out var number) ? number : 0;

    private void ExportJson()
    {
        if (!hasState) { MessageBox.Show(this, "No data available yet."); return; }
        using var dialog = new SaveFileDialog { Filter = "JSON (*.json)|*.json", FileName = "atem-state.json", Title = "Save ATEM state" };
        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            try
            {
                File.WriteAllText(dialog.FileName, lastJson, Encoding.UTF8);
                AppendLog("JSON exported: " + dialog.FileName);
                MessageBox.Show(this, "JSON saved. Configuration data may contain sensitive information.", "Export complete");
            }
            catch (Exception ex) { MessageBox.Show(this, ex.Message, "Save failed"); }
        }
    }

    private void Disconnect()
    {
        chapterPrevious.Enabled = chapterNext.Enabled = false;
        timer.Stop();
        StopBridge();
        renderedVersion = -1;
        isConnected = false;
        connectionStatus.Text = "○ Not connected";
        connectionStatus.ForeColor = Color.FromArgb(178, 181, 169);
        detailStatus.Text = hasState ? "Disconnected. The last state remains visible but is no longer current." : "No active connection.";
    }

    private void StopBridge()
    {
        shownCloudUrl = "";
        loadedShowClock = false;
        nativeMessageKey = "";
        chatHistory.Items.Clear();
        port = 0;
        var previous = bridge;
        bridge = null;
        if (previous == null) return;
        try
        {
            if (!previous.HasExited) previous.Kill(entireProcessTree: true);
            // Kill is asynchronous. Reopening before exit leaves the data lock live.
            if (!previous.WaitForExit(5000)) AppendLog("The previous bridge is still shutting down. Please wait.");
        }
        catch (InvalidOperationException) { /* process already exited */ }
        catch (System.ComponentModel.Win32Exception ex) { AppendLog("Could not stop bridge: " + ex.Message); }
        // Do not dispose immediately: pending redirected-output events can still arrive.
    }

    private void AppendLog(string entry)
    {
        if (closing || IsDisposed || !IsHandleCreated) return;
        try
        {
            if (InvokeRequired) { BeginInvoke(new Action<string>(AppendLog), entry); return; }
            logs.AppendText(DateTime.Now.ToString("HH:mm:ss") + "  " + entry + Environment.NewLine);
            if (logs.TextLength > 100000) logs.Text = logs.Text[^70000..];
        }
        catch (InvalidOperationException) { /* form closing */ }
    }
}

internal static class PropertiesSettings
{
    private static readonly string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PRODOS", "settings.txt");
    public static string LoadIp()
    {
        try
        {
            if (File.Exists(FilePath))
            {
                var value = File.ReadAllText(FilePath).Trim();
                if (IPAddress.TryParse(value, out _)) return value;
            }
        }
        catch { /* use example */ }
        return "192.168.1.240";
    }
    public static void SaveIp(string value)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            File.WriteAllText(FilePath, value);
        }
        catch { /* read-only settings directory; connection still works */ }
    }
}



