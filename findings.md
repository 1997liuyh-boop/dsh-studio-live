# Live2D 调研

- 现有版本 0.2.0，Git 工作区开始时干净。业务代码位于 studios/live；当前支持图片和内嵌纹理 VRM。
- 形象原始 Blob 保存在 IndexedDB，通过宿主上传端点进入内存，OBS 使用只读随机令牌地址。语音已有 40ms 音量包络，可以复用。
- pixi-live2d-display 最新 npm 版本为 0.4.0，要求 PixiJS 6.x 和独立 Cubism Core；优先使用 Cubism4 子入口以减少依赖和包体。
- 官方 CubismWebSamples 根 LICENSE 将 Haru、Hiyori 等列为 Free Material，并要求同时遵守具体样例条款。Cubism Core 使用独立专有许可，不能标为 MIT。
- 官方 SDK 发行页明确开发验证时不需要发行许可，Expandable Application 不适用一般个人或小规模企业的发行许可豁免。先完成本地验证，不公开分发 Core 和样例；公开发布另行确认适用许可。
- 已有会话中已向用户说明 ZIP 导入、口型、眨眼、呼吸、表情和透明 OBS 展示方案，用户要求实施并明确选择官方样例。
- PixiJS 6 通过 `@pixi/unsafe-eval` 的 `install({ ShaderSystem })` 在严格 CSP 中工作，名称并非要求开启 unsafe-eval；OBS 仅额外允许 WebAssembly 编译。
- 真实 Haru 样例已成功绘制，包含 42 个模型参数和 8 个独立表情。通过 `beforeModelUpdate` 在动作、物理计算后覆盖 LipSync 参数，实际绘制前的嘴型值与云端音量包络一致。
- 结果验证使用实际 Electron 工作室与独立 Edge 浏览器画面层；本机未安装 OBS，不将浏览器验证等同于真实 OBS 开播。
