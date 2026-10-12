import { spawn } from 'node:child_process';

/** Opens url in the default browser on macOS, Windows ("start" is a cmd built-in) and Linux. */
export function openBrowser(url) {
  const [program, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : ['xdg-open', [url]];
  spawn(program, args, { stdio: 'ignore', windowsVerbatimArguments: true })
    .once('error', () => console.log(`Open ${url} in your browser.`));
}
