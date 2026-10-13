#!/usr/bin/env node
// Records the browser demo (demo/browser) as a loop, and the hero from the installed roster.
// Usage: pnpm media:capture. Needs agent-browser (with its browser installed) and FFmpeg on the PATH.
import { execFile, spawn } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
// Staffed keeps no dependencies, not even dev ones, so showcase comes from npx (see the media:capture script)
// and is found through its bin on the PATH.
const showcase = await realpath((await exec('which', ['showcase'])).stdout.trim());
const { record } = await import(pathToFileURL(path.join(path.dirname(showcase), '../src/capture.js')).href);
const media = path.resolve('demo/media');
const viewport = { width: 960, height: 720 };
// Everything below the page title: the hint buttons and the terminal. The hero is the terminal only.
const crop = 'iw:ih*29/36:0:ih*7/36';
const heroCrop = 'iw:ih*22/36:0:ih*14/36';
const commands = [
  ['staffed enable --profile anthropic', `window.terminalText().includes('enabled in total')`],
  ['staffed compose pm decisive sceptic', `window.terminalText().includes('interrogate unsupported assumptions')`],
  ['staffed status', `window.terminalText().includes('11/11 enabled')`],
];

const out = await mkdtemp(path.join(os.tmpdir(), 'staffed-demo-'));
const port = String(4400 + (process.pid % 500));
const server = spawn(showcase, ['terminal', '--out', path.join(out, 'browser'), '--serve', '--port', port], {
  stdio: ['ignore', 'pipe', 'inherit'],
});
await new Promise((resolve, reject) => {
  createInterface({ input: server.stdout }).on('line', (line) => line.startsWith('Serving at') && resolve());
  server.once('exit', (code) => reject(new Error(`showcase terminal exited with status ${code}`)));
});
const shot = path.join(out, 'last.png');
try {
  const { frames, durationMs, grid } = await record({
    url: `http://127.0.0.1:${port}/`,
    out: path.join(media, 'demo.webp'),
    viewport,
    width: viewport.width,
    crop,
    attempts: 3,
    async start(page) {
      await page.waitFor(`!document.querySelector("#hints button").disabled`, { timeoutMs: 60_000 });
      await page.run('eval', `document.querySelector("textarea").focus()`);
      await page.run('keyboard', 'type', 'clear');
      await page.run('press', 'Enter');
      await page.sleep(800);
    },
    async drive(page) {
      await page.sleep(700);
      for (const [index, [command, done]] of commands.entries()) {
        // Ctrl-L clears the screen without a visible command, so each output starts at the top.
        if (index) await page.run('press', 'Control+l');
        await page.click(command);
        await page.waitFor(done, { timeoutMs: 60_000 });
        await page.sleep(2500);
      }
      // The hero is the last output: every role installed, with the model its tier maps to.
      await page.run('screenshot', shot);
    },
  });
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', shot, '-vf', `crop=${heroCrop}`, path.join(media, 'hero.png')]);
  console.log(`Wrote demo/media/demo.webp (${frames} frames, ${(durationMs / 1000).toFixed(1)} s) and demo/media/hero.png. Check the frames in ${grid}.`);
} finally {
  server.kill();
  await rm(out, { recursive: true, force: true });
}
