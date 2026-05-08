import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const existingNodeOptions = process.env.NODE_OPTIONS ?? '';
const useSystemCa = '--use-system-ca';
const nodeOptions = existingNodeOptions.includes(useSystemCa)
  ? existingNodeOptions
  : `${existingNodeOptions} ${useSystemCa}`.trim();

const command = process.platform === 'win32' ? 'cmd.exe' : 'wrangler';
const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'wrangler', ...args] : args;
const child = spawn(command, commandArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_OPTIONS: nodeOptions,
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
