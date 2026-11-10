using System.Collections.Concurrent;
using System.Net;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using StardewModdingAPI;
using StardewValley;

namespace DshLive;

/// <summary>仅在游戏前台、单人存档且无菜单时接收动作；联网线程不访问游戏对象。</summary>
public sealed class ModEntry : Mod
{
    private sealed class Config
    {
        public int Port { get; set; } = 33107;
        public string Token { get; set; } = "";
        public Dictionary<string, byte> Keys { get; set; } = new() { ["up"] = 87, ["down"] = 83, ["left"] = 65, ["right"] = 68, ["use"] = 67, ["interact"] = 88 };
    }
    private sealed record Command(string action, int frames);
    private sealed record Pending(Command Command, long Deadline, TaskCompletionSource<string> Result);
    private readonly ConcurrentQueue<Pending> pending = new();
    private readonly HttpListener listener = new();
    private Config config = new();
    private string snapshot = "{\"ready\":false}";
    private byte held;
    private int remaining;
    private volatile bool halted = true;
    private volatile bool closed;
    private bool canAct;

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr handle, out uint processId);
    [DllImport("user32.dll")] private static extern void keybd_event(byte key, byte scan, uint flags, UIntPtr extra);

    public override void Entry(IModHelper helper)
    {
        if (!OperatingSystem.IsWindows()) { Monitor.Log("当前适配器仅支持 Windows。", LogLevel.Error); return; }
        config = helper.ReadConfig<Config>();
        if (config.Port is < 1024 or > 65535) throw new InvalidOperationException("端口需为 1024–65535");
        if (config.Token.Length == 0) { config.Token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant(); helper.WriteConfig(config); }
        if (config.Token.Length != 64 || !config.Token.All(Uri.IsHexDigit)) throw new InvalidOperationException("连接令牌需为 64 位十六进制文本");
        listener.Prefixes.Add($"http://127.0.0.1:{config.Port}/");
        try { listener.Start(); } catch (HttpListenerException error) { Monitor.Log("本机连接失败：" + error.Message, LogLevel.Error); return; }
        helper.Events.GameLoop.UpdateTicked += (_, _) => Update();
        helper.Events.GameLoop.ReturnedToTitle += (_, _) => { halted = true; Release(); };
        helper.Events.Input.ButtonPressed += (_, e) => { if (e.Button == SButton.F8) { halted = true; Release(); Monitor.Log("直播控制已停止。重新加载存档或使用 dsh_live_resume 恢复。", LogLevel.Info); } };
        helper.Events.GameLoop.SaveLoaded += (_, _) => halted = false;
        helper.ConsoleCommands.Add("dsh_live_resume", "恢复本机直播游戏控制", (_, _) => { if (Context.IsWorldReady) halted = false; });
        AppDomain.CurrentDomain.ProcessExit += (_, _) => { closed = true; Release(); listener.Close(); };
        _ = Serve();
        Monitor.Log("直播桥已启动，连接令牌位于此模组 config.json。F8 随时停止。", LogLevel.Info);
    }

    private bool Foreground()
    {
        GetWindowThreadProcessId(GetForegroundWindow(), out uint process);
        return process == Environment.ProcessId;
    }

    private void Release()
    {
        if (held != 0) keybd_event(held, 0, 2, UIntPtr.Zero);
        held = 0; remaining = 0;
    }

    private void Update()
    {
        canAct = Context.IsWorldReady && !Context.IsMultiplayer && Game1.activeClickableMenu is null && Game1.player.CanMove && !halted && Foreground();
        if (!canAct || --remaining <= 0) Release();
        while (pending.TryDequeue(out Pending? row))
        {
            if (Environment.TickCount64 > row.Deadline) { row.Result.TrySetCanceled(); continue; }
            if (row.Command.action == "stop") { Release(); halted = true; row.Result.TrySetResult("{\"stopped\":true}"); continue; }
            if (!canAct) { row.Result.TrySetException(new InvalidOperationException("游戏必须在前台单人存档中，无菜单且未暂停；F8 后用 dsh_live_resume 恢复。")); continue; }
            if (held != 0) { row.Result.TrySetException(new InvalidOperationException("上一动作尚未完成")); continue; }
            held = config.Keys[row.Command.action]; remaining = row.Command.frames;
            keybd_event(held, 0, 0, UIntPtr.Zero);
            row.Result.TrySetResult(JsonSerializer.Serialize(new { accepted = true, action = row.Command.action, frames = remaining }));
        }
        if (!Context.IsWorldReady) { Volatile.Write(ref snapshot, "{\"ready\":false}"); return; }
        var player = Game1.player;
        var nearby = Game1.currentLocation.terrainFeatures.Pairs.Where(item => Math.Abs(item.Key.X - player.Tile.X) < 8 && Math.Abs(item.Key.Y - player.Tile.Y) < 8)
            .Take(100).Select(item => new { x = item.Key.X, y = item.Key.Y, feature = item.Value.GetType().Name }).ToArray();
        Volatile.Write(ref snapshot, JsonSerializer.Serialize(new { ready = canAct, halted, location = Game1.currentLocation.Name, x = player.Tile.X, y = player.Tile.Y,
            facing = player.FacingDirection, stamina = player.Stamina, health = player.health, time = Game1.timeOfDay, tool = player.CurrentTool?.Name, nearby }));
    }

    private async Task Serve()
    {
        while (!closed && listener.IsListening)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); } catch (Exception error) when (error is HttpListenerException or ObjectDisposedException) { break; }
            // 串行处理限制请求数量，正文上限在实际读取时执行。
            try
            {
                var request = context.Request;
                if (request.Headers["Host"] != $"127.0.0.1:{config.Port}" || request.Headers["Authorization"] != "Bearer " + config.Token || request.Headers["Origin"] is not null) { context.Response.StatusCode = 403; continue; }
                string result;
                if (request.Url?.AbsolutePath == "/state" && request.HttpMethod == "GET") result = Volatile.Read(ref snapshot);
                else if (request.Url?.AbsolutePath == "/action" && request.HttpMethod == "POST")
                {
                    using var memory = new MemoryStream();
                    byte[] buffer = new byte[1024];
                    int size;
                    while ((size = await request.InputStream.ReadAsync(buffer)) > 0) { if (memory.Length + size > 4096) throw new InvalidOperationException("请求过大"); memory.Write(buffer, 0, size); }
                    var command = JsonSerializer.Deserialize<Command>(memory.ToArray()) ?? throw new InvalidOperationException("动作无效");
                    if ((command.action != "stop" && !config.Keys.ContainsKey(command.action)) || command.frames is < 1 or > 60) throw new InvalidOperationException("动作或帧数无效");
                    var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                    if (pending.Count >= 4) throw new InvalidOperationException("游戏请求繁忙");
                    pending.Enqueue(new Pending(command, Environment.TickCount64 + 1800, completion));
                    result = await completion.Task.WaitAsync(TimeSpan.FromSeconds(2));
                }
                else { context.Response.StatusCode = 404; continue; }
                context.Response.ContentType = "application/json";
                byte[] data = Encoding.UTF8.GetBytes(result);
                await context.Response.OutputStream.WriteAsync(data);
            }
            catch (Exception error) { context.Response.StatusCode = 409; Monitor.Log("直播桥请求失败：" + error.Message, LogLevel.Warn); }
            finally { context.Response.Close(); }
        }
    }
}
