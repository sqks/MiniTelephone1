// MiniTelephone 一键启动器（Windows）
// 逻辑：检查 Node.js -> 缺依赖自动 npm install -> 缺前端构建自动 build
//       -> 启动服务（默认生产模式 :3001；--dev 为开发模式 Vite:3000 + API:3001）
// 参数：--dev 开发模式 | --build 强制重新构建前端 | --no-browser 不自动打开浏览器
// 编译：见 tools/build-launcher.cmd（使用 Windows 自带 csc.exe，无需安装 .NET SDK）
using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;

internal static class MiniTelephoneLauncher
{
    private static Process child;

    private static int Main(string[] args)
    {
        bool dev = false, forceBuild = false, openBrowser = true;
        foreach (string a in args)
        {
            if (a == "--dev") dev = true;
            else if (a == "--build") forceBuild = true;
            else if (a == "--no-browser") openBrowser = false;
        }

        try { Console.OutputEncoding = Encoding.UTF8; } catch { /* 某些终端不支持，忽略 */ }
        // exe 放在项目根目录；以 exe 所在目录为工作目录，双击也能正常工作
        string root = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\', '/');

        Console.WriteLine("======================================");
        Console.WriteLine("   MiniTelephone 一键启动器 (Windows)");
        Console.WriteLine("======================================");

        // 1. 检查 Node.js
        string nodeVersion;
        if (!TryCapture("node", "--version", root, out nodeVersion))
        {
            Console.WriteLine();
            Console.WriteLine("[错误] 未检测到 Node.js，请先安装 LTS 版本：https://nodejs.org");
            TryOpenUrl("https://nodejs.org");
            PauseIfInteractive();
            return 1;
        }
        Console.WriteLine("[1/4] Node.js " + nodeVersion.Trim());

        // 2. 安装缺失的依赖
        if (!Directory.Exists(Path.Combine(root, @"SRC\server\node_modules")))
        {
            Console.WriteLine("[2/4] 首次运行，安装后端依赖…");
            if (RunShell("npm install", Path.Combine(root, @"SRC\server")) != 0) return Fail("后端依赖安装失败");
        }
        if (!Directory.Exists(Path.Combine(root, @"SRC\client\node_modules")))
        {
            Console.WriteLine("[2/4] 首次运行，安装前端依赖…（可能需要几分钟）");
            if (RunShell("npm install", Path.Combine(root, @"SRC\client")) != 0) return Fail("前端依赖安装失败");
        }
        Console.WriteLine("[2/4] 依赖就绪");

        // 3. 构建前端（生产模式且 dist 缺失，或显式 --build）
        bool distExists = Directory.Exists(Path.Combine(root, @"SRC\client\dist"));
        if (!dev && (forceBuild || !distExists))
        {
            Console.WriteLine("[3/4] 构建前端…");
            if (RunShell("npm run build", Path.Combine(root, @"SRC\client")) != 0) return Fail("前端构建失败");
        }
        Console.WriteLine("[3/4] 前端就绪");

        // 4. 启动
        int port = dev ? 3000 : 3001;
        if (PortInUse(3001))
        {
            Console.WriteLine();
            Console.WriteLine("[提示] 端口 3001 已被占用，MiniTelephone 可能已经在运行。");
            if (openBrowser) TryOpenUrl("http://localhost:" + (dev ? 3000 : 3001));
            PauseIfInteractive();
            return 0;
        }

        string script = dev ? @"SRC\scripts\dev.mjs" : @"SRC\server\index.js";
        Console.WriteLine("[4/4] 启动 " + (dev ? "开发服务器（Vite + API）" : "服务器") + " …");
        Console.WriteLine();

        child = new Process();
        child.StartInfo.FileName = "node";
        child.StartInfo.Arguments = quote(script);
        child.StartInfo.WorkingDirectory = root;
        child.StartInfo.UseShellExecute = false;
        try
        {
            child.Start();
        }
        catch (Exception ex)
        {
            return Fail("无法启动 Node 进程：" + ex.Message);
        }

        Console.CancelKeyPress += delegate(object sender, ConsoleCancelEventArgs e)
        {
            e.Cancel = true;      // 先拦截，留时间杀子进程树
            StopChildTree();
            Environment.Exit(0);
        };

        System.Threading.Thread.Sleep(1500); // 给服务器一点启动时间
        Console.WriteLine("--------------------------------------");
        Console.WriteLine("本机访问：  http://localhost:" + port + "/");
        foreach (string ip in LanIPv4Addresses())
        {
            Console.WriteLine("局域网访问：http://" + ip + ":" + port + "/   <- 手机连同一 WiFi 用这个");
        }
        Console.WriteLine("--------------------------------------");
        Console.WriteLine("按 Ctrl+C 或关闭本窗口即可停止服务。");
        Console.WriteLine();

        if (openBrowser) TryOpenUrl("http://localhost:" + port + "/");

        child.WaitForExit();
        return child.ExitCode;
    }

    private static string quote(string s)
    {
        return s.IndexOf(' ') >= 0 ? "\"" + s + "\"" : s;
    }

    private static int Fail(string message)
    {
        Console.WriteLine();
        Console.WriteLine("[错误] " + message);
        PauseIfInteractive();
        return 1;
    }

    private static void PauseIfInteractive()
    {
        try
        {
            if (!Console.IsInputRedirected)
            {
                Console.WriteLine();
                Console.WriteLine("按任意键退出…");
                Console.ReadKey(true);
            }
        }
        catch { /* 非交互终端 */ }
    }

    // 运行 node 之类的命令并捕获输出
    private static bool TryCapture(string file, string arguments, string workdir, out string output)
    {
        output = "";
        try
        {
            var psi = new ProcessStartInfo(file, arguments);
            psi.WorkingDirectory = workdir;
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

    // npm 在 Windows 上是 npm.cmd，必须经 cmd.exe 调用
    private static int RunShell(string command, string workdir)
    {
        var psi = new ProcessStartInfo("cmd.exe", "/c " + command);
        psi.WorkingDirectory = workdir;
        psi.UseShellExecute = false;
        using (var p = Process.Start(psi))
        {
            p.WaitForExit();
            Console.WriteLine();
            return p.ExitCode;
        }
    }

    private static bool PortInUse(int port)
    {
        // Windows 下 libuv 给 socket 设了 SO_REUSEADDR，bind 测试不可靠；
        // 直接探测本应用的 HTTP 接口，有响应就说明已在运行。
        try
        {
            var req = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:" + port + "/api/mode");
            req.Timeout = 1500;
            req.ReadWriteTimeout = 1500;
            using (req.GetResponse()) { return true; }
        }
        catch (WebException ex)
        {
            return ex.Response != null; // 非 2xx 响应也算服务在跑
        }
        catch
        {
            return false;
        }
    }

    private static string[] LanIPv4Addresses()
    {
        var list = new System.Collections.Generic.List<string>();
        try
        {
            foreach (IPAddress addr in Dns.GetHostEntry(Dns.GetHostName()).AddressList)
            {
                if (addr.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr))
                {
                    string s = addr.ToString();
                    if (!list.Contains(s)) list.Add(s);
                }
            }
        }
        catch { /* 无网卡等情况忽略 */ }
        return list.ToArray();
    }

    private static void TryOpenUrl(string url)
    {
        try { Process.Start(url); } catch { /* 打不开浏览器不影响服务 */ }
    }

    private static void StopChildTree()
    {
        try
        {
            if (child != null && !child.HasExited)
            {
                // /T 杀掉整棵进程树（node -> vite / 子进程）
                var psi = new ProcessStartInfo("taskkill", "/PID " + child.Id + " /T /F");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                Process.Start(psi).WaitForExit(3000);
            }
        }
        catch { /* 尽力而为 */ }
    }
}
