#!/usr/bin/env node

/**
 * Acode Plugin Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * Static-analysis CLI for Acode plugin zip files.
 * Detects dangerous capabilities: file-system access, shell execution,
 * network exfiltration, Cordova native bridge usage, and obfuscation patterns.
 *
 * Usage:
 *   node server/lib/pluginScanner.js <plugin.zip> [plugin2.zip ...] [--json] [--md]
 *   node server/lib/pluginScanner.js data/plugins/*.zip
 *   node server/lib/pluginScanner.js data/plugins/acode.terminal.zip --json
 *   node server/lib/pluginScanner.js data/plugins/acode.terminal.zip --md
 *
 * Flags:
 *   --json      Write scan-report.json with full structured findings
 *   --md        Print the plain-English markdown summary to stdout (always writes scan-report.md)
 *   --no-color  Disable ANSI colour in console output
 *
 * Exit codes:
 *   0  — no findings (or only INFO)
 *   1  — at least one LOW or MEDIUM finding
 *   2  — at least one HIGH finding
 *   3  — at least one CRITICAL finding
 */

const JSZip = require('jszip');
const fs = require('node:fs/promises');
const { join } = require('node:path');

// ─── Severity levels ──────────────────────────────────────────────────────────
const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const SEV_LABEL = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

// ─── Detection rules ──────────────────────────────────────────────────────────
// Each rule: { id, severity, pattern (RegExp), description, detail }
const RULES = [
  // ── CRITICAL ──────────────────────────────────────────────────────────────
  {
    id: 'C001',
    severity: SEV.CRITICAL,
    pattern: /\bExecutor\s*\.\s*execute\s*\(/,
    description: 'Silent background shell execution',
    detail:
      'Executor.execute() runs arbitrary shell commands without showing a terminal to the user. ' +
      'Common vector for credential theft, data exfiltration, or persistence.',
  },
  {
    id: 'C002',
    severity: SEV.CRITICAL,
    pattern: /\bcordova\s*\.\s*exec\s*\(/,
    description: 'Direct Cordova native bridge call',
    detail:
      'cordova.exec() calls native Android/iOS code directly, bypassing all web-layer restrictions. ' +
      'Can access SMS, contacts, camera, clipboard, and more.',
  },
  {
    id: 'C003',
    severity: SEV.CRITICAL,
    pattern: /\bcordova\s*\.\s*plugins\b/,
    description: 'Cordova native plugin access',
    detail: 'Access to cordova.plugins.* grants direct use of native device plugins ' + '(camera, file, geolocation, SMS, contacts, etc.).',
  },
  {
    id: 'C004',
    severity: SEV.CRITICAL,
    pattern: /window\s*\.\s*cordova\b/,
    description: 'window.cordova detected',
    detail: 'Direct reference to the Cordova global, same risks as C002/C003.',
  },

  // ── HIGH ──────────────────────────────────────────────────────────────────
  {
    id: 'H001',
    severity: SEV.HIGH,
    pattern: /acode\s*\.\s*require\s*\(\s*["'`](fs|fsOperation)["'`]\s*\)/,
    description: 'File-system module imported',
    detail:
      'The fs/fsOperation module gives full read/write/delete/list access to any path ' +
      'the app can reach on the device. Look for readFile, writeFile, lsDir, delete calls.',
  },
  {
    id: 'H002',
    severity: SEV.HIGH,
    pattern: /\.\s*readFile\s*\(/,
    description: 'File read operation',
    detail: 'Reads a file from the device. Could exfiltrate source code, SSH keys, tokens, etc.',
  },
  {
    id: 'H003',
    severity: SEV.HIGH,
    pattern: /\.\s*writeFile\s*\(/,
    description: 'File write operation',
    detail: 'Writes data to a device file. Could plant backdoors or modify configuration.',
  },
  {
    id: 'H004',
    severity: SEV.HIGH,
    pattern: /\.\s*lsDir\s*\(/,
    description: 'Directory listing',
    detail: 'Lists directory contents. Can be used for reconnaissance of the file system.',
  },
  {
    id: 'H005',
    severity: SEV.HIGH,
    pattern: /acode\s*\.\s*require\s*\(\s*["'`]terminal["'`]\s*\)/,
    description: 'Terminal module imported',
    detail:
      'The terminal module can spawn interactive and server-backed shell sessions. ' +
      'Combined with createServer() this is equivalent to remote shell access.',
  },
  {
    id: 'H006',
    severity: SEV.HIGH,
    pattern: /\bterminal\s*\.\s*(create|createServer|write)\s*\(/,
    description: 'Terminal session created or written to',
    detail: 'Creates a terminal session or writes commands into one. ' + 'createServer() connects to a backend Alpine shell.',
  },
  {
    id: 'H007',
    severity: SEV.HIGH,
    // Matches fetch( but not "no-fetch" false positives from comments
    pattern: /(?<![/]{2}[^\n]*)\bfetch\s*\(/,
    description: 'HTTP fetch() call',
    detail: 'Makes a network request. Could exfiltrate editor content, file data, or device info ' + 'to an attacker-controlled server.',
  },
  {
    id: 'H008',
    severity: SEV.HIGH,
    pattern: /\bXMLHttpRequest\b/,
    description: 'XMLHttpRequest (XHR) usage',
    detail: 'Older HTTP API — same risk as fetch(). Can make cross-origin requests.',
  },
  {
    id: 'H009',
    severity: SEV.HIGH,
    pattern: /new\s+WebSocket\s*\(/,
    description: 'WebSocket connection opened',
    detail: 'Opens a persistent bidirectional socket. Common in RAT/C2 implants for ' + 'real-time data exfiltration or remote control.',
  },
  {
    id: 'H010',
    severity: SEV.HIGH,
    pattern: /\.\s*delete\s*\(\s*\)/,
    description: 'File/directory delete operation',
    detail: 'Deletes a file or directory via the fs API. Could be used for destruction or covering tracks.',
  },
  {
    id: 'H011',
    severity: SEV.HIGH,
    pattern: /\.\s*copyTo\s*\(|\.moveTo\s*\(/,
    description: 'File copy/move operation',
    detail: 'Copies or moves files — can stage sensitive data before exfiltration.',
  },

  // ── MEDIUM ────────────────────────────────────────────────────────────────
  {
    id: 'M001',
    severity: SEV.MEDIUM,
    pattern: /\blocalStorage\s*\./,
    description: 'localStorage access',
    detail: 'Reads or writes browser localStorage. May contain API keys, session tokens, or settings.',
  },
  {
    id: 'M002',
    severity: SEV.MEDIUM,
    pattern: /\bsessionStorage\s*\./,
    description: 'sessionStorage access',
    detail: 'Reads or writes sessionStorage. Same risk as localStorage.',
  },
  {
    id: 'M003',
    severity: SEV.MEDIUM,
    pattern: /\bdocument\s*\.\s*cookie\b/,
    description: 'document.cookie access',
    detail: 'Reads or sets cookies. May capture authentication cookies.',
  },
  {
    id: 'M004',
    severity: SEV.MEDIUM,
    pattern: /\bindexedDB\s*\.\s*open\b/,
    description: 'IndexedDB opened',
    detail: 'Accesses IndexedDB which may hold cached sensitive data from within the app.',
  },
  {
    id: 'M005',
    severity: SEV.MEDIUM,
    pattern: /\beditorManager\s*\.\s*files\b/,
    description: 'editorManager.files accessed',
    detail:
      'Enumerates all currently open files in the editor, including their URIs and content. ' +
      'Can be used to silently read the contents of any open file.',
  },
  {
    id: 'M006',
    severity: SEV.MEDIUM,
    pattern: /\beditorManager\s*\.\s*activeFile\b/,
    description: 'editorManager.activeFile accessed',
    detail: 'Reads the currently active editor file object, including its path and content.',
  },
  {
    id: 'M007',
    severity: SEV.MEDIUM,
    pattern: /acode\s*\.\s*installPlugin\s*\(/,
    description: 'Installs another plugin',
    detail:
      'acode.installPlugin() can silently install additional plugins, ' + 'potentially loading secondary payloads after passing initial review.',
  },
  {
    id: 'M008',
    severity: SEV.MEDIUM,
    pattern: /acode\s*\.\s*require\s*\(\s*["'`]intent["'`]\s*\)/,
    description: 'Intent API imported',
    detail:
      'The intent module lets a plugin intercept files and URIs shared from other Android apps. ' +
      'Can be used to silently capture documents shared into Acode.',
  },
  {
    id: 'M009',
    severity: SEV.MEDIUM,
    pattern: /\b(DATA_STORAGE|CACHE_STORAGE|PLUGIN_DIR|KEYBINDING_FILE)\b/,
    description: 'Sensitive path constant used',
    detail:
      'These globals expose paths to private app storage and key configuration files. ' +
      'Combined with the fs API they allow targeted file reads/writes.',
  },
  {
    id: 'M010',
    severity: SEV.MEDIUM,
    pattern: /acode\s*\.\s*registerFileHandler\s*\(\s*[^,]+,\s*\{\s*extensions\s*:\s*\[[^\]]*["'`]\*["'`]/,
    description: 'Wildcard file handler registered',
    detail: 'registerFileHandler with "*" intercepts every file the user opens, ' + 'regardless of extension — a broad surveillance hook.',
  },

  // ── LOW ───────────────────────────────────────────────────────────────────
  {
    id: 'L001',
    severity: SEV.LOW,
    pattern: /\beval\s*\(/,
    description: 'eval() call detected',
    detail:
      'eval() executes arbitrary strings as code at runtime. ' +
      'Often used to hide malicious logic from static analysis. ' +
      'Legitimate use-cases exist (e.g. REPL plugins) but should be reviewed carefully.',
  },
  {
    id: 'L002',
    severity: SEV.LOW,
    pattern: /\bnew\s+Function\s*\(/,
    description: 'new Function() call detected',
    detail: 'Equivalent to eval() — dynamically constructs and executes code. Common obfuscation technique.',
  },
  {
    id: 'L003',
    severity: SEV.LOW,
    pattern: /\batob\s*\(/,
    description: 'Base64 decode (atob) call',
    detail:
      'atob() decodes base64. Frequently used to hide encoded payloads from string-search tools. ' +
      'Check whether the result is passed to eval() or injected into the DOM.',
  },
  {
    id: 'L004',
    severity: SEV.LOW,
    // Long base64-looking string: 500+ consecutive base64 characters
    pattern: /["'`][A-Za-z0-9+/]{500,}={0,2}["'`]/,
    description: 'Large base64-encoded string literal',
    detail:
      'A string of 500+ base64 characters may be an encoded payload (script, binary, or data). ' +
      'Check what it is decoded into and whether it is executed.',
  },
  {
    id: 'L005',
    severity: SEV.LOW,
    pattern: /\bwindow\s*\[/,
    description: 'Dynamic window property access (window[...])',
    detail:
      'Accessing window properties dynamically can hide what global or API is being called. ' +
      'Common in obfuscated code to avoid keyword detection.',
  },
  {
    id: 'L006',
    severity: SEV.LOW,
    pattern: /\bdecodeURIComponent\s*\(/,
    description: 'decodeURIComponent() call',
    detail: 'Often chained with atob() or eval() to decode and execute hidden payloads. ' + 'Check what the decoded value is used for.',
  },
];

// ─── URL extractor ────────────────────────────────────────────────────────────
const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]},\\]{5,}/g;

// ─── Markdown summary generator ──────────────────────────────────────────────

/**
 * Plain-English capability labels for rule IDs.
 * Grouped so multiple rules about the same capability collapse into one bullet.
 */
const CAPABILITY_MAP = {
  // Shell / native
  C001: {
    group: 'shell',
    label: 'Run commands in the background without opening a visible terminal',
    why: 'Usually done by build tools or automation plugins. Requires review to confirm the commands are safe.',
  },
  C002: {
    group: 'native',
    label: 'Directly call native Android device features',
    why: "Needed by plugins that integrate with hardware (e.g. clipboard, camera). Should match the plugin's stated purpose.",
  },
  C003: {
    group: 'native',
    label: 'Use native device features like clipboard, camera, or contacts',
    why: 'Common in plugins that copy text to clipboard or share content. Check that only the features the plugin describes are used.',
  },
  C004: {
    group: 'native',
    label: 'Use native device features like clipboard, camera, or contacts',
    why: 'Common in plugins that copy text to clipboard or share content. Check that only the features the plugin describes are used.',
  },
  // File system
  H001: {
    group: 'fs',
    label: 'Read and write files on your device',
    why: 'Normal for plugins that open, save, or manage files. The plugin should only access files the user has chosen to work with.',
  },
  H002: {
    group: 'fs',
    label: 'Read files from your device storage',
    why: 'Normal for plugins that open or process files. Expected in editors, formatters, and preview plugins.',
  },
  H003: {
    group: 'fs',
    label: 'Write or modify files on your device storage',
    why: 'Normal for plugins that save files, apply formatting, or generate output.',
  },
  H004: {
    group: 'fs',
    label: 'Browse folder contents on your device',
    why: 'Normal for file manager and project plugins that display directory trees.',
  },
  H010: {
    group: 'fs',
    label: 'Delete files or folders on your device',
    why: 'Used by file management or cleanup plugins. Should only delete files the plugin has been given permission to manage.',
  },
  H011: {
    group: 'fs',
    label: 'Copy or move files on your device',
    why: "Used by file management plugins. Should only act on files within the user's project.",
  },
  // Network
  H007: {
    group: 'network',
    label: 'Connect to the internet (make network requests)',
    why: 'Common in many plugins — AI assistants, cloud sync, package managers, REST API testers. Check that the plugin only contacts the servers it describes.',
  },
  H008: {
    group: 'network',
    label: 'Connect to the internet (make network requests)',
    why: 'Same as above using an older web API. Common in bundled libraries.',
  },
  H009: {
    group: 'network',
    label: 'Keep an open connection to a server (WebSocket)',
    why: 'Used by terminal, live-preview, and language server plugins that need real-time communication. Expected if the plugin runs a local server.',
  },
  // Terminal
  H005: {
    group: 'terminal',
    label: 'Create terminal sessions inside the editor',
    why: 'Expected in terminal or shell plugins. The terminal is visible to the user.',
  },
  H006: {
    group: 'terminal',
    label: 'Send input to a terminal session',
    why: 'Expected in terminal or automation plugins that interact with a shell.',
  },
  // Storage
  M001: {
    group: 'storage',
    label: 'Save and load settings or data locally on your device',
    why: 'Very common — used to remember preferences, authentication tokens, or cached data between sessions.',
  },
  M002: {
    group: 'storage',
    label: 'Save temporary data for the current session',
    why: 'Used to store short-lived state. Cleared when the browser session ends.',
  },
  M003: { group: 'storage', label: 'Access browser cookies', why: 'Occasionally used for session management. Less common in editor plugins.' },
  M004: {
    group: 'storage',
    label: 'Use a local structured database (IndexedDB)',
    why: 'Used by plugins that store larger amounts of data locally, like cached completions or history.',
  },
  M009: {
    group: 'storage',
    label: 'Access Acode app storage folders',
    why: "Used by plugins that save state or configuration into the app's own storage directory. Normal for plugins that persist settings.",
  },
  // Editor access
  M005: {
    group: 'editor',
    label: 'See which files are currently open in the editor',
    why: 'Used by plugins that work across multiple open files, like tab managers or multi-file search tools.',
  },
  M006: {
    group: 'editor',
    label: 'Read the file currently open in the editor',
    why: 'Very common — used by formatters, linters, AI assistants, and any plugin that acts on the current file.',
  },
  // Plugin install
  M007: {
    group: 'install',
    label: 'Install other plugins',
    why: 'Rare. Could be used by plugin manager or bundle plugins. Requires a user consent prompt from Acode.',
  },
  // Intent / deep links
  M008: {
    group: 'intent',
    label: 'Receive files or links shared from other apps',
    why: "Used by plugins that add an 'Open in Acode' option or accept shared text from other Android apps.",
  },
  M010: {
    group: 'wildcard',
    label: 'Handle any file type the user opens',
    why: 'Used by plugins that provide a custom viewer or handler for all files, regardless of extension.',
  },
  // Bundling / dynamic code
  L001: {
    group: 'dynamic',
    label: 'Run code that is constructed at runtime',
    why: 'Common in bundled and minified JavaScript. Also used by REPL and sandbox plugins. Worth checking if it appears in an unexpected plugin.',
  },
  L002: {
    group: 'dynamic',
    label: 'Run code that is constructed at runtime',
    why: 'Same as above using a different method. Common in older bundlers.',
  },
  L003: {
    group: 'dynamic',
    label: 'Decode base64-encoded data at runtime',
    why: 'Common in bundled plugins that embed assets (fonts, icons, WASM) as base64 strings.',
  },
  L004: {
    group: 'dynamic',
    label: 'Contains large embedded data (likely an asset)',
    why: 'Plugins sometimes bundle binary assets (fonts, WASM modules, icons) as base64 strings. Normal if the plugin embeds resources.',
  },
  L005: { group: 'dynamic', label: 'Access browser globals dynamically', why: 'Common output of JavaScript bundlers and minifiers.' },
  L006: { group: 'dynamic', label: 'Decode URL-encoded data at runtime', why: 'Common in plugins that process URLs or handle user-supplied input.' },
};

const GROUP_HEADING = {
  shell: '⚙️ Background Command Execution',
  native: '📱 Native Device Feature Access',
  fs: '📂 File Access',
  network: '🌐 Internet Access',
  terminal: '💻 Terminal / Shell',
  storage: '💾 Local Data Storage',
  editor: '📝 Editor File Access',
  install: '📦 Plugin Installation',
  intent: '📲 File / Link Sharing (Android Intents)',
  wildcard: '🪝 Universal File Handler',
  dynamic: '📦 Bundled or Dynamic Code',
};

/**
 * Scan a single JS file's source text.
 * @param {string} filename   relative filename inside the zip
 * @param {string} source     file content
 * @returns {{ findings: Finding[], urls: string[] }}
 */
function scanSource(filename, source) {
  const lines = source.split('\n');
  const findings = [];
  const urlSet = new Set();

  // Collect all URLs from the entire source first
  for (const match of source.matchAll(URL_PATTERN)) {
    urlSet.add(match[0].replace(/[.,;)}\]]+$/, '')); // trim trailing punctuation
  }

  // Run every rule over every line
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const rule of RULES) {
      if (rule.pattern.test(line)) {
        findings.push({
          ruleId: rule.id,
          severity: rule.severity,
          severityLabel: SEV_LABEL[rule.severity],
          description: rule.description,
          detail: rule.detail,
          file: filename,
          line: i + 1,
          snippet: line.trim().slice(0, 200),
        });
      }
    }
  }

  return { findings, urls: [...urlSet] };
}

/**
 * Scan an entire plugin zip buffer.
 * @param {Buffer} zipBuffer
 * @param {string} zipName    display name / path of the zip
 * @returns {Promise<ScanResult>}
 */
async function scanPlugin(zipBuffer, zipName) {
  const zip = new JSZip();
  await zip.loadAsync(zipBuffer);

  let pluginMeta = {};
  const pluginJsonFile = zip.file('plugin.json');
  if (pluginJsonFile) {
    try {
      pluginMeta = JSON.parse(await pluginJsonFile.async('string'));
    } catch {}
  }

  const allFindings = [];
  const allUrls = new Set();
  const scannedFiles = [];

  const jsFiles = [];
  zip.forEach((relPath, entry) => {
    if (!entry.dir && /\.(js|mjs|cjs|ts)$/.test(relPath)) {
      jsFiles.push({ relPath, entry });
    }
  });

  for (const { relPath, entry } of jsFiles) {
    const source = await entry.async('string');
    const { findings, urls } = scanSource(relPath, source);
    allFindings.push(...findings);
    for (const u of urls) allUrls.add(u);
    scannedFiles.push({ file: relPath, findings: findings.length });
  }

  const severityCounts = [0, 0, 0, 0, 0]; // indexed by SEV.*
  for (const f of allFindings) severityCounts[f.severity]++;

  return {
    zipName,
    pluginId: pluginMeta.id || '(unknown)',
    pluginName: pluginMeta.name || '(unknown)',
    pluginVersion: pluginMeta.version || '?',
    scannedFiles,
    findings: allFindings,
    urls: [...allUrls].sort(),
    severityCounts,
  };
}

/**
 * Build a user-friendly, informative (non-alarming) Markdown summary for one plugin result.
 */
module.exports = async function buildScanSummary(zipBuffer, zipName) {
  const result = await scanPlugin(zipBuffer, zipName);

  const lines = [];

  lines.push(`## ${result.pluginName}`);
  lines.push('');
  lines.push(`- **Plugin ID:** \`${result.pluginId}\``);
  lines.push(`- **Version:** ${result.pluginVersion}`);
  lines.push(`- **Plugin size:** ${(zipBuffer.length / 1048576).toFixed(2)} MB`);
  lines.push(`- **Scan date:** ${new Date().toISOString()}`);
  lines.push(`- **Files scanned:** ${result.scannedFiles.length}`);
  lines.push('');
  lines.push('---');

  if (result.findings.length === 0) {
    lines.push('### ✅ No notable capabilities detected');
    lines.push('');
    lines.push('This plugin does not use any sensitive device features. No further review needed.');
  } else {
    lines.push('### What this plugin does');
    lines.push('');
    lines.push('This plugin uses the following device or editor capabilities.');
    lines.push('Each one is listed with a short note on why a plugin might legitimately need it.');
    lines.push('');

    const groupMap = {};
    for (const f of result.findings) {
      const cap = CAPABILITY_MAP[f.ruleId];
      if (!cap) continue;
      if (!groupMap[cap.group]) groupMap[cap.group] = new Map();
      groupMap[cap.group].set(cap.label, cap.why);
    }

    const groupOrder = ['shell', 'native', 'fs', 'network', 'terminal', 'storage', 'editor', 'install', 'intent', 'wildcard', 'dynamic'];
    for (const group of groupOrder) {
      if (!groupMap[group]) continue;
      lines.push(`#### ${GROUP_HEADING[group]}`);
      lines.push('');
      for (const [label, why] of groupMap[group]) {
        lines.push(`- **${label}**`);
        lines.push(`  *${why}*`);
      }
      lines.push('');
    }

    lines.push('### Reviewer note');
    lines.push('');
    if (result.severityCounts[SEV.CRITICAL] > 0) {
      lines.push('This plugin uses capabilities that are uncommon even in advanced plugins — specifically, running commands');
      lines.push('in the background or calling native Android APIs directly. These are worth a manual look to confirm');
      lines.push('they match what the plugin says it does.');
    } else if (result.severityCounts[SEV.HIGH] > 0) {
      lines.push('This plugin uses capabilities like file access or internet connectivity, which are standard in many');
      lines.push('plugins (formatters, AI tools, cloud sync, etc.). A quick check to confirm usage matches the');
      lines.push("plugin's description is sufficient.");
    } else if (result.severityCounts[SEV.MEDIUM] > 0) {
      lines.push('This plugin uses common capabilities like saving local settings or reading the current editor file.');
      lines.push('These are found in most non-trivial plugins. No special concern — a brief description review is enough.');
    } else {
      lines.push('This plugin only has minor indicators that are typical of any bundled JavaScript package.');
      lines.push('No review action needed.');
    }
  }

  if (result.urls.length > 0) {
    lines.push('');
    lines.push('### Services this plugin communicates with');
    lines.push('');
    lines.push("The following URLs were found in the plugin code. Confirm they match the plugin's stated purpose:");
    lines.push('');
    for (const u of result.urls) {
      lines.push(`- \`${u}\``);
    }
  }

  lines.push('');

  const markdown = lines.join('\n');

  fs.writeFile(join(process.cwd(), 'data', 'plugins', `${result.pluginId || 'unknown'}.scan-report.md`), markdown, 'utf-8').catch((err) => {
    console.error('Error writing markdown report:', err);
  });

  return markdown;
};
