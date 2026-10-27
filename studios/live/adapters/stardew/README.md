# 星露谷本机适配器

Windows 单人游戏专用。需要正版星露谷物语、SMAPI 4 和 .NET 6 SDK；本机尚未安装游戏，因此本源码未通过游戏程序集编译或实机行动验证。资料：[SMAPI](https://smapi.io/) 与 [模组 API](https://stardewvalleywiki.com/Modding:Modder_Guide/APIs)。

在本目录运行 `dotnet build -c Release -p:GamePath="实际游戏目录"`。将生成的 `bin/Release/net6.0/DshLive.dll` 和 `manifest.json` 放入游戏 `Mods/DshLive/`。通过 SMAPI 启动并加载单人存档，首次运行生成 `config.json`；把其中 Port 和 Token 填入直播工作室的星露谷连接设置。令牌不提交、不对外分享。

游戏保持前台，OBS 和 dsh 留在后台。接口只监听 127.0.0.1，检查 Host 和 Bearer 令牌，拒绝浏览器 Origin；联网线程不访问游戏状态。无存档、多人模式、菜单、失去前台或超时均不接受行动；每个行动按下时间限定在 1–60 帧。超时请求不会延迟执行。F8 停止并释放按键；SMAPI 控制台 `dsh_live_resume` 或重新加载存档恢复。

默认键为 W/A/S/D 移动、C 使用当前工具、X 互动；如果修改了游戏键位，请同步 `config.json` 的 Keys。适配器不会自动换工具、购买或消耗其他物品；使用当前工具或种子前请在游戏中检查装备。`use` 和 `interact` 依游戏自身规则执行，不能保证每次都完成浇水或收获。

连接协议：`GET /state` 返回实际存档、位置、体力、时间和附近地形；`POST /action` 接收 `{"action":"up","frames":15}`，动作仅为 up/down/left/right/use/interact/stop。返回 accepted 只表示按键已提交，需下一次 state 确认实际游戏变化。stop 同时锁住后续动作，需手动恢复。
