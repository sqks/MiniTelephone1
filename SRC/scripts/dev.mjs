import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// SRC/scripts/dev.mjs -> SRC/
const srcRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// Extra CLI args (e.g. --port / --host) are forwarded to the Vite dev server.
const viteArgs = process.argv.slice(2);

// 只监听本地源码文件；node --watch 默认会监听整个模块图（含 node_modules），
// 依赖文件被占用/扫描时会触发无意义重启甚至端口冲突导致起不来。
const server = spawn(
  process.execPath,
  ['--watch-path=index.js', '--watch-path=db.js', 'index.js'],
  {
    cwd: path.join(srcRoot, 'server'),
    stdio: 'inherit',
  },
);

const client = spawn(process.execPath, ['node_modules/vite/bin/vite.js', ...viteArgs], {
  cwd: path.join(srcRoot, 'client'),
  stdio: 'inherit',
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const p of [server, client]) {
    if (!p.killed) p.kill('SIGTERM');
  }
  // Give children a moment to exit, then force out.
  setTimeout(() => process.exit(code), 500).unref();
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
server.on('exit', (code) => shutdown(code ?? 0));
client.on('exit', (code) => shutdown(code ?? 0));

console.log('MiniTelephone dev: SRC/client (Vite) + SRC/server (Express, port 3001), data in resource/');
