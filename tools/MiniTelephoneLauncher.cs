// MiniTelephone 图形启动器（Windows）
// 首次打开：自动初始化（ListBox 滚动显示安装进度：检查 Node -> 装依赖 -> 构建前端）
// 之后打开：持续监控运行状态（运行状态 / 已运行时长 / 服务内存占用 / 系统剩余内存 /
//           磁盘剩余空间 / 访问地址），按钮启动 / 停止服务，端口可修改（保存在 launcher.ini）
// 编译：见 tools/build-launcher.cmd（使用 Windows 自带 csc.exe，无需安装 .NET SDK）
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Windows.Forms;

internal static class MiniTelephoneApp
{
    [STAThread]
    private static void Main()
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new MainForm());
    }
}

internal sealed class MainForm : Form
{
    private readonly string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');
    private readonly string iniPath;

    // 初始化面板
    private Panel initPanel;
    private ListBox initList;
    private Label initStatus;
    private Button initRetry;

    // 监控面板
    private Panel monPanel;
    private Label lblStatus;
    private Label lblUptime;
    private Label lblSvcMem;
    private Label lblSysMem;
    private Label lblDisk;
    private Label lblAddr;
    private TextBox txtPort;
    private Label lblPortNote;
    private Button btnStart;
    private Button btnStop;
    private Button btnOpen;
    private System.Windows.Forms.Timer timer;

    private int port = 3001;

    public MainForm()
    {
        iniPath = Path.Combine(root, "launcher.ini");
        port = LoadPort();

        Text = "MiniTelephone 小电话";
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(520, 460);
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
        Font = new Font("Microsoft YaHei UI", 9F);

        BuildInitPanel();
        BuildMonitorPanel();

        if (NeedInit()) ShowInit(false);
        else ShowMonitor();
    }

    // ---------------- 界面搭建 ----------------
    private void BuildInitPanel()
    {
        initPanel = new Panel();
        initPanel.Dock = DockStyle.Fill;
        initPanel.Visible = false;

        var title = new Label();
        title.Text = "首次运行，正在初始化…";
        title.Font = new Font(Font, FontStyle.Bold);
        title.AutoSize = true;
        title.Location = new Point(16, 12);

        initList = new ListBox();
        initList.Location = new Point(16, 40);
        initList.Size = new Size(488, 340);
        initList.HorizontalScrollbar = true;
        initList.Font = new Font("Consolas", 8.5F);

        initStatus = new Label();
        initStatus.Location = new Point(16, 390);
        initStatus.Size = new Size(380, 44);

        initRetry = new Button();
        initRetry.Text = "重试";
        initRetry.Location = new Point(410, 392);
        initRetry.Size = new Size(94, 34);
        initRetry.Visible = false;
        initRetry.Click += delegate { ShowInit(true); };

        initPanel.Controls.Add(title);
        initPanel.Controls.Add(initList);
        initPanel.Controls.Add(initStatus);
        initPanel.Controls.Add(initRetry);
        Controls.Add(initPanel);
    }

    private void BuildMonitorPanel()
    {
        monPanel = new Panel();
        monPanel.Dock = DockStyle.Fill;
        monPanel.Visible = false;

        lblStatus = new Label();
        lblStatus.Font = new Font(Font.FontFamily, 13F, FontStyle.Bold);
        lblStatus.AutoSize = true;
        lblStatus.Location = new Point(16, 12);

        var grid = new TableLayoutPanel();
        grid.Location = new Point(16, 52);
        grid.Size = new Size(488, 168);
        grid.ColumnCount = 2;
        grid.RowCount = 5;
        grid.CellBorderStyle = TableLayoutPanelCellBorderStyle.Single;
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 130));
        grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        for (int i = 0; i < 5; i++) grid.RowStyles.Add(new RowStyle(SizeType.Percent, 20));

        lblUptime = ValueLabel();
        lblSvcMem = ValueLabel();
        lblSysMem = ValueLabel();
        lblDisk = ValueLabel();
        lblAddr = ValueLabel();
        lblAddr.AutoEllipsis = true;

        AddRow(grid, 0, "运行时长", lblUptime);
        AddRow(grid, 1, "服务内存占用", lblSvcMem);
        AddRow(grid, 2, "系统剩余内存", lblSysMem);
        AddRow(grid, 3, "磁盘剩余空间", lblDisk);
        AddRow(grid, 4, "访问地址", lblAddr);

        var lblPort = new Label();
        lblPort.Text = "HTTP 端口：";
        lblPort.AutoSize = true;
        lblPort.Location = new Point(16, 240);

        txtPort = new TextBox();
        txtPort.Text = port.ToString();
        txtPort.Location = new Point(96, 236);
        txtPort.Size = new Size(70, 24);
        txtPort.TextChanged += delegate { OnPortEdited(); };

        lblPortNote = new Label();
        lblPortNote.AutoSize = true;
        lblPortNote.ForeColor = Color.Gray;
        lblPortNote.Location = new Point(176, 240);
        UpdatePortNote(false);

        btnStart = new Button();
        btnStart.Text = "启动服务";
        btnStart.Location = new Point(16, 284);
        btnStart.Size = new Size(150, 46);
        btnStart.BackColor = Color.FromArgb(5, 150, 105);
        btnStart.ForeColor = Color.White;
        btnStart.FlatStyle = FlatStyle.Flat;
        btnStart.Click += delegate { StartService(); };

        btnStop = new Button();
        btnStop.Text = "停止服务";
        btnStop.Location = new Point(184, 284);
        btnStop.Size = new Size(150, 46);
        btnStop.BackColor = Color.FromArgb(220, 38, 38);
        btnStop.ForeColor = Color.White;
        btnStop.FlatStyle = FlatStyle.Flat;
        btnStop.Click += delegate { StopService(); };

        btnOpen = new Button();
        btnOpen.Text = "打开页面";
        btnOpen.Location = new Point(352, 284);
        btnOpen.Size = new Size(150, 46);
        btnOpen.FlatStyle = FlatStyle.Flat;
        btnOpen.Click += delegate
        {
            TryOpenUrl("http://localhost:" + port + "/");
        };

        var tip = new Label();
        tip.Text = "关闭本窗口不会停止服务；再次打开可继续监控。端口修改在下次启动时生效。";
        tip.ForeColor = Color.Gray;
        tip.AutoSize = true;
        tip.Location = new Point(16, 348);

        monPanel.Controls.Add(lblStatus);
        monPanel.Controls.Add(grid);
        monPanel.Controls.Add(lblPort);
        monPanel.Controls.Add(txtPort);
        monPanel.Controls.Add(lblPortNote);
        monPanel.Controls.Add(btnStart);
        monPanel.Controls.Add(btnStop);
        monPanel.Controls.Add(btnOpen);
        monPanel.Controls.Add(tip);
        Controls.Add(monPanel);

        timer = new System.Windows.Forms.Timer();
        timer.Interval = 2500;
        timer.Tick += delegate { RefreshStatus(); };
    }

    private static Label ValueLabel()
    {
        var l = new Label();
        l.Dock = DockStyle.Fill;
        l.TextAlign = ContentAlignment.MiddleLeft;
        l.Padding = new Padding(6, 0, 0, 0);
        return l;
    }

    private static void AddRow(TableLayoutPanel grid, int row, string name, Control value)
    {
        var key = new Label();
        key.Text = name;
        key.Dock = DockStyle.Fill;
        key.TextAlign = ContentAlignment.MiddleLeft;
        key.Padding = new Padding(6, 0, 0, 0);
        key.ForeColor = Color.DimGray;
        grid.Controls.Add(key, 0, row);
        grid.Controls.Add(value, 1, row);
    }

    // ---------------- 初始化流程 ----------------
    private bool NeedInit()
    {
        return !NodeOk()
            || !Directory.Exists(Path.Combine(root, @"SRC\server\node_modules"))
            || !Directory.Exists(Path.Combine(root, @"SRC\client\node_modules"))
            || !Directory.Exists(Path.Combine(root, @"SRC\client\dist"));
    }

    private bool NodeOk()
    {
        string v;
        return TryCapture("node", "--version", out v);
    }

    private void ShowInit(bool retry)
    {
        monPanel.Visible = false;
        if (timer != null) timer.Stop();
        initPanel.Visible = true;
        initRetry.Visible = false;
        initList.Items.Clear();
        initStatus.Text = "";
        ThreadPool.QueueUserWorkItem(delegate { RunInit(); });
    }

    private void ShowMonitor()
    {
        initPanel.Visible = false;
        monPanel.Visible = true;
        RefreshStatus();
        timer.Start();
    }

    private void Log(string line)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string>(Log), line); return; }
        initList.Items.Add(line);
        initList.TopIndex = initList.Items.Count - 1;
    }

    private void SetInitStatus(string text, Color color, bool showRetry)
    {
        if (InvokeRequired) { BeginInvoke(new Action<string, Color, bool>(SetInitStatus), text, color, showRetry); return; }
        initStatus.Text = text;
        initStatus.ForeColor = color;
        initRetry.Visible = showRetry;
    }

    private void RunInit()
    {
        Log("== MiniTelephone 初始化开始 ==");
        Log("");

        Log("[1/4] 检查 Node.js …");
        string nodeVersion;
        if (!TryCapture("node", "--version", out nodeVersion))
        {
            Log("      未检测到 Node.js");
            SetInitStatus("未检测到 Node.js，请先安装 LTS 版本（https://nodejs.org）后点「重试」。", Color.Firebrick, true);
            return;
        }
        Log("      Node.js " + nodeVersion.Trim());
        Log("");

        Log("[2/4] 安装后端依赖（SRC\\server）…");
        if (RunShellLogged("npm install", Path.Combine(root, @"SRC\server")) != 0)
        {
            SetInitStatus("后端依赖安装失败，请检查网络后点「重试」。", Color.Firebrick, true);
            return;
        }
        Log("      后端依赖完成");
        Log("");

        Log("[3/4] 安装前端依赖（SRC\\client，可能需要几分钟）…");
        if (RunShellLogged("npm install", Path.Combine(root, @"SRC\client")) != 0)
        {
            SetInitStatus("前端依赖安装失败，请检查网络后点「重试」。", Color.Firebrick, true);
            return;
        }
        Log("      前端依赖完成");
        Log("");

        Log("[4/4] 构建前端…");
        if (RunShellLogged("npm run build", Path.Combine(root, @"SRC\client")) != 0)
        {
            SetInitStatus("前端构建失败，请查看上方日志后点「重试」。", Color.Firebrick, true);
            return;
        }
        Log("");
        Log("== 初始化完成，正在进入监控界面 ==");
        SetInitStatus("初始化完成。", Color.SeaGreen, false);
        if (InvokeRequired) { BeginInvoke(new Action(ShowMonitor)); } else { ShowMonitor(); }
    }

    // npm 在 Windows 上是 npm.cmd，必须经 cmd.exe 调用；输出逐行进 ListBox
    private int RunShellLogged(string command, string workdir)
    {
        try
        {
            var psi = new ProcessStartInfo("cmd.exe", "/c " + command + " 2>&1");
            psi.WorkingDirectory = workdir;
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.CreateNoWindow = true;
            using (var p = Process.Start(psi))
            {
                string line;
                while ((line = p.StandardOutput.ReadLine()) != null)
                {
                    if (line.Length > 0) Log("      " + line);
                }
                p.WaitForExit();
                return p.ExitCode;
            }
        }
        catch (Exception ex)
        {
            Log("      执行失败：" + ex.Message);
            return 1;
        }
    }

    // ---------------- 监控逻辑 ----------------
    private void RefreshStatus()
    {
        List<SvcProc> procs = FindServiceProcesses();
        if (procs.Count > 0)
        {
            DateTime oldest = DateTime.MaxValue;
            long memBytes = 0;
            foreach (SvcProc sp in procs)
            {
                if (sp.StartTime < oldest) oldest = sp.StartTime;
                memBytes += sp.WorkingSet;
            }
            TimeSpan up = DateTime.Now - oldest;
            lblStatus.Text = "● 服务运行中（" + procs.Count + " 个进程）";
            lblStatus.ForeColor = Color.SeaGreen;
            lblUptime.Text = FormatDuration(up);
            lblSvcMem.Text = FormatBytes(memBytes);
            btnStart.Enabled = false;
            btnStop.Enabled = true;
        }
        else
        {
            lblStatus.Text = "○ 服务已停止";
            lblStatus.ForeColor = Color.Gray;
            lblUptime.Text = "-";
            lblSvcMem.Text = "-";
            btnStart.Enabled = true;
            btnStop.Enabled = false;
        }

        lblSysMem.Text = FormatBytes((long)AvailablePhysicalMemory());
        lblDisk.Text = DiskFreeText();

        string ip = LanIPv4();
        string addr = "http://localhost:" + port + "/";
        if (ip != null)
        {
            addr += "    局域网 http://" + ip + ":" + port + "/    手机录音 https://" + ip + ":" + (port + 443) + "/";
        }
        lblAddr.Text = addr;
    }

    private void OnPortEdited()
    {
        int p;
        if (int.TryParse(txtPort.Text.Trim(), out p) && p >= 1024 && p <= 65535)
        {
            port = p;
            SavePort(p);
            txtPort.ForeColor = Color.Black;
            UpdatePortNote(FindServiceProcesses().Count > 0);
            RefreshStatus();
        }
        else
        {
            txtPort.ForeColor = Color.Firebrick;
        }
    }

    private void UpdatePortNote(bool running)
    {
        lblPortNote.Text = "（HTTPS = " + (port + 443) + (running ? "，重启后生效" : "") + "）";
    }

    private void StartService()
    {
        if (NeedInit()) { ShowInit(false); return; }
        if (FindServiceProcesses().Count > 0) return;
        try
        {
            var psi = new ProcessStartInfo("node", @"SRC\server\index.js");
            psi.WorkingDirectory = root;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.EnvironmentVariables["PORT"] = port.ToString();
            psi.EnvironmentVariables["HTTPS_PORT"] = (port + 443).ToString();
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("启动失败：" + ex.Message, "MiniTelephone", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        UpdatePortNote(true);
        // 等服务真正起来再刷新
        ThreadPool.QueueUserWorkItem(delegate
        {
            for (int i = 0; i < 40; i++)
            {
                Thread.Sleep(500);
                if (FindServiceProcesses().Count > 0) break;
            }
            if (InvokeRequired) BeginInvoke(new Action(RefreshStatus));
            else RefreshStatus();
        });
    }

    private void StopService()
    {
        List<SvcProc> procs = FindServiceProcesses();
        foreach (SvcProc sp in procs)
        {
            try
            {
                var psi = new ProcessStartInfo("taskkill", "/PID " + sp.Pid + " /T /F");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi).WaitForExit(5000);
            }
            catch { /* 尽力而为 */ }
        }
        UpdatePortNote(false);
        RefreshStatus();
    }

    // ---------------- 进程 / 系统信息 ----------------
    private sealed class SvcProc
    {
        public int Pid;
        public DateTime StartTime;
        public long WorkingSet;
    }

    private List<SvcProc> FindServiceProcesses()
    {
        var list = new List<SvcProc>();
        try
        {
            using (var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'"))
            using (var results = searcher.Get())
            {
                foreach (ManagementObject mo in results)
                {
                    string cmd = mo["CommandLine"] as string;
                    if (cmd == null) continue;
                    string c = cmd.Replace('/', '\\');
                    if (c.IndexOf(@"SRC\server\index.js", StringComparison.OrdinalIgnoreCase) < 0
                        && c.IndexOf(@"SRC\scripts\dev.mjs", StringComparison.OrdinalIgnoreCase) < 0
                        && c.IndexOf("--watch-path=index.js", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;
                    int pid = Convert.ToInt32(mo["ProcessId"]);
                    try
                    {
                        Process p = Process.GetProcessById(pid);
                        list.Add(new SvcProc { Pid = pid, StartTime = p.StartTime, WorkingSet = p.WorkingSet64 });
                    }
                    catch { /* 进程刚好退出 */ }
                }
            }
        }
        catch { /* WMI 不可用等情况 */ }
        return list;
    }

    [StructLayout(LayoutKind.Sequential)]
    private sealed class MEMORYSTATUSEX
    {
        public uint dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MEMORYSTATUSEX buffer);

    private static ulong AvailablePhysicalMemory()
    {
        try
        {
            var ms = new MEMORYSTATUSEX();
            if (GlobalMemoryStatusEx(ms)) return ms.ullAvailPhys;
        }
        catch { }
        return 0;
    }

    private string DiskFreeText()
    {
        try
        {
            string resDir = Path.Combine(root, "resource");
            string driveRoot = Path.GetPathRoot(Directory.Exists(resDir) ? resDir : root);
            var di = new DriveInfo(driveRoot);
            return FormatBytes(di.AvailableFreeSpace) + "（" + di.Name.TrimEnd('\\') + " 盘共 " + FormatBytes(di.TotalSize) + "）";
        }
        catch
        {
            return "-";
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 0) return "-";
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double v = bytes;
        int u = 0;
        while (v >= 1024 && u < units.Length - 1) { v /= 1024; u++; }
        return v.ToString(u == 0 ? "0" : "0.0") + " " + units[u];
    }

    private static string FormatDuration(TimeSpan t)
    {
        if (t.TotalHours >= 1) return ((int)t.TotalHours) + " 小时 " + t.Minutes + " 分";
        if (t.TotalMinutes >= 1) return t.Minutes + " 分 " + t.Seconds + " 秒";
        return t.Seconds + " 秒";
    }

    private static bool TryCapture(string file, string arguments, out string output)
    {
        output = "";
        try
        {
            var psi = new ProcessStartInfo(file, arguments);
            psi.UseShellExecute = false;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            using (var p = Process.Start(psi))
            {
                output = p.StandardOutput.ReadToEnd();
                p.WaitForExit();
                return p.ExitCode == 0;
            }
        }
        catch
        {
            return false;
        }
    }

    private string LanIPv4()
    {
        try
        {
            foreach (IPAddress addr in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
            {
                if (addr.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr))
                {
                    return addr.ToString();
                }
            }
        }
        catch { }
        return null;
    }

    private static void TryOpenUrl(string url)
    {
        try { Process.Start(url); } catch { /* 打不开浏览器不影响服务 */ }
    }

    // ---------------- 端口配置持久化 ----------------
    private int LoadPort()
    {
        try
        {
            if (File.Exists(iniPath))
            {
                foreach (string line in File.ReadAllLines(iniPath))
                {
                    string t = line.Trim();
                    if (t.StartsWith("PORT=", StringComparison.OrdinalIgnoreCase))
                    {
                        int p;
                        if (int.TryParse(t.Substring(5).Trim(), out p) && p >= 1024 && p <= 65535) return p;
                    }
                }
            }
        }
        catch { }
        return 3001;
    }

    private void SavePort(int p)
    {
        try { File.WriteAllText(iniPath, "PORT=" + p + Environment.NewLine); }
        catch { }
    }
}
