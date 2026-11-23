#!/usr/bin/env node
/**
 * preflight.mjs — ComfyUI 网关 MiniMax H3 投产前 10 道确定性代码门禁（零依赖）
 *
 * 用法：
 *   node preflight.mjs <workflow.json> [--allow-multi-speaker] [--forbid 词1,词2]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FORBIDDEN_NAMES = ['鲸鱼娘'];
const NEGATIVE_WORD_REGEX = /\b(no|not|don't|doesn't|didn't|won't|can't|cannot|without|zero|never|none)\b/gi;
const GRID_COORD_REGEX = /\b(middle-right|middle-left|top-right|top-left|bottom-right|bottom-left|upper-left|upper-right|lower-left|lower-right|row\s*\d|col(?:umn)?\s*\d|grid\s*cell)\b/gi;
const REMOVED_LORA_REGEX = /turbo_4step|LoraLoaderModelOnly/i;

function stripDialogueTags(promptText) {
  return String(promptText || '').replace(/<d>[\s\S]*?<\/d>/g, '');
}

function extractDialogueTags(promptText) {
  const matches = [];
  const re = /<d>([\s\S]*?)<\/d>/g;
  let m;
  while ((m = re.exec(String(promptText || ''))) !== null) {
    matches.push(m[1].trim());
  }
  return matches;
}

function countCjkChars(str) {
  const cleaned = String(str || '').replace(/^\[[^\]]+\]\s*/, '');
  const m = cleaned.match(/[\u4e00-\u9fff0-9A-Za-z]/g);
  return m ? m.length : 0;
}

export function validateWorkflow(wf, options = {}) {
  const allowMultiSpeaker = Boolean(options.allowMultiSpeaker);
  const forbiddenNames = [...DEFAULT_FORBIDDEN_NAMES, ...(options.forbiddenNames || [])];
  const results = [];

  const nodes = Array.isArray(wf?.nodes) ? wf.nodes : [];
  const links = Array.isArray(wf?.links) ? wf.links : [];
  const byType = (t) => nodes.filter((n) => n && n.type === t);

  const promptNodes = byType('PrimitiveStringMultiline');
  const h3Nodes = byType('MiniMaxH3ReferenceToVideo');
  let promptText = '';
  if (promptNodes.length > 0 && typeof promptNodes[0].widgets_values?.[0] === 'string') {
    promptText = promptNodes[0].widgets_values[0];
  } else if (h3Nodes.length > 0 && typeof h3Nodes[0].widgets_values?.[0] === 'string') {
    promptText = h3Nodes[0].widgets_values[0];
  }

  const promptWithoutDialogue = stripDialogueTags(promptText);
  const dialogues = extractDialogueTags(promptText);

  // Gate 1: zero-negative-words
  {
    const hits = promptWithoutDialogue.match(NEGATIVE_WORD_REGEX) || [];
    results.push({
      gate: '1. zero-negative-words',
      pass: hits.length === 0,
      detail: hits.length === 0
        ? 'OK (CFG=1 正向提示词纯净，无否定词)'
        : `检测到 ${hits.length} 处否定词（CFG=1 会反向召唤伪影）: ${[...new Set(hits)].join(', ')}`
    });
  }

  // Gate 2: zero-grid-coords
  {
    const hits = promptWithoutDialogue.match(GRID_COORD_REGEX) || [];
    results.push({
      gate: '2. zero-grid-coords',
      pass: hits.length === 0,
      detail: hits.length === 0
        ? 'OK (无九宫格坐标索引词)'
        : `检测到九宫格坐标词: ${[...new Set(hits)].join(', ')}`
    });
  }

  // Gate 3: no-slash-save-prefix
  {
    const saveNodes = byType('SaveVideo');
    const badPrefixes = [];
    for (const sn of saveNodes) {
      const prefix = String(sn.widgets_values?.[0] ?? sn.widgets_values_named?.filename_prefix ?? '');
      if (!prefix || prefix.includes('/') || prefix.includes('\\')) badPrefixes.push(prefix || '<empty>');
    }
    const pass = saveNodes.length > 0 && badPrefixes.length === 0;
    results.push({
      gate: '3. no-slash-save-prefix',
      pass,
      detail: saveNodes.length === 0
        ? '缺少 SaveVideo 节点'
        : pass
          ? `OK (SaveVideo 前缀合规: ${saveNodes.map((s) => s.widgets_values?.[0]).join(', ')})`
          : `SaveVideo filename_prefix 含斜杠或为空（Cloud Gateway /api/view 会 403）: ${badPrefixes.join(', ')}`
    });
  }

  // Gate 4: no-removed-lora
  {
    const execNodes = nodes.filter((n) => n.type !== 'MarkdownNote');
    const badLoraNodes = execNodes.filter(
      (n) => n.type === 'LoraLoaderModelOnly' || REMOVED_LORA_REGEX.test(JSON.stringify(n.widgets_values || ''))
    );
    const pass = badLoraNodes.length === 0;
    results.push({
      gate: '4. no-removed-lora',
      pass,
      detail: pass
        ? 'OK (直连 UNETLoader，未挂载已下线 Turbo LoRA)'
        : '检测到已下线 LoRA 节点或引用（会触发 HTTP 400 value_not_in_list）'
    });
  }

  // Gate 5: single-speaker-audio-lock
  {
    const audioNodes = byType('LoadAudio');
    const issues = [];
    if (!allowMultiSpeaker) {
      if (audioNodes.length > 1) issues.push(`挂载了 ${audioNodes.length} 个 LoadAudio（5s 模式上限 1 个）`);
      if (dialogues.length > 1) issues.push(`存在 ${dialogues.length} 段 <d> 台词块（5s 防串麦模式限 1 段）`);
      if (dialogues.length === 1) {
        const len = countCjkChars(dialogues[0]);
        if (len < 4 || len > 26) issues.push(`单镜台词有效字数=${len}（推荐 8–22 字）`);
      }
    }
    results.push({
      gate: '5. single-speaker-audio-lock',
      pass: issues.length === 0,
      detail: issues.length === 0
        ? `OK (LoadAudio=${audioNodes.length}, <d>块=${dialogues.length}${dialogues[0] ? `, 字数=${countCjkChars(dialogues[0])}` : ''})`
        : issues.join('；')
    });
  }

  // Gate 6: ref-image-budget
  {
    const imgNodes = byType('LoadImage');
    const guideNodes = byType('MiniMaxH3AddGuide');
    const emptyImgs = imgNodes.filter((n) => !String(n.widgets_values?.[0] || '').trim());
    const maxImgs = 9 + guideNodes.length;
    const pass = imgNodes.length >= 1 && imgNodes.length <= maxImgs && emptyImgs.length === 0;
    results.push({
      gate: '6. ref-image-budget',
      pass,
      detail: pass
        ? `OK (挂载 ${imgNodes.length} 张图，其中 AddGuide=${guideNodes.length}，上限 ≤${maxImgs})`
        : imgNodes.length === 0
          ? '未挂载任何 LoadImage 参考图'
          : imgNodes.length > maxImgs
            ? `挂载了 ${imgNodes.length} 张图（超过官方上限 ${maxImgs}）`
            : '存在空文件名的 LoadImage 节点'
    });
  }

  // Gate 7: safe-resolution-and-steps
  {
    const resNodes = byType('ResolutionSelector');
    const schedNodes = byType('BasicScheduler');
    const durNodes = byType('PrimitiveFloat').filter((n) => /Duration/i.test(n.title || '') || n.id === 132);
    const issues = [];
    if (resNodes.length > 0) {
      const mp = Number(resNodes[0].widgets_values?.[1] ?? 0.5);
      if (mp > 0.65) issues.push(`megapixels=${mp} 偏高（建议 0.4–0.5MP 防 OOM）`);
    }
    if (schedNodes.length > 0) {
      const steps = Number(schedNodes[0].widgets_values?.[1] ?? 0);
      if (steps < 15) issues.push(`steps=${steps} 过低（无 LoRA 需 ≥15，标准 20 步）`);
    } else {
      issues.push('缺少 BasicScheduler 节点');
    }
    if (!allowMultiSpeaker && durNodes.length > 0) {
      const dur = Number(durNodes[0].widgets_values?.[0] ?? 5);
      if (dur > 5.5) issues.push(`duration=${dur}s 超过 5s 单镜防串麦安全线`);
    }
    results.push({
      gate: '7. safe-resolution-and-steps',
      pass: issues.length === 0,
      detail: issues.length === 0
        ? `OK (steps=${schedNodes[0]?.widgets_values?.[1]}, mp=${resNodes[0]?.widgets_values?.[1] ?? 'N/A'}, dur=${durNodes[0]?.widgets_values?.[0] ?? 'N/A'}s)`
        : issues.join('；')
    });
  }

  // Gate 8: h3-structure-complete
  {
    const missing = [];
    if (!/integrated_multimodal_description:|detailed_description:|整体视听描述：/i.test(promptText)) {
      missing.push('integrated_multimodal_description: 或 detailed_description:');
    }
    if (!/overall_soundscape:/i.test(promptText)) missing.push('overall_soundscape:');
    if (!/non_diegetic_music:/i.test(promptText)) missing.push('non_diegetic_music:');
    results.push({
      gate: '8. h3-structure-complete',
      pass: missing.length === 0,
      detail: missing.length === 0 ? 'OK (H3 原生/多帧结构字段完整)' : `缺少必填字段: ${missing.join(', ')}`
    });
  }

  // Gate 9: zero-forbidden-names
  {
    const hits = forbiddenNames.filter((name) => name && promptText.includes(name));
    results.push({
      gate: '9. zero-forbidden-names',
      pass: hits.length === 0,
      detail: hits.length === 0 ? 'OK (无违禁/错误角色称呼)' : `检测到禁用错名: ${hits.join(', ')}`
    });
  }

  // Gate 10: valid-node-wiring
  {
    const unetIds = new Set(byType('UNETLoader').map((n) => n.id));
    const guiderIds = new Set(byType('BasicGuider').map((n) => n.id));
    const schedIds = new Set(byType('BasicScheduler').map((n) => n.id));
    const h3Ids = new Set(h3Nodes.map((n) => n.id));
    const guideIds = new Set(byType('MiniMaxH3AddGuide').map((n) => n.id));
    const samplerIds = new Set(byType('SamplerCustomAdvanced').map((n) => n.id));

    const hasUnetToGuider = links.some((l) => unetIds.has(l[1]) && guiderIds.has(l[3]));
    const hasUnetToSched = links.some((l) => unetIds.has(l[1]) && schedIds.has(l[3]));
    const hasCondToGuider = links.some((l) => (h3Ids.has(l[1]) || guideIds.has(l[1])) && guiderIds.has(l[3]));
    const hasH3ToSampler = links.some((l) => h3Ids.has(l[1]) && samplerIds.has(l[3]));

    const missing = [];
    if (!hasUnetToGuider) missing.push('UNETLoader -> BasicGuider');
    if (!hasUnetToSched) missing.push('UNETLoader -> BasicScheduler');
    if (!hasCondToGuider) missing.push('MiniMaxH3ReferenceToVideo / MiniMaxH3AddGuide -> BasicGuider');
    if (!hasH3ToSampler) missing.push('MiniMaxH3ReferenceToVideo -> SamplerCustomAdvanced');

    results.push({
      gate: '10. valid-node-wiring',
      pass: missing.length === 0,
      detail: missing.length === 0
        ? `OK (核心推理链路连线完整，AddGuide 串联=${guideIds.size} 个)`
        : `核心连线缺失: ${missing.join(', ')}`
    });
  }

  const failed = results.filter((r) => !r.pass);
  return { ok: failed.length === 0, passedCount: results.length - failed.length, totalCount: results.length, results };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const args = process.argv.slice(2);
  const fileArg = args.find((a) => !a.startsWith('--'));
  if (!fileArg) {
    console.error('用法: node preflight.mjs <workflow.json> [--allow-multi-speaker] [--forbid 词1,词2]');
    process.exit(2);
  }
  const allowMultiSpeaker = args.includes('--allow-multi-speaker');
  const forbidIdx = args.indexOf('--forbid');
  const forbiddenNames = forbidIdx >= 0 && args[forbidIdx + 1]
    ? args[forbidIdx + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : [];
  const wf = JSON.parse(fs.readFileSync(fileArg, 'utf8'));
  const report = validateWorkflow(wf, { allowMultiSpeaker, forbiddenNames });
  console.log(`\n=== ComfyUI MiniMax H3 Preflight (${path.basename(fileArg)}) ===`);
  for (const r of report.results) console.log(`${r.pass ? '✓' : '✗'} [${r.gate}] ${r.detail}`);
  console.log(`\n结果: ${report.passedCount}/${report.totalCount} 通过 ${report.ok ? '✅ PASS' : '❌ BLOCKED'}\n`);
  process.exit(report.ok ? 0 : 1);
}
