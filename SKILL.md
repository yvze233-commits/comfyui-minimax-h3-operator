---
name: comfyui-minimax-h3-operator
description: ComfyUI + MiniMax H3 (ref2va / AddGuide) end-to-end automated video production Skill. Includes official 8-group multi-frame base template, pure-additive workflow builder, 10 deterministic pre-flight code gates, browser subagent upload/run/poll/download playbook, mandatory read_file self-watch QA, and local ffmpeg last-frame extraction & lossless concatenation tools.
---

# ComfyUI · MiniMax H3 全自动制片操作手册 (Open-Source Edition)

> **定位**：让任何 AI Agent 在不踩历史坑的前提下，**直接操作云端/本地 ComfyUI + MiniMax H3（`ref2va` / `MiniMaxH3AddGuide`）端到端产出高质量动画/短剧成片**。
> 本 Skill **完全自包含、零外部 npm 依赖**，内置官方 8 分组多帧模板与 4 个可直接运行的 Node.js 脚本。

`{baseDir}` = 本文件所在目录。

---

## 一、 开始前必读（2 份随附参考档案）

1. **[references/server-and-assets.md](references/server-and-assets.md)**：ComfyUI H3 精确模型文件名（`UNET / CLIP / video_vae_fp16 / audio_vae_fp32`）、4 大常见网关与服务端硬坑（已下线 Turbo LoRA 400、多用户网关 SaveVideo 斜杠 403、共享 GPU 排队、安全分辨率线）及资产登记表模板。
2. **[references/browser-playbook.md](references/browser-playbook.md)**：`browser` 子代理登录复用、`uploads/` 暂存规则、零破坏标签页卫生、提交/轮询/下载指令模板与 5 项强制拉片自检清单。

---

## 二、 端到端 6 步制片 SOP（严格按序执行）

### Step 1 — 确认剧本、分镜与素材资产
- 推荐先走上游 [shuohao-skills](https://github.com/eternityspring/shuohao-skills)（`novel-outline → novel-art → novel-script → novel-staging → novel-storyboard`）锁定剧本、站位平面图与分镜表。
- **场景与道具资产铁律**：
  - **场景图必须 100% 纯无角色空景**；
  - 道具表必须**纯白底、无手、无人物**；
  - 角色必须具备**标准三视图 + 表情设定表**。

### Step 2 — 选定镜头模式并用脚本构建工作流（基于内置官方母版做纯加法！）

每次构建单个 5 秒镜头（124 帧）的 JSON，先按 `examples/shot-spec.example.json` 写一份 `shot-spec.json`，再调用：

```bash
node {baseDir}/scripts/build-workflow.mjs --config <shot-spec.json> --out <workflow.json>
```

**严选两种正规模式（彻底避免“人物僵死”与“场景乱漂移”）**：
- **模式 A · 纯空景零漂移稳固机位（`guides: []`，80% 对话镜默认首选！）**：
  - `refImages` 挂齐：**`<Picture 1>` 纯无角色空景图 + `<Picture 2..K>` 同场所有角色三视图 + 白底道具表**（支持官方最多 9 张，绝不砍三视图/空景/道具表）；
  - **不塞**互相打架的同机位重绘关键帧 → 房间家具、书桌、道具 **100% 纹丝不动**，角色靠三视图自由演出大幅度流畅动作！
  - 镜头默认采用 **稳固三脚架固定机位（`Static Shot` / `steady locked-off camera`）**，靠**镜与镜之间切景别**（全景 ↔ 过肩中景 ↔ 特写 ↔ 角落单切）出电影节奏，**严禁每镜莫名其妙反复放大缩小**！
- **模式 B · 跨机位硬切多帧驱动（`guides: [{sec, file, title}, ...]`，仅用于明确硬切！）**：
  - 保留官方全部 8 分组与 3 组串联 `MiniMaxH3AddGuide`（`frame_idx = round(sec * 24)`）；
  - **仅在跨机位/跨景别干脆硬切点**（Prompt 明确写 `Hard cut to <Picture K>`）使用，严禁在同一机位里塞 3 张家具位移的重绘背景图强行溶图变形！

### Step 3 — 运行 10 道确定性预检门 ⛔ 不可跳过

```bash
node {baseDir}/scripts/preflight.mjs <workflow.json>
```

全部 10 道代码门禁必须 `10/10 PASS` 才允许提交：
1. `zero-negative-words`（CFG=1 零否定词）
2. `zero-grid-coords`（零九宫格坐标词）
3. `no-slash-save-prefix`（SaveVideo 前缀无斜杠）
4. `no-removed-lora`（禁已下线 `turbo_4step` LoRA，忽略只读 MarkdownNote）
5. `single-speaker-audio-lock`（5s 单主说单音频与字数安全线）
6. `ref-image-budget`（官方 ≤9 张 `ref_images` + `AddGuide` 上限）
7. `safe-resolution-and-steps`（`mp <= 0.65`、`steps >= 15`、`duration <= 5.5s`）
8. `h3-structure-complete`（H3 三段式或官方多帧 6 段式字段齐全）
9. `zero-forbidden-names`（支持 `--forbid` 角色错名黑名单）
10. `valid-node-wiring`（核心推理链路与 `AddGuide` 连线完好）

### Step 4 — 通过 `browser` 子代理单任务串行上传与提交
严格按 `references/browser-playbook.md` 执行：
1. 将 `<workflow.json>`（及新增图片/音频）拷贝至 `<Artifact Directory>/browser_sandbox/uploads/`；
2. 复用常驻 `browser` 子代理检查 `GET /api/queue` 空闲 → 新建空白标签页导入 JSON → 确认无红框/弹窗 → 单次点击 Run → 获取 `POST /api/prompt` HTTP 200 与 `prompt_id`；
3. 调用 `schedule(DurationSeconds=160)` 异步等待（严禁 shell sleep 轮询）。

### Step 5 — 下载成片并强制 `read_file` 亲自拉片验收 ⛔ 严禁盲交
1. `GET /api/history/<prompt_id>` 显示 `status_str: "success"` 后，通过 `/api/view` 下载视频至 `browser_sandbox/downloads/`；
2. **必须调用 `read_file` 亲自看画面 + 听声音**，核查 5 项：场景稳固零漂移、机位稳固无莫名缩放、全员入画无重影、动作自然不僵死、台词一字不差零串麦；
3. 任意一项不达标，立即定位根因重拍，**绝不把未拉片的视频直接交差**。

### Step 6 — 本地 `ffmpeg` 尾帧衔接与无损拼接总成片
```bash
# 提取末尾 0.15s 像素级真尾帧
node {baseDir}/scripts/stitch-and-extract.mjs extract <shotN.mp4> <last_frame_sN.png>

# 全部镜次验收通过后，无损拼接完整总成片
node {baseDir}/scripts/stitch-and-extract.mjs concat <master.mp4> <shot1.mp4> <shot2.mp4> ...
```

---

## 三、 自测（改完脚本必跑）

```bash
node {baseDir}/scripts/selftest.mjs
```

14 项确定性断言，零依赖、不调模型、不花额度。
