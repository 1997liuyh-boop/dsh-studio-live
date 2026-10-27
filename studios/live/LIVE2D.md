# Live2D 本地验证

0.3.0 增加 Live2D ZIP 导入、预览、语音口型、已有表情切换和 OBS 只读形象层，保留 VRM 与图片。当前使用 Live2D 官方 Haru 样例验证；没有制作专属 DeepSeek 角色立绘、PSD 拆分或 Cubism 绑定。

## 使用

在直播设置点击“载入 Live2D 官方样例”，加载完成后选择表情，添加测试弹幕并开始本地预演。导入自己的角色时，将导出的一个 `model3.json`、对应 `moc3`、PNG 贴图和引用的动作／表情／物理文件一起打成 ZIP，保留相对目录，从形象文件入口选择 ZIP。当前适配 Cubism 3／4 导出格式，不支持旧版 `model.json` 或 Cubism 编辑器工程文件，也不保证 Cubism 5 专属特性。

形象 ZIP 只保存在本机 IndexedDB，重新打开工作室会恢复。ZIP 最大 32 MB，解压后最多 128 MB、256 个文件，单张贴图最大 4096×4096，贴图总量最多 3400 万像素。仅提供模型引用的资源，不执行包内脚本，不允许外部链接和越级路径。导入校验失败时保留当前形象。模型自带声音被剥离，避免与主播语音重叠。

云端语音的音量包络驱动模型 LipSync 参数，未声明时使用 `ParamMouthOpenY`；本机语音使用近似口型。眨眼、呼吸和待机动作使用模型已有参数。表情名称来自模型导出内容，不保证所有角色包含相同表情。预览和 OBS 共用渲染器，OBS 读取口型、字幕和表情，不播放第二份音频。停止预演后口型归零；切换模型、关闭页面会释放渲染资源。

## 构建与许可

普通 `npm run build` 不下载或包含官方 Core 和样例，并清理前一次本地验证构建的这些文件。运行 Live2D 需要另行准备官方运行库；不含 Core 的包会明确拒绝 Live2D 导入，VRM 和图片仍可使用。

本机开发资源位于被 Git 忽略的 `.local-live2d/`：`live2dcubismcore.min.js`、`Haru.zip`、`NOTICE.txt` 和 `manifest.json`。运行 `npm run build -- --local-development`，完成检查后用 `npm run pack -- --local-development` 生成 `artifacts/local-development/dsh-studio-live-0.3.0.tgz`。含官方资源时普通打包入口会拒绝，防止误作公开包。直接运行底层 `npm pack` 不经过此检查；开发资源包不得上传公开仓库。

本库自有代码采用 MIT；PixiJS、pixi-live2d-display 与 fflate 的许可不替代 Live2D 官方条款。Cubism Core 适用 [Live2D Proprietary Software License Agreement](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html)，Haru 适用[免费素材条款](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)及[样例模型条款](https://www.live2d.com/eula/live2d-sample-model-terms_en.html)。官方[发行许可说明](https://www.live2d.com/en/download/cubism-sdk/release-license/)允许开发试用；可导入任意模型的直播软件属于需要单独确认发行许可的应用范围。本次只安装本地验证包，未发布包含运行库或样例的公开发行版。后续专属 DeepSeek 模型需另行准备并确认美术与角色授权。

Haru 来源：`Live2D/CubismWebSamples`，固定提交 `b1de66b0b1f1cb881d95fb6158622aeb6a2827bd`，目录 `Samples/Resources/Haru/`。模型资源 SHA-256、Core 下载地址及 SHA-256 记在本地构建清单内。

This content uses sample data owned and copyrighted by Live2D Inc. The sample data are utilized in accordance with terms and conditions set by Live2D Inc. This content itself is created at the author’s sole discretion.
