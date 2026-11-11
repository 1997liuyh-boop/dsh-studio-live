# dsh-studio-live

AI 游戏直播：dsh 模型、弹幕队列、语音形象、OBS 与星露谷适配

本仓库根目录是可安装的 DSH 插件，版本 0.3.10。在插件市场添加本仓库 Git URL，安装后启用。先安装并启用 [工作室容器与共享运行时](https://github.com/1997liuyh-boop/dsh-studio-library)，再启用本插件。

直播工作室是独立安装、独立启停和独立更新的业务插件；共享工作台只提供列表、控制和会话容器，不会随基础库自动安装本工作室。没有安装本包时，工作室列表不会显示直播业务页面。

Git 安装使用已提交的 lib/ 与静态资源。开发时执行 npm install --include=dev --legacy-peer-deps、npm run build、npm run check；构建只使用本仓库源码与公开依赖，不引用相邻工作库。

Live2D Core、Haru 样例与私人模型未包含在公开包内；按 LIVE2D.md 自行授权并导入。

## 功能与上游说明


独立的 `dsh-studio-live` 插件，配合 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness) 使用。宿主 fork 自 [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)，共享容器源自 [Aisland-SJL/dsh-worktable](https://github.com/Aisland-SJL/dsh-worktable)。0.2 参考本机 ai-vtuber-live 的完整方案和弹幕、语音、VRM 实现，感谢原作者及上游贡献者。

## 开始使用

在 dsh 左侧“工作室”打开“直播工作室”。首次打开会显示仓库内置的鲸鱼女孩静态形象；导入 Live2D ZIP、VRM 或 PNG／WebP／JPG 形象后会替换默认形象并保存在本机。选择语音引擎，点击“开始本地预演”，再添加一条测试弹幕。没有游戏时可使用农场练习场；练习场不是星露谷。模型未配置会显示真实错误。

模型沿用 dsh 默认配置，不读取其他应用的 API Key。弹幕和游戏分别使用“直播工作室 · 弹幕”和“直播工作室 · 游戏”标准会话，输入、状态和输出进入会话记录，可在主窗口和悬浮球查看。两个会话分别推理，模型只能输出文字及白名单动作，不能执行系统工具。修改默认模型作用于之后创建的会话，已经建立的会话仍由 dsh 管理其模型。

弹幕队列最多 20 条，按 id 去重，90 秒未处理的弹幕明确记为过期；未完成回复保留。语音队列最多 8 句，完整句到达后立即开始合成，按入队顺序播完。本轮全部语音播放完成后，状态恢复为等待新弹幕或等待回复下一条弹幕；停止或失败不会被迟到的语音完成回调改为待机。停止、页面关闭或插件卸载会取消所属推理、语音和平台连接；页面失联超过 15 秒由宿主停止运行。语音已经播出的部分无法撤回，失败后重试可能重复该部分。

## B站、语音与形象

开始预演后，展开“B站直播弹幕”，填写数字房间号和当前登录 Cookie。连接过程包含 WBI 签名、房间号解析、协议鉴权、zlib／brotli 解包与心跳；收到成功鉴权回包后才显示“已鉴权”。连接异常按 1、2、4 秒等间隔重试，最长 30 秒，连续 8 次失败后停止重试。Cookie 仅保存在当前连接任务内存中，成功提交后从表单清除，停止后释放；不进入会话、文件或安装包。本功能只收弹幕，不以账号发弹幕，不自动推流。

默认使用 msedge-tts 云端语音，可选晓伊、晓晓、云希；失败时显示提示并尝试本机系统语音，也可主动选择系统语音或仅字幕。云端语音需要联网，可用性和免费额度由服务提供方决定。界面延迟从消息接收到实际开始播放计算，包含排队和合成；每句分别计时，不承诺固定两秒延迟。

形象最多 32 MB，保存在本机 IndexedDB；兼容旧版保存的静态图片，不上传仓库。内置默认形象是透明静态图片，不是已绑定的 Live2D Cubism 模型；自定义模型会覆盖它。VRM 需要内置贴图，支持待机呼吸、眨眼和手动表情；云端音频使用每 40ms 的音量包络驱动口型，系统语音采用近似张嘴动作。缺少对应表情的模型不会新增表情绑定。集显默认限制渲染像素比及 30fps；真实性能取决于模型复杂度。

OBS 安装后启用 WebSocket v5，填写本机端口和密码，检查状态并为已有场景添加形象浏览器源。形象源为带随机令牌的只读回环地址，卸载后失效。音频捕获 dsh 应用，形象源不会重复播放声音；游戏画面使用游戏捕获。插件不修改推流密钥，不自动开播。其他平台可连接已授权本机 WebSocket 弹幕桥，消息格式为 `{"id":"唯一标识","name":"观众名称","text":"弹幕内容"}`。

## Live2D

0.3.0 已接入 Live2D 本地验证：官方 Haru 样例、模型 ZIP 导入、本机保存、表情切换及预览／OBS 口型同步。专属 DeepSeek 模型可从同一入口替换；角色绘制与绑定需另行准备。操作、兼容范围和发行许可说明见 [Live2D 本地验证](LIVE2D.md)。

## 游戏

星露谷需要自行安装正版游戏、SMAPI 4 和 .NET 6 SDK，适配器说明见 [Windows 模组](studios/live/adapters/stardew/README.md)。仅支持单人、游戏前台中的有界移动与工具操作，F8 紧急停止；不支持自动装备切换、钓鱼和战斗策略。

Minecraft 选项使用独立 Worker 内的 Mineflayer，连接自己管理的 `127.0.0.1` Java 离线测试服；填写测试服端口和英文玩家名后开始预演。它不附带游戏或服务端，不登录微软账号，不改变服务器认证设置。动作包括半秒移动、转向、等待和三格内挖木头／石头，挖掘不会主动选择脚下方块；动作超时会断开连接。未实现寻路、合成、战斗及 prismarine-viewer 游戏画面；游戏状态明确标明真实连接情况，不用练习数据代替。停止时终止 Worker，连接准备阶段停止也不会继续创建 Worker。

当前机器未安装 OBS、星露谷或 Minecraft 服务端，不能据此宣称真实开播和游戏行为已经验收。B站真实鉴权需要用户提供有效登录态；测试不会读取 ai-vtuber-live 的私有配置。

## 独立构建和安装

需要 Node.js 22 及 npm。运行 `npm ci --ignore-scripts`、`npm run build`、`npm test`、`npm run check`、`npm run pack`，生成 `artifacts/dsh-studio-live-0.3.0.tgz` 和 SHA-256 清单。`npx tsc --noEmit` 额外检查源码类型，当前需要同级宿主源码提供 dsh 的类型声明。

先安装 `dsh-worktable ^0.6.0` 和 `dsh-studio-projects ^0.5.0`，再从 Windows dsh 插件管理器安装 tgz。Desktop profile 由应用自己的插件管理器维护。安装器会安装 Mineflayer 运行依赖；云端语音、VRM 和 UI 依赖随构建打包。当前交付兼容定制 dsh `0.2.2-rc.1`，保留 `0.2.1-rc.2` 支持；包的 `engines.dsh` 限定这两个宿主版本，其他版本需要另行验证。共享 SDK 固定快照见 SDK-SNAPSHOT.json。

本仓库自有代码采用 MIT 许可证；Live2D 官方运行库和模型素材遵循各自条款。感谢 [three-vrm](https://github.com/pixiv/three-vrm)、[Three.js](https://github.com/mrdoob/three.js)、[MsEdgeTTS](https://github.com/Migushthe2nd/MsEdgeTTS)、[ws](https://github.com/websockets/ws) 和 [Mineflayer](https://github.com/PrismarineJS/mineflayer)。普通构建不附带模型，用户自有模型需自行确认授权；本地验证构建包含官方 Haru 与通知，见 Live2D 说明。OBS、SMAPI 和游戏软件未随包分发。
