#!/usr/bin/env node
/**
 * stitch-and-extract.mjs — 本地 ffmpeg 像素级尾帧提取 & 多镜无损拼接工具（零外部依赖）
 * 自动查找环境变量 FFMPEG_PATH、当前项目 node_modules/ffmpeg-static 或系统 PATH 中的 ffmpeg。
 *
 * 用法：
 *   node stitch-and-extract.mjs extract <input.mp4> <output_last_frame.png> [--offset -0.15]
 *   node stitch-and-extract.mjs concat <output_master.mp4> <clip1.mp4> <clip2.mp4> [...]
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function findFfmpeg() {
  const exe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const candidates = [
    process.env.FFMPEG_PATH,
    path.resolve(process.cwd(), `node_modules/ffmpeg-static/${exe}`),
    'ffmpeg'
  ].filter(Boolean);
  for (const c of candidates) {
    if (c === 'ffmpeg' || fs.existsSync(c)) return c;
  }
  throw new Error('未找到 ffmpeg，请安装系统 ffmpeg、npm install ffmpeg-static 或设置环境变量 FFMPEG_PATH');
}

const args = process.argv.slice(2);
const cmd = args[0];

if (cmd === 'extract') {
  const inMp4 = args[1];
  const outPng = args[2];
  const offIdx = args.indexOf('--offset');
  const offset = offIdx >= 0 && args[offIdx + 1] ? args[offIdx + 1] : '-0.15';
  if (!inMp4 || !outPng) {
    console.error('用法: node stitch-and-extract.mjs extract <input.mp4> <output.png> [--offset -0.15]');
    process.exit(2);
  }
  const ffmpeg = findFfmpeg();
  fs.mkdirSync(path.dirname(path.resolve(outPng)), { recursive: true });
  execFileSync(ffmpeg, ['-y', '-sseof', String(offset), '-i', inMp4, '-update', '1', '-frames:v', '1', outPng], {
    stdio: 'inherit'
  });
  console.log(`✅ Extracted last frame -> ${outPng} (${fs.statSync(outPng).size} bytes)`);
} else if (cmd === 'concat') {
  const outMp4 = args[1];
  const clips = args.slice(2);
  if (!outMp4 || clips.length < 2) {
    console.error('用法: node stitch-and-extract.mjs concat <output.mp4> <clip1.mp4> <clip2.mp4> [...]');
    process.exit(2);
  }
  const ffmpeg = findFfmpeg();
  const absOut = path.resolve(outMp4);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  const listPath = `${absOut}.concat_list.txt`;
  const listContent = clips
    .map((c) => `file '${path.resolve(c).replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
    .join('\n') + '\n';
  fs.writeFileSync(listPath, listContent, 'utf8');
  try {
    execFileSync(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', absOut], {
      stdio: 'inherit'
    });
  } finally {
    if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
  }
  console.log(`✅ Concatenated ${clips.length} clips -> ${absOut} (${fs.statSync(absOut).size} bytes)`);
} else {
  console.error('用法:\n  node stitch-and-extract.mjs extract <in.mp4> <out.png>\n  node stitch-and-extract.mjs concat <out.mp4> <clip1.mp4> <clip2.mp4> ...');
  process.exit(2);
}
