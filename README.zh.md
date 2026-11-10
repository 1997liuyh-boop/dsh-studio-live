# dsh-studio-live

[English](README.md)

**仓库名称：** `dsh-studio-live`

**仓库描述：**AI 游戏直播工作室，提供 DSH 会话、弹幕队列、语音形象、OBS 画面、Live2D/VRM 导入和可选游戏适配器。

`dsh-studio-live` 是独立安装的 DSH 工作室，提供直播页面、形象渲染器、弹幕与语音队列、OBS 桥接和可选游戏适配器。共享工作台只提供工作室容器和会话控制，不会安装本工作室或任何游戏。

## 功能与特性

- 为观众消息和游戏控制使用独立 DSH 会话，记录状态并支持停止操作。
- 通过 WBI 鉴权、心跳、解包、有限重试和内存 Cookie 接收 B 站弹幕。
- 最多排队 20 条弹幕和 8 句语音，支持去重、过期、取消和明确失败状态。
- 导入 VRM、PNG/WebP/JPG 及 Live2D Cubism 3/4 模型 ZIP，并将形象保存在本机 IndexedDB。
- 使用云端语音音量包络或本机语音近似驱动口型；预览与 OBS 共用渲染器。
- 通过带随机令牌的本机只读地址连接 OBS WebSocket v5。
- 在用户提供游戏、模组/运行时和本地服务器后，提供范围受限的星露谷和 Minecraft 适配器。

## 安装

本仓库在 `package.json` 的 `dsh.bundle.patch` 中声明 DSH 插件包。请使用 DSH Desktop 插件管理器，先添加控制包，再添加以下固定版本来源：

```text
github:1997liuyh-boop/dsh-studio-library#v0.1.3
github:1997liuyh-boop/dsh-studio-live#v0.3.1
```

确认插件管理器显示 `dsh-studio-live` 版本 `0.3.1`，然后打开“直播”工作室。本插件要求兼容的 `dsh-worktable ^0.6.0` 和 `dsh-studio-projects ^0.5.0`，由控制包提供。

本地开发需要 Node.js 22 和 npm：

```sh
npm install --include=dev --legacy-peer-deps
npm run build
npm run check
```

公开包包含编译后的插件和网页资源，但不包含 Live2D Cubism Core、Haru 样例或私人角色模型。导入获得授权的本地素材前，请阅读 [LIVE2D.md](LIVE2D.md)。

## 要求与限制

B 站需要有效的房间号和用户提供的登录 Cookie。云端语音需要联网，受服务可用性和配额影响。OBS、星露谷、SMAPI、.NET 6、Minecraft 和本地 Java 测试服务器均为外部要求，不随包分发，也不会自动启动。游戏动作有明确范围并提供紧急停止；适配器不提供通用寻路、战斗、钓鱼或自动切换装备。

Live2D ZIP 在本机校验，压缩包上限 32 MB，解压后 128 MB、256 个文件，单张贴图 4096×4096，总像素 3400 万。压缩包脚本、外部 URL 和越级路径会被拒绝。模型和语音数据留在本机；插件不会读取其他应用的 API Key 或私有配置。

## 来源与许可

本适配使用 DSH 宿主 [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness)、共享 [dsh-studio-library](https://github.com/1997liuyh-boop/dsh-studio-library)，并参考本机 ai-vtuber-live 资料及 [UPSTREAM.json](UPSTREAM.json) 列出的 MIT 依赖。本仓库原创代码采用 MIT 许可，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

Live2D Cubism Core、Haru 和样例模型遵循 Live2D 专有许可及样例素材条款，仅用于本地开发，排除在公开包之外。详见 [LIVE2D.md](LIVE2D.md) 和 [THIRD-PARTY-LIVE2D.txt](THIRD-PARTY-LIVE2D.txt)。
