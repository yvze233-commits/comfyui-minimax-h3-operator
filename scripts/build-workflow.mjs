#!/usr/bin/env node
/**
 * build-workflow.mjs — 基于内置官方 8 分组多帧模板做【纯加法】构建 ComfyUI MiniMax H3 工作流
 * 支持两种正规模式：
 *   - Mode A（纯空景零漂移模式，guides=[]）：挂齐 纯空景 + 全员三视图 + 道具表，移除未使用 AddGuide，场景 100% 纹丝不动
 *   - Mode B（跨机位硬切多帧模式，guides=[...]）：保留官方 3 组 MiniMaxH3AddGuide 时间轴链，严格用于跨机位硬切
 *
 * CLI 用法：
 *   node build-workflow.mjs --config <shot-spec.json> --out <workflow.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE_TEMPLATE = path.resolve(__dirname, '../templates/video_minimax_h3_multiframe_base.json');

export function buildH3Workflow({
  prefix,
  seed = 2026112301,
  aspectRatio = '16:9 (Widescreen)', // 或 '9:16 (Portrait Widescreen)'
  megapixels = 0.4,                  // 16:9 建议 0.4(864x480)/0.5(960x544)；9:16 建议 0.5(544x960)
  durationSec = 5,
  steps = 20,
  refImages = [],                    // [{ title, file }]，官方上限 9 张
  guides = [],                       // [{ sec, file, title }]，最多 3 组硬切关键帧；空数组=纯空景零漂移模式
  audio = null,                      // { title, file } 或 null（5s 防串麦模式最多 1 段）
  prompt
}) {
  if (!prefix || /[\\/]/.test(prefix)) {
    throw new Error(`Invalid SaveVideo prefix "${prefix}": must be non-empty and contain no slashes (Cloud Gateway 403 rule).`);
  }
  if (!Array.isArray(refImages) || refImages.length === 0) {
    throw new Error('refImages must contain at least 1 reference image.');
  }

  const wf = JSON.parse(fs.readFileSync(BASE_TEMPLATE, 'utf8'));

  const userInputsGroup = wf.groups.find((g) => g.title === 'User Inputs');
  if (userInputsGroup) userInputsGroup.bounding = [-1520, 3820, 3380, 1000];

  // 移除云端已下线的 turbo_4step LoRA 与切换开关节点，保留 Int(Full) 直连 BasicScheduler，UNETLoader 直连 BasicGuider
  const removeIds = new Set([141, 142, 144, 145, 146]);
  wf.nodes = wf.nodes.filter((n) => !removeIds.has(n.id));
  wf.links = wf.links.filter((l) => !removeIds.has(l[1]) && !removeIds.has(l[3]));

  const nodeById = (id) => wf.nodes.find((n) => n.id === id);

  let nextNodeId = wf.last_node_id + 10;
  let nextLinkId = wf.last_link_id + 10;

  const unet = nodeById(127);
  const sched = nodeById(124);
  const guider = nodeById(126);
  const intFull = nodeById(143);

  intFull.widgets_values = [steps, 'fixed'];
  if (intFull.widgets_values_named) intFull.widgets_values_named.value = steps;

  const linkUnetSched = nextLinkId++;
  const linkUnetGuider = nextLinkId++;
  const linkSteps = nextLinkId++;

  unet.outputs[0].links = [linkUnetSched, linkUnetGuider];
  intFull.outputs[0].links = [linkSteps];
  sched.inputs[0].link = linkUnetSched;
  sched.inputs[1].link = linkSteps;
  sched.widgets_values = ['simple', steps, 1];
  if (sched.widgets_values_named) sched.widgets_values_named.steps = steps;
  guider.inputs[0].link = linkUnetGuider;

  wf.links.push([linkUnetSched, 127, 0, 124, 0, 'MODEL']);
  wf.links.push([linkUnetGuider, 127, 0, 126, 0, 'MODEL']);
  wf.links.push([linkSteps, 143, 0, 124, 1, 'INT']);

  // 端口实测稳定 Video VAE: fp16
  const videoVae = nodeById(119);
  videoVae.widgets_values = ['minimax_h3_video_vae_fp16.safetensors'];
  if (videoVae.widgets_values_named) videoVae.widgets_values_named.vae_name = 'minimax_h3_video_vae_fp16.safetensors';

  const saveVideo = nodeById(92);
  saveVideo.widgets_values = [prefix, 'auto', 'auto', 'auto'];
  if (saveVideo.widgets_values_named) saveVideo.widgets_values_named.filename_prefix = prefix;

  const resNode = nodeById(115);
  resNode.widgets_values = [aspectRatio, megapixels, 32];
  if (resNode.widgets_values_named) {
    resNode.widgets_values_named.aspect_ratio = aspectRatio;
    resNode.widgets_values_named.megapixels = megapixels;
  }

  const durNode = nodeById(132);
  durNode.widgets_values = [durationSec];
  if (durNode.widgets_values_named) durNode.widgets_values_named.value = durationSec;

  const noiseNode = nodeById(129);
  noiseNode.widgets_values = [seed, 'fixed'];
  if (noiseNode.widgets_values_named) {
    noiseNode.widgets_values_named.noise_seed = seed;
    noiseNode.widgets_values_named.control_after_generate = 'fixed';
  }

  const promptNode = nodeById(138);
  promptNode.widgets_values = [prompt];
  if (promptNode.widgets_values_named) promptNode.widgets_values_named.value = prompt;

  // 纯加法扩展 ref_images（最多 9 张：空景 + 全员三视图 + 道具表 + 关键帧）
  const h3 = nodeById(136);
  wf.nodes = wf.nodes.filter((n) => n.id !== 164);
  wf.links = wf.links.filter((l) => l[1] !== 164 && l[3] !== 164);

  const headInputs = h3.inputs.slice(0, 3);
  const tailStartIdx = h3.inputs.findIndex((i) => i.name === 'ref_videos.ref_video_0');
  const tailInputs = h3.inputs.slice(tailStartIdx);

  const newRefInputs = [];
  for (let i = 0; i < refImages.length; i++) {
    const imgNid = nextNodeId++;
    const imgLid = nextLinkId++;
    wf.nodes.push({
      id: imgNid,
      type: 'LoadImage',
      pos: [-1140 + (i % 4) * 320, 3880 + Math.floor(i / 4) * 350],
      size: [290, 320],
      flags: {},
      order: 10 + i,
      mode: 0,
      title: `Picture ${i + 1} - ${refImages[i].title}`,
      inputs: [],
      outputs: [
        { name: 'IMAGE', type: 'IMAGE', links: [imgLid] },
        { name: 'MASK', type: 'MASK', links: null }
      ],
      properties: { cnr_id: 'comfy-core', ver: '0.33.0' },
      widgets_values: [refImages[i].file, 'image'],
      widgets_values_named: { image: refImages[i].file, upload: 'image' }
    });
    newRefInputs.push({
      label: `ref_image_${i}`,
      name: `ref_images.ref_image_${i}`,
      shape: 7,
      type: 'IMAGE',
      link: imgLid
    });
    wf.links.push([imgLid, imgNid, 0, 136, 3 + i, 'IMAGE']);
  }
  newRefInputs.push({
    label: `ref_image_${refImages.length}`,
    name: `ref_images.ref_image_${refImages.length}`,
    shape: 7,
    type: 'IMAGE',
    link: null
  });

  h3.inputs = [...headInputs, ...newRefInputs, ...tailInputs];

  const slotOf = (name) => h3.inputs.findIndex((inp) => inp.name === name);
  for (const l of wf.links) {
    if (l[3] === 136) {
      if (l[0] === 333) l[4] = slotOf('prompt');
      if (l[0] === 276) l[4] = slotOf('width');
      if (l[0] === 277) l[4] = slotOf('height');
      if (l[0] === 275) l[4] = slotOf('length');
    }
  }

  // 可选挂载 1 段 LoadAudio 真声克隆
  if (audio && audio.file) {
    const audioNid = nextNodeId++;
    const audioLid = nextLinkId++;
    const audioSlot = slotOf('ref_audios.ref_audio_0');
    wf.nodes.push({
      id: audioNid,
      type: 'LoadAudio',
      pos: [180, 4240],
      size: [320, 136],
      flags: {},
      order: 19,
      mode: 0,
      title: audio.title || 'Audio 1 - Voice Reference',
      inputs: [],
      outputs: [{ name: 'AUDIO', type: 'AUDIO', links: [audioLid] }],
      properties: { cnr_id: 'comfy-core', ver: '0.33.0', 'Node name for S&R': 'LoadAudio' },
      widgets_values: [audio.file],
      widgets_values_named: { audio: audio.file }
    });
    h3.inputs[audioSlot].link = audioLid;
    wf.links.push([audioLid, audioNid, 0, 136, audioSlot, 'AUDIO']);
  }

  // Mode A (guides=[]) vs Mode B (guides=[1..3])
  const guideSlots = [
    { imgId: 157, secId: 154, mathId: 153, guideId: 147 },
    { imgId: 159, secId: 160, mathId: 161, guideId: 162 },
    { imgId: 167, secId: 168, mathId: 170, guideId: 169 }
  ];

  if (!guides || guides.length === 0) {
    const unusedGuideIds = new Set([147, 153, 154, 157, 159, 160, 161, 162, 167, 168, 169, 170, 171]);
    wf.nodes = wf.nodes.filter((n) => !unusedGuideIds.has(n.id));
    wf.links = wf.links.filter((l) => !unusedGuideIds.has(l[1]) && !unusedGuideIds.has(l[3]));
    wf.groups = wf.groups.filter((g) => g.title !== 'Extra Image Guidance Conditioning');

    const linkCond = nextLinkId++;
    h3.outputs[0].links = [linkCond];
    guider.inputs[1].link = linkCond;
    wf.links.push([linkCond, 136, 0, 126, 1, 'CONDITIONING']);

    const aliveLinkIds = new Set(wf.links.map((l) => l[0]));
    for (const n of wf.nodes) {
      for (const out of n.outputs || []) {
        if (Array.isArray(out.links)) out.links = out.links.filter((lid) => aliveLinkIds.has(lid));
      }
    }
  } else {
    for (let i = 0; i < guideSlots.length && i < guides.length; i++) {
      const g = guides[i];
      const slot = guideSlots[i];
      const imgNode = nodeById(slot.imgId);
      const secNode = nodeById(slot.secId);
      const guideNode = nodeById(slot.guideId);
      imgNode.title = `Guide ${i + 1} @ ${g.sec}s - ${g.title}`;
      imgNode.widgets_values = [g.file, 'image'];
      if (imgNode.widgets_values_named) imgNode.widgets_values_named.image = g.file;

      secNode.title = `Frame Index (Second = ${g.sec}s)`;
      secNode.widgets_values = [g.sec];
      if (secNode.widgets_values_named) secNode.widgets_values_named.value = g.sec;

      guideNode.title = `Add Guide #${i + 1} @ ${g.sec}s`;
      guideNode.widgets_values = [Math.round(g.sec * 24)];
      if (guideNode.widgets_values_named) guideNode.widgets_values_named.frame_idx = Math.round(g.sec * 24);
    }
  }

  wf.last_node_id = nextNodeId + 5;
  wf.last_link_id = nextLinkId + 5;
  return wf;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const cfgIdx = args.indexOf('--config');
  const outIdx = args.indexOf('--out');
  if (cfgIdx < 0 || outIdx < 0 || !args[cfgIdx + 1] || !args[outIdx + 1]) {
    console.error('用法: node build-workflow.mjs --config <shot-spec.json> --out <workflow.json>');
    process.exit(2);
  }
  const spec = JSON.parse(fs.readFileSync(args[cfgIdx + 1], 'utf8'));
  const wf = buildH3Workflow(spec);
  fs.mkdirSync(path.dirname(path.resolve(args[outIdx + 1])), { recursive: true });
  fs.writeFileSync(args[outIdx + 1], JSON.stringify(wf, null, 2), 'utf8');
  console.log(`✅ Built workflow -> ${args[outIdx + 1]} (${wf.nodes.length} nodes, ${wf.groups.length} groups)`);
}
