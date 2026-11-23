#!/usr/bin/env node
/**
 * selftest.mjs — comfyui-minimax-h3-operator 确定性全量自测套件（零依赖、不调模型、不花额度）
 * 覆盖 build-workflow.mjs（Mode A 纯空景零漂移 + Mode B 跨机位硬切 AddGuide）与 preflight.mjs 全部 10 道门禁。
 */

import assert from 'node:assert/strict';
import { buildH3Workflow } from './build-workflow.mjs';
import { validateWorkflow } from './preflight.mjs';

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
}

const GOOD_PROMPT = `subject_definitions:
<Picture 1> is the pure character-free 16:9 sunlit Korean study room empty scene reference.
<Picture 2> is Phoebe turnaround 3-view character sheet.

summary:
Scene-locked 5-second 16:9 steady static anime shot inside <Picture 1>.

retention_analysis:
<Picture 1>: strictly_preserved.

detailed_description:
[Shot 1 | 0.00s-5.00s] Inside <Picture 1>, a steady locked-off 35mm static shot frames Phoebe waving her mittens cheerfully.
(S1) Phoebe speaks clearly: <d>[Chinese] 冲鸭韩语试听课，现在就给我安排！</d>

overall_soundscape: Crisp sunlit room ambience and cheerful hand claps.

non_diegetic_music: Upbeat Japanese comedy anime guitar mixed softly beneath the voice.`;

// 1. Mode A（纯空景零漂移）构建 + 10 门全过
test('Mode A (scene-locked, guides=[]) builds cleanly and passes all 10 gates', () => {
  const wf = buildH3Workflow({
    prefix: 'test_mode_a',
    seed: 2026112301,
    aspectRatio: '16:9 (Widescreen)',
    megapixels: 0.4,
    durationSec: 5,
    refImages: [
      { title: 'Empty 16:9 Scene', file: 'u40_dbe388423b52.png' },
      { title: 'Phoebe 3-View', file: 'u40_88e8fc05891c.png' },
      { title: 'Props Sheet', file: 'u40_0bbc8578aa94.png' }
    ],
    guides: [],
    audio: { title: 'Phoebe Voice', file: 'u40_c2db89adf267.mp3' },
    prompt: GOOD_PROMPT
  });
  const rep = validateWorkflow(wf);
  assert.equal(rep.ok, true, JSON.stringify(rep.results));
  assert.equal(rep.passedCount, 10);
  assert.equal(wf.nodes.filter((n) => n.type === 'MiniMaxH3AddGuide').length, 0);
  assert.equal(wf.nodes.find((n) => n.id === 119).widgets_values[0], 'minimax_h3_video_vae_fp16.safetensors');
});

// 2. Mode B（跨机位硬切 AddGuide 多帧）构建 + 保留全部 8 分组 + 10 门全过
test('Mode B (hard-cut AddGuide x3) preserves all 8 groups and passes all 10 gates', () => {
  const wf = buildH3Workflow({
    prefix: 'test_mode_b',
    seed: 2026112302,
    refImages: [
      { title: 'Empty Scene', file: 'u40_dbe388423b52.png' },
      { title: 'Phoebe 3-View', file: 'u40_88e8fc05891c.png' },
      { title: 'Guga 3-View', file: 'u40_165538eb5db2.png' },
      { title: 'Props Sheet', file: 'u40_0bbc8578aa94.png' },
      { title: 'KF 0s', file: 'u40_96612406fa95.png' },
      { title: 'KF 2s', file: 'u40_db699e361b29.png' },
      { title: 'KF 4s', file: 'u40_4df720473cb9.png' }
    ],
    guides: [
      { sec: 0.0, file: 'u40_96612406fa95.png', title: 'Start' },
      { sec: 2.0, file: 'u40_db699e361b29.png', title: 'Hard Cut Mid' },
      { sec: 4.0, file: 'u40_4df720473cb9.png', title: 'Hard Cut End' }
    ],
    audio: { title: 'Phoebe Voice', file: 'u40_c2db89adf267.mp3' },
    prompt: GOOD_PROMPT
  });
  const rep = validateWorkflow(wf);
  assert.equal(rep.ok, true, JSON.stringify(rep.results));
  assert.equal(wf.groups.length, 8);
  assert.equal(wf.nodes.filter((n) => n.type === 'MiniMaxH3AddGuide').length, 3);
});

// 3. buildH3Workflow 拒绝带斜杠前缀（Cloud Gateway 403）
test('buildH3Workflow rejects slash prefix upfront', () => {
  assert.throws(() => buildH3Workflow({
    prefix: 'video/bad_prefix',
    refImages: [{ title: 'Scene', file: 'u40_a.png' }],
    prompt: GOOD_PROMPT
  }));
});

// 4-13. 击穿全部 10 道门禁
function makeRawModeA(override = {}) {
  const wf = buildH3Workflow({
    prefix: 'raw_ok',
    refImages: [{ title: 'Scene', file: 'u40_a.png' }],
    guides: [],
    prompt: override.prompt ?? GOOD_PROMPT,
    steps: override.steps ?? 20,
    durationSec: override.durationSec ?? 5
  });
  if (override.mutate) override.mutate(wf);
  return wf;
}

test('Gate 1 blocks CFG=1 negative words outside <d>', () => {
  const wf = makeRawModeA({ prompt: `${GOOD_PROMPT}\nDo not add glitches.` });
  assert.equal(validateWorkflow(wf).results[0].pass, false);
});

test('Gate 1 allows Chinese negative words inside <d>', () => {
  const wf = makeRawModeA({ prompt: GOOD_PROMPT.replace('现在就给我安排！', '不干了！别拦我！') });
  assert.equal(validateWorkflow(wf).results[0].pass, true);
});

test('Gate 2 blocks grid coordinates', () => {
  const wf = makeRawModeA({ prompt: `${GOOD_PROMPT}\nUse the middle-right face.` });
  assert.equal(validateWorkflow(wf).results[1].pass, false);
});

test('Gate 3 blocks slash in SaveVideo prefix', () => {
  const wf = makeRawModeA({ mutate: (w) => { w.nodes.find((n) => n.id === 92).widgets_values[0] = 'video/bad'; } });
  assert.equal(validateWorkflow(wf).results[2].pass, false);
});

test('Gate 4 blocks removed LoraLoaderModelOnly', () => {
  const wf = makeRawModeA({ mutate: (w) => { w.nodes.push({ id: 999, type: 'LoraLoaderModelOnly', widgets_values: ['turbo_4step.safetensors', 1] }); } });
  assert.equal(validateWorkflow(wf).results[3].pass, false);
});

test('Gate 5 blocks multi-dialogue in 5s mode', () => {
  const wf = makeRawModeA({ prompt: `${GOOD_PROMPT}\n<d>[Chinese] 第二句串麦！</d>` });
  assert.equal(validateWorkflow(wf).results[4].pass, false);
});

test('Gate 6 blocks > 9 ref images without AddGuide', () => {
  const wf = makeRawModeA({
    mutate: (w) => {
      for (let i = 0; i < 9; i++) w.nodes.push({ id: 500 + i, type: 'LoadImage', widgets_values: [`img_${i}.png`, 'image'] });
    }
  });
  assert.equal(validateWorkflow(wf).results[5].pass, false);
});

test('Gate 7 blocks steps < 15 or duration > 5.5s', () => {
  const wf = makeRawModeA({ steps: 4, durationSec: 10 });
  assert.equal(validateWorkflow(wf).results[6].pass, false);
});

test('Gate 8 blocks missing soundscape/music', () => {
  const wf = makeRawModeA({ prompt: 'short incomplete prompt' });
  assert.equal(validateWorkflow(wf).results[7].pass, false);
});

test('Gate 9 blocks forbidden name 鲸鱼娘', () => {
  const wf = makeRawModeA({ prompt: GOOD_PROMPT.replace('冲鸭韩语', '鲸鱼娘') });
  assert.equal(validateWorkflow(wf).results[8].pass, false);
});

test('Gate 10 blocks broken core wiring', () => {
  const wf = makeRawModeA({ mutate: (w) => { w.links = []; } });
  assert.equal(validateWorkflow(wf).results[9].pass, false);
});

console.log(`✓ ${passed} 项自测全部通过`);
