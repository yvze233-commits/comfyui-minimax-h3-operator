# comfyui-minimax-h3-operator

**An end-to-end, zero-dependency Agent Skill for operating ComfyUI + MiniMax H3 (`ref2va` / `AddGuide`) to produce complete animated short dramas with deterministic quality gates.**

面向各类 AI Agent（Antigravity / Claude Code / Codex 等）的 **ComfyUI + MiniMax H3 全自动短剧制片 Skill**。从纯加法工作流构建、10 道确定性代码预检门、浏览器自动化提交与收片、强制拉片验收，到 `ffmpeg` 真尾帧衔接与无损拼接，全流程零试错闭环。

---

## ✨ Core Features / 核心亮点

1. **Zero-Subtraction Additive Workflow Builder (`scripts/build-workflow.mjs`)**
   - Built directly on top of the official 8-group ComfyUI MiniMax H3 multi-frame template (`templates/video_minimax_h3_multiframe_base.json`).
   - Supports **up to 9 `ref_images`** (pure character-free empty scene + all character turnaround 3-view sheets + white-background prop sheets + keyframes) — never drops character sheets or scene refs.
   - Supports two proven production modes:
     - **Mode A · Scene-Locked Static Tripod (`guides: []`, Recommended for 80% dialogue shots)**: Locks room furniture 100% rock-solid via a pure empty scene while freeing characters to perform full-body animation from their 3-view sheets — zero background drift, zero random zoom in/out!
     - **Mode B · Hard-Cut Multi-Frame Timeline (`guides: [...]`)**: Preserves all 8 groups and 3 chained `MiniMaxH3AddGuide` nodes (`frame_idx = round(sec * 24)`) for intentional cross-camera hard cuts.
2. **10 Deterministic Preflight Code Gates (`scripts/preflight.mjs`)**
   - Mechanically blocks real-world MiniMax H3 failure modes *before* burning GPU time:
     1. `zero-negative-words` — Blocks `NO / not / don't / without / zero / never` outside `<d>` tags (`BasicGuider CFG=1` has no negative branch and summons negated artifacts).
     2. `zero-grid-coords` — Blocks `middle-right / row 2 col 1` grid coordinate phrases.
     3. `no-slash-save-prefix` — Blocks `/` in `SaveVideo.filename_prefix` (prevents `HTTP 403` on multi-user cloud gateways like Cloud Gateway).
     4. `no-removed-lora` — Blocks deleted `turbo_4step` LoRA nodes (`HTTP 400 value_not_in_list`).
     5. `single-speaker-audio-lock` — Enforces 5s / 1 speaker / max 1 `LoadAudio` / 12–20 CJK chars to eliminate multi-speaker audio bleed & tail silence.
     6. `ref-image-budget` — Enforces official `≤9` `ref_images` + `AddGuide` budget.
     7. `safe-resolution-and-steps` — Checks safe megapixels (`0.4–0.5MP`), `steps >= 15`, and `duration <= 5.5s`.
     8. `h3-structure-complete` — Verifies native H3 / multi-frame prompt sections (`integrated_multimodal_description` or `detailed_description`, `overall_soundscape`, `non_diegetic_music`).
     9. `zero-forbidden-names` — Customizable character alias blacklist (`--forbid`).
     10. `valid-node-wiring` — Verifies `UNETLoader -> BasicGuider / BasicScheduler` and `MiniMaxH3ReferenceToVideo / AddGuide -> BasicGuider & SamplerCustomAdvanced`.
3. **Browser Subagent Playbook (`references/browser-playbook.md`)**
   - Safe tab hygiene (never modifies existing user tabs), `uploads/` staging discipline, single-task serial submission, shared-GPU queue handling, and **mandatory self-watch QA** before delivery.
4. **Local `ffmpeg` Chaining & Lossless Stitching (`scripts/stitch-and-extract.mjs`)**
   - Pixel-exact last-frame extraction (`-sseof -0.15`) and lossless multi-clip concatenation (`-c copy`).
5. **Zero External Dependencies & Built-In Selftest (`scripts/selftest.mjs`)**
   - Pure Node.js (`>= 18`), no `npm install` required for core scripts, 14 deterministic unit tests included.

---

## 📁 Repository Structure

```text
comfyui-minimax-h3-operator/
├── SKILL.md                                    # Agent-facing end-to-end 6-step SOP
├── README.md                                   # Human-facing documentation
├── LICENSE                                     # MIT License
├── references/
│   ├── server-and-assets.md                    # ComfyUI model specs, gateway traps & asset registry template
│   └── browser-playbook.md                     # Browser subagent SOP for upload / run / poll / download / QA
├── templates/
│   └── video_minimax_h3_multiframe_base.json   # Bundled official 8-group ComfyUI H3 multi-frame template
├── examples/
│   └── shot-spec.example.json                  # Ready-to-run shot config example
└── scripts/
    ├── build-workflow.mjs                      # Pure-additive ComfyUI workflow builder (Mode A & Mode B)
    ├── preflight.mjs                           # 10 deterministic pre-flight code gates
    ├── stitch-and-extract.mjs                  # Local ffmpeg last-frame extractor & lossless MP4 stitcher
    └── selftest.mjs                            # 14-assertion zero-dependency unit test suite
```

---

## 🚀 Quick Start

### 1. Install into Your Agent Skills Directory

```bash
# Antigravity / workspace skills
git clone https://github.com/yvze233-commits/comfyui-minimax-h3-operator.git .agents/skills/comfyui-minimax-h3-operator

# Or Claude Code / Codex global skills
git clone https://github.com/yvze233-commits/comfyui-minimax-h3-operator.git ~/.claude/skills/comfyui-minimax-h3-operator
```

### 2. Run Self-Tests (0 API Calls, <1 Second)

```bash
node scripts/selftest.mjs
# ✓ 14 项自测全部通过
```

### 3. Build & Pre-Flight Validate a Workflow

```bash
# Build a Mode A (Scene-Locked Static Tripod) 16:9 workflow from the example spec
node scripts/build-workflow.mjs \
  --config examples/shot-spec.example.json \
  --out ./out/demo_s1_lock.json

# Run all 10 deterministic preflight gates before submitting to ComfyUI
node scripts/preflight.mjs ./out/demo_s1_lock.json
```

### 4. Extract Real Last Frame & Stitch Finished Clips

```bash
# Extract pixel-exact last frame for next-shot continuity
node scripts/stitch-and-extract.mjs extract shot1.mp4 last_frame_s1.png

# Losslessly concatenate approved 5s clips into a full master MP4
node scripts/stitch-and-extract.mjs concat master_60s.mp4 shot1.mp4 shot2.mp4 shot3.mp4
```

---

## 🤝 Works Great With

- [eternityspring/shuohao-skills](https://github.com/eternityspring/shuohao-skills) — Use `novel-outline` → `novel-art` → `novel-script` → `novel-staging` → `novel-storyboard` upstream, then hand off directly to `comfyui-minimax-h3-operator` for ComfyUI MiniMax H3 production & QA!

## 📄 License

MIT License — see [LICENSE](LICENSE).
