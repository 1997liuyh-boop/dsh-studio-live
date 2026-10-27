# AI 游戏直播工作室

独立的 `dsh-studio-live` 插件，配合 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness) 使用。宿主 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，共享容器源自 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable)。感谢上游团队与贡献者。

## 使用范围

在 dsh 左侧“工作室”展开“直播工作室”。无需 OBS 或游戏即可上传 PNG／WebP／JPG 形象、预演弹幕回复、播放系统中文语音，并用真实 dsh 默认模型驱动内置农场练习场。练习场不是星露谷，PNG 说话动作不是 Live2D。模型未配置时显示真实错误。

直播推理使用独立标准 dsh 会话，原文输入、游戏状态和输出进入会话历史；不复制模型密钥。会话工具受到限制，模型只能返回文字及预定义动作。弹幕队列最多 20 条、按 id 去重，失败保留待回复内容；停止只取消本工作室任务。页面关闭会停止推理和语音，不执行后台开播。

OBS 安装后启用 WebSocket v5，填写本机端口和密码即可检查状态、选择已有场景并添加形象浏览器源。游戏画面用 OBS 游戏捕获，语音用应用音频捕获。插件不修改推流密钥、不自动开播；开播和录制由 OBS 控制。本机叠加层使用随机只读链接，卸载插件后关闭；密码只留在当前页面内存。形象数据保存在本机浏览器存储，不进入安装包。

“平台弹幕桥”接收已授权本机 `ws://127.0.0.1:<port>` WebSocket，逐条消息格式为 `{"id":"唯一标识","name":"观众名称","text":"弹幕内容"}`。回复通过主播语音和字幕播出。当前未内置 B站账号授权或平台弹幕采集；手动输入用于本地预演，不能视为已连上直播间。

## 星露谷物语

需要自行安装正版游戏、SMAPI 4 和 .NET 6 SDK。随包提供 Windows 单人模式适配器源码，见 [适配器说明](adapters/stardew/README.md)。适配器只读取游戏线程生成的状态快照，并在游戏前台时执行有界按键。F8 紧急停止，默认单次最多 60 帧；不支持多人、菜单中行动、自动装备切换、钓鱼和战斗策略。

当前机器尚未安装游戏和 OBS：插件的本地功能、协议与打包已验证；SMAPI 编译与游戏内动作、真实 OBS 场景及平台直播需要安装后实机联调，不能视为已经验证。

## 独立构建与引入

需要 Node.js 22 及 npm。运行 `npm ci --ignore-scripts`、`npm run build`、`npm test`、`npm run check`、`npm run pack`。生成 `artifacts/dsh-studio-live-0.1.1.tgz` 和 SHA-256 清单。

先安装兼容的 `dsh-worktable ^0.6.0` 和 `dsh-studio-projects ^0.5.0`，再在 dsh“插件 → 添加插件”中输入 tgz 的绝对路径，安装并启用。Windows 桌面端由应用自己的插件管理器维护 Desktop profile，普通源码 CLI 无法修改它。实测目标是定制 dsh 0.2.1-rc.2。

共享 SDK 固定快照见 SDK-SNAPSHOT.json；本工作室没有复制其他工作室业务代码。本仓库使用 MIT 许可证，SMAPI 与 OBS 只通过各自接口连接，未内置或重新分发它们的软件。
