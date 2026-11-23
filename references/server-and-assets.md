# ComfyUI MiniMax H3 服务端环境与避坑档案

## 1. 服务端端口与硬件环境
- **访问地址**：`<YOUR_COMFYUI_URL>`（例如自建或云端 RTX 5090 32GB ComfyUI 实例）
- **ComfyUI 版本要求**：`comfy-core >= 0.33.0`（支持 `MiniMaxH3ReferenceToVideo`、`MiniMaxH3AddGuide`、`ResolutionSelector`、`ComfyMathExpression`）

---

## 2. 服务端标准模型清单（精确文件名）
| 节点类型 | 参数名 | 精确模型文件名 | 备注 |
| :--- | :--- | :--- | :--- |
| `UNETLoader` | `unet_name` | `minimax_h3_ref2va_pruned_int8_convrot.safetensors` | `weight_dtype: "default"` |
| `CLIPLoader` | `clip_name` | `qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors` | `type: "minimax"`, `device: "default"` |
| `VAELoader` (Video) | `vae_name` | `minimax_h3_video_vae_fp16.safetensors` | 实测稳定；部分环境也可配 `int8_convrot` |
| `VAELoader` (Audio) | `vae_name` | `minimax_h3_audio_vae_fp32.safetensors` | 原生立体声解码 |
| `KSamplerSelect` | `sampler_name` | `res_multistep` | 官方推荐采样器 |
| `BasicScheduler` | `scheduler / steps` | `simple` / `20` / `denoise: 1` | 无 Turbo LoRA 时必须 ≥15 步，标准 20 步 |
| `BasicGuider` | — | `CFG = 1`（无负面提示词分支） | **严禁在非台词正文写任何否定词** |

---

## 3. 四大实测硬坑（血泪教训黑名单）
1. **已下线/缺失 Turbo LoRA（触发 `HTTP 400 value_not_in_list`）**：
   - 许多云端环境未安装或已下线 `minimax_h3_ref2v_turbo_4step_v0.1_comfyui_bf16.safetensors`。
   - **解法**：`scripts/build-workflow.mjs` 默认自动移除 `LoraLoaderModelOnly` 与切换开关节点，将 `UNETLoader` 直连 `BasicGuider` 与 `BasicScheduler (steps=20)`。
2. **多用户云网关 `SaveVideo` 斜杠 403 陷阱**：
   - 在 Cloud Gateway 等多用户网关下，若 `SaveVideo.filename_prefix` 带斜杠（如 `video/shot1`），文件会落入嵌套子目录导致 `/api/view` 返回 **`HTTP 403`** 无法预览与下载！
   - **解法**：`filename_prefix` **严禁含 `/` 或 `\`**（如 `epB_s1_lock`）。
3. **共享 GPU 多人排队机制**：
   - 独享 RTX 5090 渲染 5 秒视频（124 帧、`0.4–0.5MP`、20 步）耗时约 **125–165 秒**。
   - 若提交后 `GET /api/queue` 显示 `queue_pending` 排队中且 `GPU 100% / VRAM 98%`，说明共享实例上有其他任务在跑，切勿重复点击 Run！使用 `schedule` 定时 3–4 分钟后复查。
4. **分辨率安全线**：
   - **16:9 横屏**：`ResolutionSelector` 选 `16:9 (Widescreen)`，`megapixels: 0.4`（`864 × 480`）或 `0.5`（`960 × 544`），`multiple: 32`。
   - **9:16 竖屏**：`ResolutionSelector` 选 `9:16 (Portrait Widescreen)`，`megapixels: 0.5`（`544 × 960`），`multiple: 32`。

---

## 4. 项目资产登记表模板（建议在项目内维护）

| 资产类别 | 角色/场景名 | ComfyUI `input/` 文件名 | 核心特征 |
| :--- | :--- | :--- | :--- |
| 纯无角色空景 | 主场景 A | `<uploaded_scene.png>` | 100% 零人物，锁死家具位置防漂移 |
| 白底道具表 | 核心道具集 | `<uploaded_props.png>` | 纯白底、无手、无人物 |
| 角色三视图 | 角色 A | `<uploaded_char_a.png>` | 正/侧/背三视图 + 6 表情设定 |
| 角色真声 | 角色 A 配音 | `<uploaded_voice_a.mp3>` | 干净无BGM单人干声 |
