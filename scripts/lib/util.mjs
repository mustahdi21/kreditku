/**
 * util.mjs — Utilitas bersama untuk skrip konfigurasi KreditKu.
 *
 * Prinsip keamanan:
 *   * Rahasia TIDAK PERNAH dicetak ke layar atau ditulis ke log.
 *   * Input rahasia dibaca tanpa echo (mode tersembunyi pada TTY).
 *   * Berkas .env ditulis dengan izin 0600 bila memungkinkan.
 */

import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { execFileSync } from 'node:child_process';

export const COLOR = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  cyan: '\u001b[36m',
};

export function color(code, text) {
  return `${code}${text}${COLOR.reset}`;
}

export function heading(text) {
  console.log(`\n${color(COLOR.bold + COLOR.blue, text)}`);
  console.log('-'.repeat(Math.max(20, text.length)));
}

export function step(text) {
  console.log(`${color(COLOR.cyan, '›')} ${text}`);
}

export function success(text) {
  console.log(`${color(COLOR.green, '✔')} ${text}`);
}

export function warn(text) {
  console.log(`${color(COLOR.yellow, '!')} ${text}`);
}

export function fail(text) {
  console.log(`${color(COLOR.red, '✖')} ${text}`);
}

export function info(text) {
  console.log(`  ${color(COLOR.dim, text)}`);
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

let rl = null;

function readline() {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout });
  }
  return rl;
}

export function closePrompts() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

/** Pertanyaan biasa (jawaban terlihat). */
export function ask(question, { defaultValue = '' } = {}) {
  const suffix = defaultValue ? ` ${color(COLOR.dim, `[${defaultValue}]`)}` : '';
  return new Promise((resolve) => {
    readline().question(`${color(COLOR.bold, '?')} ${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

/** Pertanyaan konfirmasi ya/tidak. */
export async function confirm(question, defaultValue = false) {
  const answer = await ask(`${question} (y/t)`, { defaultValue: defaultValue ? 'y' : 't' });
  return ['y', 'ya', 'yes'].includes(answer.toLowerCase());
}

/**
 * Pertanyaan untuk nilai rahasia: tidak ditampilkan saat diketik.
 * Jangan pernah mencatat nilai yang dikembalikan.
 */
export function askHidden(question) {
  return new Promise((resolve) => {
    const iface = readline();
    const stdin = process.stdin;
    process.stdout.write(`${color(COLOR.bold, '?')} ${question}: `);

    if (!stdin.isTTY) {
      iface.question('', (answer) => resolve(answer.trim()));
      return;
    }

    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();
    let value = '';

    const onData = (char) => {
      const text = char.toString('utf8');
      if (text === '\r' || text === '\n') {
        process.stdout.write('\n');
        cleanup();
        resolve(value.trim());
        return;
      }
      if (text === '\u0003') {
        process.stdout.write('\n');
        cleanup();
        process.exit(130);
        return;
      }
      if (text === '\u007f' || text === '\b') {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };

    const cleanup = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    stdin.on('data', onData);
  });
}

/* -------------------------------------------------------------------------- */
/* Berkas .env                                                                */
/* -------------------------------------------------------------------------- */

export function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf8');
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].trim().replace(/^["']|["']$/g, '');
  }
  return result;
}

/** Menulis/memperbarui nilai pada .env tanpa menghapus komentar yang ada. */
export function updateEnvFile(path, values) {
  let content = existsSync(path) ? readFileSync(path, 'utf8') : '';
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm');
    if (pattern.test(content)) content = content.replace(pattern, line);
    else content += `${content.endsWith('\n') || content === '' ? '' : '\n'}${line}\n`;
  }
  writeFileSync(path, content, 'utf8');
  try {
    chmodSync(path, 0o600);
  } catch {
    /* Izin berkas tidak dapat diubah pada sebagian sistem berkas (mis. FAT). */
  }
}

/* -------------------------------------------------------------------------- */
/* Proses                                                                     */
/* -------------------------------------------------------------------------- */

/** Menjalankan perintah dan mengembalikan stdout (tanpa mewarisi lingkungan rahasia). */
export function run(command, args = [], options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  }).trim();
}

export function hasCommand(command) {
  try {
    execFileSync('which', [command], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Memastikan token rahasia tidak pernah tercetak. */
export function redact(value) {
  if (!value) return '(kosong)';
  const text = String(value);
  if (text.length <= 8) return '*'.repeat(text.length);
  return `${text.slice(0, 4)}…${'*'.repeat(Math.min(12, text.length - 8))}…${text.slice(-4)}`;
}

/** Memeriksa apakah nilai benar-benar diisi (bukan placeholder). */
export function isFilled(value) {
  if (!value) return false;
  return !/xxxxxxxx|your-|example|changeme|placeholder/i.test(value);
}
