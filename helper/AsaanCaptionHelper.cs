// Asaan Caption Helper: a tiny Windows tray app. It lets the Asaan Caption
// website fetch a YouTube video's audio, and later only the clip parts the
// user picks, over this computer's own internet connection (yt-dlp). The
// website's server never downloads a video.
//
// One exe with three roles:
//   started from anywhere else   -> installs itself to %LOCALAPPDATA%\AsaanCaptionHelper, then starts
//   started from the install dir -> tray icon + a local server on http://localhost:47821
//   --uninstall                  -> removes itself (Windows Settings > Apps runs this)
//   --serve                      -> development: tray + server from wherever it is, installing nothing
//                                   (its tools folder is %ASAAN_HELPER_DIR%, or the usual one)
//
// The local server only answers the Asaan Caption website (Origin check), only
// for YouTube video links, and only proxies stream links yt-dlp itself returned.
//
// Built with the C# compiler that ships with Windows (C# 5): see build.ps1.

using System;
using System.Collections;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

[assembly: System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName = ".NET Framework 4.8")]
[assembly: AssemblyTitle("Asaan Caption Helper")]
[assembly: AssemblyDescription("Lets Asaan Caption get YouTube audio and clips through this computer")]
[assembly: AssemblyProduct("Asaan Caption Helper")]
[assembly: AssemblyCompany("Asaan Caption")]
[assembly: AssemblyCopyright("Asaan Caption")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]

namespace AsaanCaption
{
    static class App
    {
        public const string Version = "1.0.1";
        public const string Name = "Asaan Caption Helper";
        public const string SiteUrl = "https://www.asaancaption.com";
        public const string Protocol = "asaancaption-helper";
        public static readonly int[] Ports = { 47821, 47822, 47823 };
        public static readonly string Dir = Environment.GetEnvironmentVariable("ASAAN_HELPER_DIR") ?? Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AsaanCaptionHelper");
        /** Started with --serve: nothing is installed or registered. */
        public static bool DevServe;
        public static readonly string Exe = Path.Combine(Dir, "AsaanCaptionHelper.exe");
        public static readonly string YtDlp = Path.Combine(Dir, "yt-dlp.exe");
        public static readonly string Deno = Path.Combine(Dir, "deno.exe");
        const string LogName = "helper.log";
        public const string MutexName = @"Local\AsaanCaptionHelper";
        public const string QuitEventName = @"Local\AsaanCaptionHelper.Quit";
        public const string YtDlpUrl = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
        public const string DenoUrl = "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip";
        const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
        const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AsaanCaptionHelper";
        const string RunValue = "AsaanCaptionHelper";

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            // An app built for .NET 4.8 uses the system's TLS settings; make sure TLS 1.2 is on regardless.
            SecurityProtocolType p = ServicePointManager.SecurityProtocol;
            if (p != 0 && (p & (SecurityProtocolType)3072) == 0)
                ServicePointManager.SecurityProtocol = p | (SecurityProtocolType)3072;
            ServicePointManager.DefaultConnectionLimit = 32;
            try { SetProcessDPIAware(); } catch (Exception) { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            if (Array.IndexOf(args, "--uninstall") >= 0) { Uninstall(); return; }
            DevServe = Array.IndexOf(args, "--serve") >= 0;
            if (!DevServe && !IsInstalledCopy()) { Application.Run(new SetupForm()); return; }

            bool first;
            using (Mutex mutex = new Mutex(true, MutexName, out first))
            {
                if (!first) return; // Already running (for example, started again from the website's link).
                Application.Run(new TrayApp(Array.IndexOf(args, "--installed") >= 0));
                GC.KeepAlive(mutex);
            }
        }

        public static bool IsInstalledCopy()
        {
            return string.Equals(Path.GetFullPath(Application.ExecutablePath), Path.GetFullPath(Exe),
                StringComparison.OrdinalIgnoreCase);
        }

        /* ------------------------------------------------------------ logging */

        static readonly object logLock = new object();

        public static void Log(string message)
        {
            try
            {
                lock (logLock)
                {
                    Directory.CreateDirectory(Dir);
                    string path = Path.Combine(Dir, LogName);
                    FileInfo fi = new FileInfo(path);
                    if (fi.Exists && fi.Length > 1024 * 1024) File.Delete(path);
                    File.AppendAllText(path, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss ", CultureInfo.InvariantCulture) + message + Environment.NewLine);
                }
            }
            catch (Exception) { }
        }

        /* ------------------------------------------------- the running helper */

        /** Ask a running helper to quit; one that doesn't within `ms` (stuck) is ended. */
        public static void StopRunningHelper(int ms)
        {
            try
            {
                using (EventWaitHandle quit = EventWaitHandle.OpenExisting(QuitEventName)) quit.Set();
            }
            catch (WaitHandleCannotBeOpenedException) { }
            catch (Exception e) { Log("stop helper: " + e.Message); }
            if (!HelperGone(ms))
            {
                Log("the old helper didn't quit in time: ending it");
                int self = Process.GetCurrentProcess().Id;
                foreach (Process p in Process.GetProcessesByName("AsaanCaptionHelper"))
                {
                    try
                    {
                        if (p.Id != self && string.Equals(p.MainModule.FileName, Exe, StringComparison.OrdinalIgnoreCase))
                        {
                            p.Kill();
                            p.WaitForExit(3000);
                        }
                    }
                    catch (Exception e) { Log("end old helper: " + e.Message); }
                    finally { p.Dispose(); }
                }
                HelperGone(3000);
            }
            Thread.Sleep(300); // Let the process release its files.
        }

        /** True once no helper holds the single-instance lock (waits up to `ms`). */
        static bool HelperGone(int ms)
        {
            DateTime until = DateTime.UtcNow.AddMilliseconds(ms);
            for (;;)
            {
                try { using (Mutex.OpenExisting(MutexName)) { } }
                catch (WaitHandleCannotBeOpenedException) { return true; }
                catch (Exception) { return true; }
                if (DateTime.UtcNow >= until) return false;
                Thread.Sleep(150);
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool DeleteFile(string path);

        /** Drop the "downloaded from the internet" mark the copy inherits, so Windows doesn't stop it at sign-in. */
        public static void StripDownloadMark(string path)
        {
            try { DeleteFile(path + ":Zone.Identifier"); } catch (Exception) { }
        }

        /** The running helper's /ping answer, or null. */
        public static bool PingLocal(int timeoutMs)
        {
            foreach (int port in Ports)
            {
                try
                {
                    HttpWebRequest rq = (HttpWebRequest)WebRequest.Create("http://localhost:" + port + "/ping");
                    rq.Timeout = timeoutMs;
                    rq.Proxy = null;
                    using (HttpWebResponse r = (HttpWebResponse)rq.GetResponse())
                    using (StreamReader sr = new StreamReader(r.GetResponseStream()))
                    {
                        if (sr.ReadToEnd().Contains("asaan-caption-helper")) return true;
                    }
                }
                catch (Exception) { }
            }
            return false;
        }

        /* --------------------------------------------------------- registry */

        public static void Register()
        {
            string exe = "\"" + Exe + "\"";
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(RunKey))
                run.SetValue(RunValue, exe + " --background");

            using (RegistryKey proto = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + Protocol))
            {
                proto.SetValue("", "URL:" + Name);
                proto.SetValue("URL Protocol", "");
                using (RegistryKey icon = proto.CreateSubKey("DefaultIcon")) icon.SetValue("", exe + ",0");
                using (RegistryKey cmd = proto.CreateSubKey(@"shell\open\command")) cmd.SetValue("", exe + " \"%1\"");
            }

            using (RegistryKey un = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                un.SetValue("DisplayName", Name);
                un.SetValue("DisplayVersion", Version);
                un.SetValue("Publisher", "Asaan Caption");
                un.SetValue("DisplayIcon", Exe + ",0");
                un.SetValue("InstallLocation", Dir);
                un.SetValue("UninstallString", exe + " --uninstall");
                un.SetValue("URLInfoAbout", SiteUrl);
                un.SetValue("NoModify", 1, RegistryValueKind.DWord);
                un.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                un.SetValue("EstimatedSize", 20 * 1024, RegistryValueKind.DWord);
            }
        }

        public static bool StartsWithWindows()
        {
            using (RegistryKey run = Registry.CurrentUser.OpenSubKey(RunKey))
                return run != null && run.GetValue(RunValue) != null;
        }

        public static void SetStartWithWindows(bool on)
        {
            using (RegistryKey run = Registry.CurrentUser.CreateSubKey(RunKey))
            {
                if (on) run.SetValue(RunValue, "\"" + Exe + "\" --background");
                else run.DeleteValue(RunValue, false);
            }
        }

        static void Uninstall()
        {
            if (MessageBox.Show("Remove Asaan Caption Helper from this computer?\n\nYou can install it again from the website at any time.",
                    Name, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            StopRunningHelper(5000);
            try { SetStartWithWindows(false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + Protocol, false); } catch (Exception) { }
            try { Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false); } catch (Exception) { }
            // This exe can't delete itself while it runs: a hidden shell removes the folder a moment after it exits.
            try
            {
                ProcessStartInfo psi = new ProcessStartInfo("cmd.exe",
                    "/c ping 127.0.0.1 -n 3 > nul & rmdir /s /q \"" + Dir + "\"");
                psi.CreateNoWindow = true;
                psi.UseShellExecute = false;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);
            }
            catch (Exception) { }
            MessageBox.Show("Asaan Caption Helper was removed.", Name, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        /* -------------------------------------------------------- downloads */

        /** Download `url` to `path` (via a .part file), reporting 0..100 (or -1 when the size is unknown). */
        public static void Download(string url, string path, Action<int> progress)
        {
            string part = path + ".part";
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(url);
            rq.UserAgent = "AsaanCaptionHelper/" + Version;
            rq.Timeout = 30000;
            rq.ReadWriteTimeout = 30000;
            using (HttpWebResponse r = (HttpWebResponse)rq.GetResponse())
            using (Stream input = r.GetResponseStream())
            using (FileStream output = File.Create(part))
            {
                long total = r.ContentLength;
                long got = 0;
                byte[] buf = new byte[81920];
                int n, last = -2;
                while ((n = input.Read(buf, 0, buf.Length)) > 0)
                {
                    output.Write(buf, 0, n);
                    got += n;
                    int pct = total > 0 ? (int)(got * 100 / total) : -1;
                    if (pct != last && progress != null) { progress(pct); last = pct; }
                }
                if (total > 0 && got != total) throw new IOException("The download stopped early.");
            }
            if (File.Exists(path)) File.Delete(path);
            File.Move(part, path);
        }

        public static bool LooksLikeExe(string path)
        {
            try
            {
                using (FileStream f = File.OpenRead(path))
                    return f.Length > 1024 * 1024 && f.ReadByte() == 'M' && f.ReadByte() == 'Z';
            }
            catch (Exception) { return false; }
        }
    }

    /* =================================================================== setup */

    class SetupForm : Form
    {
        readonly Label title = new Label();
        readonly Label status = new Label();
        readonly ProgressBar bar = new ProgressBar();
        readonly Button button = new Button();
        bool done;

        public SetupForm()
        {
            // Laid out in 96-DPI pixels; Windows scales it to the screen's setting (125%, 150%, …)
            // so text never outgrows its box.
            SuspendLayout();
            AutoScaleDimensions = new SizeF(96f, 96f);
            AutoScaleMode = AutoScaleMode.Dpi;
            Text = App.Name;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            Font = new Font("Segoe UI", 9.75f);
            ClientSize = new Size(460, 196);
            BackColor = Color.White;

            title.Font = new Font("Segoe UI Semibold", 13f);
            title.SetBounds(24, 20, 412, 30);
            title.Text = "Setting up Asaan Caption Helper";
            status.SetBounds(24, 56, 412, 50);
            status.ForeColor = Color.FromArgb(70, 70, 80);
            status.Text = "Getting ready…";
            bar.SetBounds(24, 112, 412, 14);
            bar.Style = ProgressBarStyle.Marquee;
            button.SetBounds(316, 144, 120, 34);
            button.Visible = false;
            button.Click += delegate
            {
                if (done) Close();
                else { button.Visible = false; Begin(); }
            };
            Controls.AddRange(new Control[] { title, status, bar, button });
            Shown += delegate { Activate(); Begin(); };
            ResumeLayout(false);
        }

        void Begin()
        {
            title.Text = "Setting up Asaan Caption Helper";
            bar.Style = ProgressBarStyle.Marquee;
            Thread t = new Thread(Work);
            t.IsBackground = true;
            t.Start();
        }

        void Ui(Action a)
        {
            if (IsDisposed) return;
            try { BeginInvoke(a); } catch (Exception) { }
        }

        void Status(string text) { Ui(delegate { status.Text = text; }); }

        void Percent(int pct)
        {
            Ui(delegate
            {
                if (pct < 0) { bar.Style = ProgressBarStyle.Marquee; return; }
                bar.Style = ProgressBarStyle.Continuous;
                bar.Value = Math.Max(0, Math.Min(100, pct));
            });
        }

        void Work()
        {
            try
            {
                Status("Closing the old helper…");
                App.StopRunningHelper(6000);

                Status("Installing…");
                Directory.CreateDirectory(App.Dir);
                CopySelf();

                if (!App.LooksLikeExe(App.YtDlp))
                {
                    Status("Downloading the YouTube tools (about 18 MB)…");
                    App.Download(App.YtDlpUrl, App.YtDlp, delegate(int pct)
                    {
                        Percent(pct);
                        if (pct >= 0) Status("Downloading the YouTube tools… " + pct + "%");
                    });
                    if (!App.LooksLikeExe(App.YtDlp)) throw new IOException("The YouTube tools didn't download correctly.");
                }

                Percent(-1);
                Status("Starting…");
                App.Register();
                DateTime began = DateTime.Now;
                bool up = StartAndWait(30);
                if (!up)
                {
                    // Slow to answer or stuck (antivirus scanning it, a port still closing): start it afresh, once.
                    App.Log("the helper didn't answer: starting it again");
                    Status("Still starting…");
                    App.StopRunningHelper(3000);
                    up = StartAndWait(30);
                }
                if (!up) throw new IOException(WhyNotStarted(began));

                Ui(delegate
                {
                    done = true;
                    title.Text = "All set!";
                    status.Text = "Go back to Asaan Caption in your browser. It carries on by itself.";
                    bar.Style = ProgressBarStyle.Continuous;
                    bar.Value = 100;
                    button.Text = "Close";
                    button.Visible = true;
                    System.Windows.Forms.Timer close = new System.Windows.Forms.Timer();
                    close.Interval = 6000;
                    close.Tick += delegate { close.Stop(); Close(); };
                    close.Start();
                });
            }
            catch (Exception e)
            {
                App.Log("setup failed: " + e);
                string why = e is WebException
                    ? "Couldn't download the YouTube tools. Check your internet connection and try again."
                    : e.Message;
                Ui(delegate
                {
                    title.Text = "Setup didn't finish";
                    status.Text = why;
                    bar.Style = ProgressBarStyle.Continuous;
                    bar.Value = 0;
                    button.Text = "Try again";
                    button.Visible = true;
                });
            }
        }

        /** Start the installed helper and wait (up to `seconds`) for it to answer. */
        static bool StartAndWait(int seconds)
        {
            Process.Start(new ProcessStartInfo(App.Exe, "--installed") { UseShellExecute = false, WorkingDirectory = App.Dir });
            DateTime until = DateTime.UtcNow.AddSeconds(seconds);
            while (DateTime.UtcNow < until)
            {
                if (App.PingLocal(2000)) return true;
                Thread.Sleep(500);
            }
            return false;
        }

        /** A reason the user can act on, from what the helper logged since `began`. */
        static string WhyNotStarted(DateTime began)
        {
            try
            {
                string stamp = began.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                foreach (string line in File.ReadAllLines(Path.Combine(App.Dir, "helper.log")))
                {
                    if (line.Length > 19 && string.CompareOrdinal(line.Substring(0, 19), stamp) >= 0 && line.Contains(" port "))
                        return "Windows wouldn't let the helper open its connection (another program may be using it). Close other apps and click Try again.";
                }
            }
            catch (Exception) { }
            return "The helper didn't answer. If your antivirus asked about Asaan Caption Helper, allow it, then click Try again.";
        }

        static void CopySelf()
        {
            string self = Application.ExecutablePath;
            for (int attempt = 0; ; attempt++)
            {
                try
                {
                    File.Copy(self, App.Exe, true);
                    App.StripDownloadMark(App.Exe);
                    return;
                }
                catch (IOException)
                {
                    if (attempt >= 10) throw new IOException("The old helper is still closing. Wait a few seconds, then click Try again.");
                    Thread.Sleep(500);
                }
            }
        }
    }

    /* ==================================================================== tray */

    class TrayApp : ApplicationContext
    {
        readonly NotifyIcon icon = new NotifyIcon();
        readonly Control invoker = new Control();
        readonly HelperServer server = new HelperServer();

        public TrayApp(bool justInstalled)
        {
            invoker.CreateControl();
            IntPtr unused = invoker.Handle; // Forces the window handle so BeginInvoke works from other threads.

            ContextMenuStrip menu = new ContextMenuStrip();
            ToolStripMenuItem state = new ToolStripMenuItem(App.Name + " " + App.Version + " is running");
            state.Enabled = false;
            ToolStripMenuItem open = new ToolStripMenuItem("Open Asaan Caption");
            open.Click += delegate { OpenSite(); };
            ToolStripMenuItem startup = new ToolStripMenuItem("Start with Windows");
            startup.CheckOnClick = true;
            try { startup.Checked = App.StartsWithWindows(); } catch (Exception) { }
            startup.CheckedChanged += delegate
            {
                try { App.SetStartWithWindows(startup.Checked); } catch (Exception e) { App.Log("startup toggle: " + e.Message); }
            };
            ToolStripMenuItem quit = new ToolStripMenuItem("Quit");
            quit.Click += delegate { ExitThread(); };
            menu.Items.AddRange(new ToolStripItem[] { state, new ToolStripSeparator(), open, startup, new ToolStripSeparator(), quit });
            startup.Visible = !App.DevServe;

            try { icon.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { icon.Icon = SystemIcons.Application; }
            icon.Text = App.Name;
            icon.ContextMenuStrip = menu;
            icon.DoubleClick += delegate { OpenSite(); };
            icon.Visible = true;

            // Open the connection off the UI thread, retrying for a while: an old helper that is
            // just closing can still hold the port for a moment.
            Thread serve = new Thread(delegate()
            {
                bool ok = false;
                for (int attempt = 0; attempt < 15 && !ok; attempt++)
                {
                    ok = server.Start();
                    if (!ok) Thread.Sleep(2000);
                }
                Ui(delegate
                {
                    if (!ok) icon.ShowBalloonTip(8000, App.Name, "The helper couldn't open its connection. Right-click this icon, choose Quit, then start it again from the website.", ToolTipIcon.Error);
                    else if (justInstalled) icon.ShowBalloonTip(6000, "Asaan Caption Helper is ready", "Go back to your browser. Your video carries on by itself.", ToolTipIcon.Info);
                });
            });
            serve.IsBackground = true;
            serve.Start();

            Thread watcher = new Thread(WaitForQuit);
            watcher.IsBackground = true;
            watcher.Start();
            Thread upkeep = new Thread(Tools.Upkeep);
            upkeep.IsBackground = true;
            upkeep.Start();
        }

        static void OpenSite()
        {
            try { Process.Start(App.SiteUrl); } catch (Exception) { }
        }

        void Ui(Action a)
        {
            try { invoker.BeginInvoke(a); } catch (Exception) { }
        }

        void WaitForQuit()
        {
            using (EventWaitHandle quit = new EventWaitHandle(false, EventResetMode.AutoReset, App.QuitEventName))
            {
                quit.WaitOne();
            }
            Ui(new Action(ExitThread));
            // Backstop: if closing hangs, leave anyway so a new version can take over.
            Thread.Sleep(4000);
            Environment.Exit(0);
        }

        protected override void ExitThreadCore()
        {
            server.Stop();
            icon.Visible = false;
            icon.Dispose();
            base.ExitThreadCore();
        }
    }

    /* ============================================================== yt-dlp */

    class HelperError : Exception
    {
        public readonly string Code;
        public readonly int Status;
        public HelperError(int status, string code, string message) : base(message) { Status = status; Code = code; }
    }

    class Format
    {
        public string Id, Url, Mime, Codec;
        public long Size;
        public int Width, Height;
        public double Fps;
        public Dictionary<string, string> Headers = new Dictionary<string, string>();
    }

    class VideoInfo
    {
        public string Id, Title, Thumbnail;
        public double Duration;
        public Format Video, Audio;
        public DateTime Fetched, Expires;
    }

    static class Tools
    {
        static readonly ReaderWriterLockSlim toolLock = new ReaderWriterLockSlim();
        static string version;
        static DateTime lastUpdate = DateTime.MinValue;
        static readonly Regex IdRe = new Regex("^[A-Za-z0-9_-]{11}$");

        public static bool Ready { get { return File.Exists(App.YtDlp); } }

        /** yt-dlp's version once known (null until then). Never runs yt-dlp: /ping must answer at once. */
        public static string ToolVersion { get { return version; } }

        static readonly object versionLock = new object();

        /** Ask yt-dlp its version, in the background (it takes seconds, longer while antivirus scans it). */
        public static void RefreshVersion()
        {
            if (!Ready) return;
            lock (versionLock)
            {
                try
                {
                    string output, error;
                    if (Run("--version", 120000, out output, out error) == 0) version = output.Trim();
                }
                catch (Exception e) { App.Log("yt-dlp version: " + e.Message); }
            }
        }

        /** The 11-character video id of a YouTube link, or null. */
        public static string VideoId(string link)
        {
            Uri u;
            if (string.IsNullOrEmpty(link) || !Uri.TryCreate(link.Trim(), UriKind.Absolute, out u)) return null;
            if (u.Scheme != "https" && u.Scheme != "http") return null;
            string host = u.Host.ToLowerInvariant();
            foreach (string prefix in new[] { "www.", "m.", "music." })
                if (host.StartsWith(prefix)) host = host.Substring(prefix.Length);
            string[] segs = u.AbsolutePath.Trim('/').Split('/');
            string id = null;
            if (host == "youtu.be") id = segs[0];
            else if (host == "youtube.com" || host == "youtube-nocookie.com")
            {
                if (segs[0] == "watch") id = HttpUtility.ParseQueryString(u.Query)["v"];
                else if (segs.Length >= 2 && (segs[0] == "shorts" || segs[0] == "embed" || segs[0] == "live" || segs[0] == "v")) id = segs[1];
            }
            return id != null && IdRe.IsMatch(id) ? id : null;
        }

        /** Run yt-dlp; the exit code, with its output. */
        static int Run(string args, int timeoutMs, out string output, out string error)
        {
            ProcessStartInfo psi = new ProcessStartInfo(App.YtDlp, args);
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.StandardOutputEncoding = Encoding.UTF8;
            psi.StandardErrorEncoding = Encoding.UTF8;
            psi.WorkingDirectory = App.Dir;
            psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            using (Process p = Process.Start(psi))
            {
                System.Threading.Tasks.Task<string> outTask = p.StandardOutput.ReadToEndAsync();
                System.Threading.Tasks.Task<string> errTask = p.StandardError.ReadToEndAsync();
                if (!p.WaitForExit(timeoutMs))
                {
                    try { p.Kill(); } catch (Exception) { }
                    throw new HelperError(504, "timeout", "YouTube took too long to answer. Try again.");
                }
                p.WaitForExit();
                output = outTask.Result;
                error = errTask.Result;
                return p.ExitCode;
            }
        }

        /** Ask yt-dlp about a video: title, length and the two streams the website uses. */
        public static VideoInfo Resolve(string id)
        {
            if (!Ready) throw new HelperError(503, "not_ready", "The helper is still setting up. Run the installer again.");
            string args = "-J --no-playlist --no-warnings --no-progress --no-update";
            if (File.Exists(App.Deno)) args += " --js-runtimes \"deno:" + App.Deno + "\"";
            args += " -- \"https://www.youtube.com/watch?v=" + id + "\"";
            string output, error;
            int code;
            toolLock.EnterReadLock();
            try { code = Run(args, 120000, out output, out error); }
            finally { toolLock.ExitReadLock(); }
            if (code != 0) throw ExplainFailure(error);

            Dictionary<string, object> root;
            try
            {
                JavaScriptSerializer js = new JavaScriptSerializer();
                js.MaxJsonLength = int.MaxValue;
                js.RecursionLimit = 512;
                root = js.DeserializeObject(output) as Dictionary<string, object>;
            }
            catch (Exception e)
            {
                App.Log("yt-dlp json: " + e.Message);
                root = null;
            }
            if (root == null) throw new HelperError(502, "failed", "YouTube didn't return this video. Try again in a moment.");

            string live = Str(root, "live_status");
            if (Bool(root, "is_live") || live == "is_live" || live == "is_upcoming" || live == "post_live")
                throw new HelperError(422, "live", "Live streams can't be used. Try again after the stream has ended.");

            VideoInfo vi = new VideoInfo();
            vi.Id = id;
            vi.Title = Str(root, "title") ?? "YouTube video";
            vi.Thumbnail = Str(root, "thumbnail");
            vi.Duration = Num(root, "duration");
            vi.Fetched = DateTime.UtcNow;
            vi.Expires = DateTime.UtcNow.AddHours(3);

            double bestAudio = double.MinValue, bestVideo = double.MinValue;
            IEnumerable formats = root.ContainsKey("formats") ? root["formats"] as IEnumerable : null;
            if (formats != null)
            {
                foreach (object o in formats)
                {
                    Dictionary<string, object> f = o as Dictionary<string, object>;
                    if (f == null || Str(f, "protocol") != "https" || Str(f, "url") == null) continue;
                    string vcodec = Str(f, "vcodec") ?? "none", acodec = Str(f, "acodec") ?? "none", ext = Str(f, "ext");
                    if (vcodec == "none" && acodec.StartsWith("mp4a") && ext == "m4a")
                    {
                        Format a = ToFormat(f, "audio/mp4", acodec);
                        if (a == null) continue;
                        double score = Num(f, "language_preference") * 1e6 + (a.Id.Contains("drc") ? 0 : 1e4) + Num(f, "abr");
                        if (score > bestAudio) { bestAudio = score; vi.Audio = a; }
                    }
                    else if (acodec == "none" && vcodec.StartsWith("avc1") && ext == "mp4")
                    {
                        Format v = ToFormat(f, "video/mp4", vcodec);
                        if (v == null) continue;
                        int small = Math.Min(v.Width, v.Height);
                        if (small <= 0 || small > 1080) continue;
                        double score = small * 1e4 + Math.Min(v.Fps, 60) * 10 + Num(f, "tbr") / 1e4;
                        if (score > bestVideo) { bestVideo = score; vi.Video = v; }
                    }
                }
            }
            if (vi.Audio == null || vi.Video == null)
            {
                App.Log("no usable formats for " + id + " (audio " + (vi.Audio != null) + ", video " + (vi.Video != null) + ")");
                throw new HelperError(422, "no_formats", "This video can't be fetched in a format Asaan Caption can use.");
            }
            vi.Expires = Min(vi.Expires, ExpiryOf(vi.Audio.Url), ExpiryOf(vi.Video.Url));
            return vi;
        }

        static Format ToFormat(Dictionary<string, object> f, string mime, string codec)
        {
            Format fmt = new Format();
            fmt.Id = Str(f, "format_id");
            fmt.Url = Str(f, "url");
            fmt.Mime = mime;
            fmt.Codec = codec;
            fmt.Width = (int)Num(f, "width");
            fmt.Height = (int)Num(f, "height");
            fmt.Fps = Num(f, "fps");
            // The stream link carries its exact byte length (clen); the JSON size can be an estimate.
            long clen;
            string clenText = HttpUtility.ParseQueryString(new Uri(fmt.Url).Query)["clen"];
            fmt.Size = long.TryParse(clenText, out clen) ? clen : (long)Num(f, "filesize");
            if (fmt.Id == null || fmt.Size <= 0 || !Regex.IsMatch(fmt.Id, "^[A-Za-z0-9_-]{1,32}$")) return null;
            Dictionary<string, object> headers = f.ContainsKey("http_headers") ? f["http_headers"] as Dictionary<string, object> : null;
            if (headers != null)
                foreach (KeyValuePair<string, object> kv in headers)
                    if (kv.Value is string) fmt.Headers[kv.Key] = (string)kv.Value;
            return fmt;
        }

        static DateTime ExpiryOf(string url)
        {
            long expire;
            string text = HttpUtility.ParseQueryString(new Uri(url).Query)["expire"];
            if (!long.TryParse(text, out expire)) return DateTime.MaxValue;
            return new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddSeconds(expire).AddMinutes(-15);
        }

        static DateTime Min(DateTime a, DateTime b, DateTime c)
        {
            DateTime m = a < b ? a : b;
            return m < c ? m : c;
        }

        static HelperError ExplainFailure(string stderr)
        {
            string e = stderr ?? "";
            App.Log("yt-dlp failed: " + (e.Length > 600 ? e.Substring(0, 600) : e).Trim());
            if (e.Contains("Private video")) return new HelperError(422, "private", "This video is private.");
            if (e.Contains("confirm your age") || e.Contains("age-restricted") || e.Contains("inappropriate for some users"))
                return new HelperError(422, "age", "This video is age-restricted, so it can't be fetched.");
            if (e.Contains("members-only") || e.Contains("Join this channel"))
                return new HelperError(422, "members", "This video is for channel members only.");
            if (e.Contains("live event will begin") || e.Contains("Premieres in") || e.Contains("is_upcoming"))
                return new HelperError(422, "live", "This video hasn't started yet.");
            if (e.Contains("not a bot"))
                return new HelperError(429, "blocked", "YouTube is asking this computer to slow down. Wait a few minutes and try again.");
            if (e.Contains("Video unavailable") || e.Contains("This video is unavailable") || e.Contains("has been removed") || e.Contains("not available"))
                return new HelperError(422, "unavailable", "This video isn't available.");
            if (e.Contains("getaddrinfo") || e.Contains("Unable to download") || e.Contains("timed out") || e.Contains("Connection"))
                return new HelperError(502, "network", "Couldn't reach YouTube. Check your internet connection and try again.");
            return new HelperError(502, "failed", "YouTube didn't return this video. Try again in a moment.");
        }

        /** Update yt-dlp (YouTube changes often). True when a new version was installed. */
        public static bool Update()
        {
            if (!Ready || !toolLock.TryEnterWriteLock(0)) return false;
            try
            {
                lastUpdate = DateTime.UtcNow;
                string output, error;
                int code = Run("-U --no-warnings", 180000, out output, out error);
                bool updated = code == 0 && output.Contains("Updated yt-dlp");
                App.Log("yt-dlp update: " + output.Trim().Replace(Environment.NewLine, " | "));
                if (updated) RefreshVersion();
                return updated;
            }
            catch (Exception e)
            {
                App.Log("yt-dlp update failed: " + e.Message);
                return false;
            }
            finally { toolLock.ExitWriteLock(); }
        }

        /** After a failure nobody can explain: update yt-dlp (at most once an hour). True when it changed. */
        public static bool UpdateAfterFailure()
        {
            return DateTime.UtcNow - lastUpdate > TimeSpan.FromHours(1) && Update();
        }

        /** Background upkeep: get the JavaScript runtime yt-dlp prefers, and keep yt-dlp up to date. */
        public static void Upkeep()
        {
            RefreshVersion();
            Thread.Sleep(20000);
            for (;;)
            {
                if (!File.Exists(App.Deno)) FetchDeno();
                if (DateTime.UtcNow - lastUpdate > TimeSpan.FromHours(20)) Update();
                Thread.Sleep(TimeSpan.FromHours(6));
            }
        }

        static void FetchDeno()
        {
            string zip = Path.Combine(App.Dir, "deno.zip");
            try
            {
                App.Download(App.DenoUrl, zip, null);
                string tmp = App.Deno + ".part";
                using (ZipArchive archive = ZipFile.OpenRead(zip))
                {
                    ZipArchiveEntry entry = archive.GetEntry("deno.exe");
                    if (entry == null) throw new IOException("deno.exe missing from the download");
                    entry.ExtractToFile(tmp, true);
                }
                if (!App.LooksLikeExe(tmp)) throw new IOException("deno.exe looks broken");
                if (File.Exists(App.Deno)) File.Delete(App.Deno);
                File.Move(tmp, App.Deno);
                App.Log("deno installed");
            }
            catch (Exception e) { App.Log("deno download failed: " + e.Message); }
            finally { try { File.Delete(zip); } catch (Exception) { } }
        }

        /* ---------------------------------------------------------- json helpers */

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) ? v as string : null;
        }

        public static double Num(Dictionary<string, object> d, string key)
        {
            object v;
            if (!d.TryGetValue(key, out v) || v == null) return 0;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch (Exception) { return 0; }
        }

        static bool Bool(Dictionary<string, object> d, string key)
        {
            object v;
            return d.TryGetValue(key, out v) && v is bool && (bool)v;
        }
    }

    /* ========================================================= local server */

    class UpstreamExpired : Exception { }

    class HelperServer
    {
        const long MaxRange = 16L * 1024 * 1024;
        HttpListener listener;
        readonly Dictionary<string, VideoInfo> cache = new Dictionary<string, VideoInfo>();
        readonly Dictionary<string, object> resolving = new Dictionary<string, object>();
        static readonly Regex RangeRe = new Regex(@"^bytes=(\d+)-(\d*)$");
        static readonly Regex FormatRe = new Regex("^[A-Za-z0-9_-]{1,32}$");
        static readonly Regex IdRe = new Regex("^[A-Za-z0-9_-]{11}$");

        public bool Start()
        {
            foreach (int port in App.Ports)
            {
                HttpListener l = new HttpListener();
                // "localhost" only: Windows rejects any other Host header, so other machines and
                // DNS-rebinding pages can't reach this server.
                l.Prefixes.Add("http://localhost:" + port + "/");
                try { l.Start(); }
                catch (HttpListenerException e) { App.Log("port " + port + ": " + e.Message); l.Close(); continue; }
                listener = l;
                App.Log("helper " + App.Version + " listening on " + port);
                Thread t = new Thread(Loop);
                t.IsBackground = true;
                t.Start();
                return true;
            }
            return false;
        }

        /** Stop at once, dropping requests in flight (Close would wait for them). */
        public void Stop()
        {
            try { if (listener != null) listener.Abort(); } catch (Exception) { }
        }

        void Loop()
        {
            while (listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = listener.GetContext(); }
                catch (Exception) { break; }
                ThreadPool.QueueUserWorkItem(delegate { Handle(ctx); });
            }
        }

        static bool AllowedOrigin(string origin)
        {
            if (origin == "https://asaancaption.com" || origin == "https://www.asaancaption.com") return true;
            Uri u;
            if (!Uri.TryCreate(origin, UriKind.Absolute, out u)) return false;
            // Local development of the website.
            return u.Scheme == "http" && (u.Host == "localhost" || u.Host == "127.0.0.1");
        }

        void Handle(HttpListenerContext ctx)
        {
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;
            try
            {
                string origin = req.Headers["Origin"];
                if (origin != null)
                {
                    if (!AllowedOrigin(origin)) { res.StatusCode = 403; return; }
                    res.AppendHeader("Access-Control-Allow-Origin", origin);
                    res.AppendHeader("Vary", "Origin");
                    res.AppendHeader("Access-Control-Expose-Headers", "Content-Range, Content-Length");
                }
                if (req.HttpMethod == "OPTIONS")
                {
                    res.AppendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
                    res.AppendHeader("Access-Control-Allow-Headers", "Range");
                    res.AppendHeader("Access-Control-Max-Age", "600");
                    if (req.Headers["Access-Control-Request-Private-Network"] != null)
                        res.AppendHeader("Access-Control-Allow-Private-Network", "true");
                    res.StatusCode = 204;
                    return;
                }
                if (req.HttpMethod != "GET") { res.StatusCode = 405; return; }

                string path = req.Url.AbsolutePath;
                if (path == "/ping") Ping(res);
                else if (path == "/info") Info(req, res);
                else if (path.StartsWith("/media/")) Media(req, res, path);
                else Json(res, 404, Error("not_found", "Not found"));
            }
            catch (HelperError e)
            {
                TryJson(res, e.Status, Error(e.Code, e.Message));
            }
            catch (HttpListenerException) { /* The page went away mid-answer. */ }
            catch (Exception e)
            {
                App.Log("request failed: " + e);
                TryJson(res, 500, Error("helper_error", "Something went wrong in the helper. Try again."));
            }
            finally
            {
                try { res.Close(); } catch (Exception) { }
            }
        }

        void Ping(HttpListenerResponse res)
        {
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["app"] = "asaan-caption-helper";
            body["version"] = App.Version;
            body["ready"] = Tools.Ready;
            body["tools"] = Tools.ToolVersion;
            Json(res, 200, body);
        }

        void Info(HttpListenerRequest req, HttpListenerResponse res)
        {
            string id = Tools.VideoId(req.QueryString["url"]);
            if (id == null) throw new HelperError(400, "bad_url", "That isn't a link to a YouTube video.");
            VideoInfo vi;
            try { vi = Get(id, false); }
            catch (HelperError e)
            {
                // An unexplained failure is often an outdated yt-dlp: update once and try again.
                if (e.Code != "failed" || !Tools.UpdateAfterFailure()) throw;
                vi = Get(id, true);
            }
            Dictionary<string, object> body = new Dictionary<string, object>();
            body["id"] = vi.Id;
            body["title"] = vi.Title;
            body["duration"] = vi.Duration;
            body["thumbnail"] = vi.Thumbnail;
            body["video"] = Describe(vi.Video);
            body["audio"] = Describe(vi.Audio);
            Json(res, 200, body);
        }

        static Dictionary<string, object> Describe(Format f)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["format"] = f.Id;
            d["size"] = f.Size;
            d["mime"] = f.Mime;
            d["codec"] = f.Codec;
            if (f.Width > 0) { d["width"] = f.Width; d["height"] = f.Height; d["fps"] = f.Fps; }
            return d;
        }

        /** A video's info: cached, or from yt-dlp (one run per video at a time). `fresh` skips links that failed. */
        VideoInfo Get(string id, bool fresh)
        {
            DateTime asked = DateTime.UtcNow;
            VideoInfo vi;
            object gate;
            lock (cache)
            {
                if (!fresh && cache.TryGetValue(id, out vi) && vi.Expires > DateTime.UtcNow) return vi;
                if (!resolving.TryGetValue(id, out gate)) resolving[id] = gate = new object();
            }
            lock (gate)
            {
                lock (cache)
                {
                    if (cache.TryGetValue(id, out vi) && vi.Expires > DateTime.UtcNow && (!fresh || vi.Fetched > asked)) return vi;
                }
                vi = Tools.Resolve(id);
                lock (cache)
                {
                    cache[id] = vi;
                    if (cache.Count > 40)
                    {
                        string oldest = null;
                        foreach (KeyValuePair<string, VideoInfo> kv in cache)
                            if (oldest == null || kv.Value.Fetched < cache[oldest].Fetched) oldest = kv.Key;
                        cache.Remove(oldest);
                        resolving.Remove(oldest);
                    }
                }
                return vi;
            }
        }

        /** GET /media/{videoId}/{formatId} with a Range header: those bytes of the stream. */
        void Media(HttpListenerRequest req, HttpListenerResponse res, string path)
        {
            string[] parts = path.Split('/');
            if (parts.Length != 4 || !IdRe.IsMatch(parts[2]) || !FormatRe.IsMatch(parts[3]))
                throw new HelperError(404, "not_found", "Not found");
            Match m = RangeRe.Match(req.Headers["Range"] ?? "");
            if (!m.Success) throw new HelperError(400, "bad_range", "A byte range is required.");
            string id = parts[2], formatId = parts[3];

            for (int attempt = 0; ; attempt++)
            {
                VideoInfo vi = Get(id, attempt > 0);
                Format f = vi.Video.Id == formatId ? vi.Video : vi.Audio.Id == formatId ? vi.Audio : null;
                if (f == null) throw new HelperError(410, "gone", "This video changed. Start again.");
                long start = long.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
                long end = m.Groups[2].Value.Length > 0 ? long.Parse(m.Groups[2].Value, CultureInfo.InvariantCulture) : f.Size - 1;
                if (start >= f.Size || end < start) throw new HelperError(416, "bad_range", "That range is outside the video.");
                end = Math.Min(Math.Min(end, f.Size - 1), start + MaxRange - 1);
                try
                {
                    Proxy(f, start, end, res);
                    return;
                }
                catch (UpstreamExpired)
                {
                    // Stream links expire after a few hours: ask yt-dlp for fresh ones, once.
                    if (attempt > 0) throw new HelperError(502, "upstream", "YouTube stopped sending this video. Try again.");
                }
            }
        }

        static void Proxy(Format f, long start, long end, HttpListenerResponse res)
        {
            HttpWebRequest rq = (HttpWebRequest)WebRequest.Create(f.Url + "&range=" + start + "-" + end);
            rq.Timeout = 20000;
            rq.ReadWriteTimeout = 30000;
            rq.AutomaticDecompression = DecompressionMethods.None;
            foreach (KeyValuePair<string, string> h in f.Headers)
            {
                string k = h.Key.ToLowerInvariant();
                try
                {
                    if (k == "user-agent") rq.UserAgent = h.Value;
                    else if (k == "accept") rq.Accept = h.Value;
                    else if (k == "referer") rq.Referer = h.Value;
                    else if (k != "accept-encoding" && k != "connection" && k != "host" && k != "range" && k != "content-length")
                        rq.Headers[h.Key] = h.Value;
                }
                catch (ArgumentException) { }
            }

            HttpWebResponse up;
            try { up = (HttpWebResponse)rq.GetResponse(); }
            catch (WebException we)
            {
                HttpWebResponse r = we.Response as HttpWebResponse;
                int code = r != null ? (int)r.StatusCode : 0;
                if (r != null) r.Close();
                if (code == 403 || code == 404 || code == 410) throw new UpstreamExpired();
                App.Log("upstream " + code + ": " + we.Message);
                throw new HelperError(502, "upstream", code == 0
                    ? "Couldn't reach YouTube. Check your internet connection and try again."
                    : "YouTube stopped sending this video. Try again.");
            }
            using (up)
            using (Stream input = up.GetResponseStream())
            {
                long length = end - start + 1;
                if (up.ContentLength >= 0 && up.ContentLength < length)
                {
                    length = up.ContentLength;
                    end = start + length - 1;
                }
                res.StatusCode = 206;
                res.ContentType = f.Mime;
                res.AddHeader("Content-Range", "bytes " + start + "-" + end + "/" + f.Size);
                res.AddHeader("Cache-Control", "no-store");
                res.ContentLength64 = length;
                byte[] buf = new byte[65536];
                long left = length;
                while (left > 0)
                {
                    int n = input.Read(buf, 0, (int)Math.Min(buf.Length, left));
                    if (n <= 0) break;
                    res.OutputStream.Write(buf, 0, n);
                    left -= n;
                }
                if (left > 0) throw new HttpListenerException(0, "upstream ended early");
            }
        }

        static Dictionary<string, object> Error(string code, string message)
        {
            Dictionary<string, object> d = new Dictionary<string, object>();
            d["error"] = code;
            d["message"] = message;
            return d;
        }

        static void TryJson(HttpListenerResponse res, int status, object body)
        {
            try { Json(res, status, body); } catch (Exception) { }
        }

        static void Json(HttpListenerResponse res, int status, object body)
        {
            byte[] bytes = Encoding.UTF8.GetBytes(new JavaScriptSerializer().Serialize(body));
            res.StatusCode = status;
            res.ContentType = "application/json; charset=utf-8";
            res.AddHeader("Cache-Control", "no-store");
            res.ContentLength64 = bytes.Length;
            res.OutputStream.Write(bytes, 0, bytes.Length);
        }
    }
}
