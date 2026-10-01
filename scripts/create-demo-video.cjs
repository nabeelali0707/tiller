// Render a captioned walkthrough from an actual, already captured VS Code demo.
// Requires ffmpeg on PATH and sharp (or TILLER_SHARP_MODULE pointing to it).
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const sharp = require(process.env.TILLER_SHARP_MODULE || 'sharp');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'output', 'demo-video');
const capture = path.join(root, 'output', 'vscode-tiller-demo.png');
const logo = fs.readFileSync(path.join(root, 'integrations/vscode/assets/icon.png')).toString('base64');
fs.mkdirSync(out, { recursive: true });
const esc = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, size, value, color = '#F7F7FC', weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${esc(value)}</text>`;
const label = (x, y, value) => text(x, y, 17, value, '#AFA5FF', 600);
const logoAt = (x, y, size) => `<image x="${x}" y="${y}" width="${size}" height="${size}" href="data:image/png;base64,${logo}"/>`;
const pill = (x, y, width, value) => `<rect x="${x}" y="${y}" width="${width}" height="46" rx="13" fill="#19362F"/>${text(x + 18, y + 30, 20, value, '#7AF0C4', 600)}`;
function frame(index, title, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720">
  <defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#17142D"/><stop offset="1" stop-color="#0A101D"/></linearGradient></defs>
  <rect width="1280" height="720" fill="url(#bg)"/>
  <g font-family="Segoe UI,Arial,sans-serif">
  ${logoAt(38, 24, 44)}${text(94, 55, 24, 'TILLER', '#E7E2FF', 700)}
  ${text(1240, 53, 17, `${index} / 6`, '#B9B4CE').replace('font-size=', 'text-anchor="end" font-size=')}
  ${title ? text(40, 111, 34, title, '#FFFFFF', 600) : ''}
  ${body}
  <rect x="40" y="677" width="1200" height="1" fill="#343147"/>
  ${text(40, 704, 16, 'SCRIPTED FIXTURE  ·  REAL CHECKS  ·  EDITED VS CODE WALKTHROUGH', '#AAA7BC')}
  </g></svg>`;
}
const scenes = [
  { seconds: 4, title: '', body: `${logoAt(70, 198, 178)}${text(286, 267, 72, 'Tiller', '#FFFFFF', 700)}
    ${text(289, 324, 36, 'Make agent execution inspectable.', '#D9D3EF')}
    ${text(74, 474, 27, 'Follow the tools. Check the outcome. Review the patch.', '#E2DFF0')}
    ${pill(74, 527, 368, 'VS Code extension · prototype')}` },
  { seconds: 6, title: '01   See what actually happened', crop: [52, 145, 852, 590], size: [740, 512], pos: [40, 143],
    body: `${label(832, 202, 'ACTUAL EXTENSION VIEW')}${text(832, 255, 32, 'A run you can inspect.', '#FFFFFF', 600)}
    ${text(832, 313, 23, 'Recorded events and tool calls.')}${text(832, 350, 23, 'Visible resource usage.')}
    ${text(832, 387, 23, 'A reviewable repair patch.')}${pill(832, 480, 324, 'Goal: fix numeric addition')}` },
  { seconds: 6, title: '02   Start with evidence', crop: [76, 267, 270, 82], size: [756, 230], pos: [40, 209],
    body: `${label(40, 177, 'RECORDED BASELINE EVENTS')}${label(852, 213, 'THE ORIGINAL BUG')}
    ${text(852, 269, 29, 'Addition was subtracting.', '#FFFFFF', 600)}
    ${text(852, 329, 24, 'The baseline check failed.')}${text(852, 368, 24, 'Tiller recorded the failure.')}
    ${text(40, 526, 27, 'The run then reads the file, applies an edit and requests completion.', '#D9D3EF')}` },
  { seconds: 6, title: '03   Verify before success', crop: [76, 626, 270, 103], size: [756, 288], pos: [40, 185],
    body: `${label(852, 214, 'RUNTIME VERIFICATION')}${text(852, 270, 29, 'The final check passed.', '#FFFFFF', 600)}
    ${text(852, 329, 23, 'Success followed verification.')}${text(852, 368, 23, 'The events remain inspectable.')}
    ${pill(40, 542, 298, '3 scripted decisions / 8 cap')}${pill(362, 542, 250, '4 tool calls / 12 cap')}` },
  { seconds: 6, title: '04   Review the repair', crop: [355, 38, 545, 158], size: [1140, 330], pos: [70, 151],
    body: `${pill(70, 523, 380, 'Subtraction replaced with addition')}
    ${text(70, 613, 25, 'The extension opens the patch for review. The original repository stays unchanged.', '#D9D3EF')}` },
  { seconds: 4, title: '', body: `${logoAt(66, 167, 128)}${text(227, 224, 56, 'Explore Tiller', '#FFFFFF', 700)}
    ${text(70, 365, 34, 'github.com/nabeelali0707/tiller', '#AFA5FF', 600)}
    ${text(70, 454, 28, 'Explicit execution. Observable tools. Verified checks.', '#F2EFFB')}
    ${text(70, 552, 23, 'Research-inspired prototype; model performance gains remain unmeasured.', '#BFBACE')}` },
];
function run(args) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: root, windowsHide: true, stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${result.status}`);
}
(async () => {
  const metadata = await sharp(capture).metadata();
  if (metadata.width !== 1206 || metadata.height !== 804) throw new Error('Capture dimensions changed; review the crop coordinates before rendering.');
  for (const [i, scene] of scenes.entries()) {
    const background = path.join(out, `scene-${i}.png`);
    await sharp(Buffer.from(frame(i + 1, scene.title, scene.body))).png().toFile(background);
    const args = ['-loop', '1', '-framerate', '30', '-i', background];
    let filter = '';
    if (scene.crop) {
      args.push('-loop', '1', '-framerate', '30', '-i', capture);
      const [x, y, w, h] = scene.crop;
      filter = `[1:v]crop=${w}:${h}:${x}:${y},scale=${scene.size[0]}:${scene.size[1]}:flags=lanczos[c];[0:v][c]overlay=${scene.pos[0]}:${scene.pos[1]}[s];[s]`;
    } else filter = '[0:v]';
    filter += `fade=t=in:st=0:d=0.25,fade=t=out:st=${scene.seconds - 0.25}:d=0.25,format=yuv420p[v]`;
    args.push('-filter_complex', filter, '-map', '[v]', '-t', String(scene.seconds), '-an', '-r', '30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', path.join(out, `scene-${i}.mp4`));
    run(args);
    console.log(`Rendered scene ${i + 1}/${scenes.length}`);
  }
  fs.writeFileSync(path.join(out, 'concat.txt'), scenes.map((_, i) => `file 'scene-${i}.mp4'`).join('\n'));
  run(['-f', 'concat', '-safe', '0', '-i', path.join(out, 'concat.txt'), '-c', 'copy', '-movflags', '+faststart', path.join(root, 'output/tiller-demo.mp4')]);
  run(['-ss', '25', '-i', path.join(root, 'output/tiller-demo.mp4'), '-frames:v', '1', path.join(root, 'output/tiller-demo-poster.png')]);
  console.log('Created output/tiller-demo.mp4 (32 seconds, 1280×720, silent with captions).');
})();
