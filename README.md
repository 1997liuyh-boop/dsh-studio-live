# dsh-studio-live

[简体中文](README.zh.md)

**Repository name:** `dsh-studio-live`

**Repository description:** AI game-streaming studio with DSH sessions, chat queues, voice avatars, OBS overlays, Live2D/VRM import, and optional game adapters.

`dsh-studio-live` is an independently installed DSH studio. It provides the live page, avatar renderer, chat and voice queues, OBS bridge, and optional game adapters. The shared worktable provides only the studio container and session controls; it does not install this studio or any game.

## Features

- Run separate DSH sessions for audience messages and game control, with recorded state and a stop action.
- Receive Bilibili danmaku through WBI authentication, heartbeat, decompression, bounded retries, and in-memory Cookie handling.
- Queue and deduplicate up to 20 messages and 8 voice lines, with expiry, cancellation, and visible failure states.
- Import VRM, PNG/WebP/JPG, and Live2D Cubism 3/4 model ZIP files; persist models in local IndexedDB.
- Drive lip sync from cloud voice envelopes or approximate local system speech; reuse the renderer for preview and OBS.
- Connect OBS WebSocket v5 using a local read-only overlay URL with a random token.
- Provide bounded Stardew Valley and Minecraft adapters when the user supplies the supported game, mod/runtime, and local server.

## Installation

This repository declares a DSH bundle at `package.json` → `dsh.bundle.patch`. Install with the DSH Desktop plugin manager. Add the control package first, then this exact tagged source:

```text
github:1997liuyh-boop/dsh-studio-library#v0.1.3
github:1997liuyh-boop/dsh-studio-live#v0.3.1
```

Confirm that the plugin manager lists `dsh-studio-live` version `0.3.1`, then open Live studio. The package requires compatible `dsh-worktable` `^0.6.0` and `dsh-studio-projects` `^0.5.0`, supplied by the control package.

For local development, use Node.js 22 and npm:

```sh
npm install --include=dev --legacy-peer-deps
npm run build
npm run check
```

The public package contains compiled plugin and web assets, but it does not contain Live2D Cubism Core, Haru sample files, or a private character model. Follow [LIVE2D.md](LIVE2D.md) before importing licensed local assets.

## Requirements and limitations

Bilibili requires a valid room number and user-supplied login Cookie. Cloud speech requires network access and is subject to provider availability and quota. OBS, Stardew Valley, SMAPI, .NET 6, Minecraft, and a local Java test server are external requirements; none is shipped or started automatically. Game actions remain bounded and include an emergency stop; the adapters do not provide general pathfinding, combat, fishing, or automatic equipment selection.

Live2D ZIP files are validated locally and are limited to 32 MB compressed, 128 MB extracted, 256 files, 4096×4096 textures, and 34 million total pixels. ZIP scripts, external URLs, and path traversal are rejected. Models and voice data remain local; the plugin does not read another application's API keys or private configuration.

## Sources and license

The adaptation uses the DSH host [1997liuyh-boop/deepseek-harness](https://github.com/1997liuyh-boop/deepseek-harness), the shared [dsh-studio-library](https://github.com/1997liuyh-boop/dsh-studio-library), and references local ai-vtuber-live material plus MIT dependencies listed in [UPSTREAM.json](UPSTREAM.json). Original code is MIT licensed; see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Live2D Cubism Core, Haru, and sample models follow Live2D's proprietary and sample-material terms. They are local-development-only assets and are excluded from the public package. See [LIVE2D.md](LIVE2D.md) and [THIRD-PARTY-LIVE2D.txt](THIRD-PARTY-LIVE2D.txt).
