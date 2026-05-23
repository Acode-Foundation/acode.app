#!/usr/bin/env node

/**
 * Acode Plugin Scanner (Optimized & Detailed Cordova Detection)
 * Static-analysis CLI for Acode plugin zip files.
 */

const JSZip = require('jszip');
const fs = require('node:fs/promises');
const { join, basename } = require('node:path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
const SEV_LABEL = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

function identifierMatches(node, name) {
  if (!node) return false;
  if (node.type === 'Identifier') return node.name === name;
  if (node.type === 'MemberExpression') {
    // FIX: Only check the object chain to ensure 'name' is the root object.
    // This prevents false positives like `foo.window.cordova` matching 'window'.
    return identifierMatches(node.object, name);
  }
  return false;
}

function getStringValue(node) {
  if (!node) return null;
  if (node.type === 'StringLiteral' || node.type === 'Literal') {
    return typeof node.value === 'string' ? node.value : null;
  }
  return null;
}

function getFullMemberPath(node) {
  const parts = [];
  let current = node;
  while (current) {
    if (current.type === 'Identifier') {
      parts.unshift(current.name);
      break;
    } else if (current.type === 'MemberExpression' && !current.computed) {
      if (current.property.type === 'Identifier') {
        parts.unshift(current.property.name);
      }
      current = current.object;
    } else {
      break;
    }
  }
  return parts;
}

const RULES = [
  // --- SYSTEM & ACODE API ---
  {
    id: 'A001', severity: SEV.INFO, description: 'Acode system module import',
    nodeTypes: ['CallExpression'], detail: 'Modules loaded via internal acode.require injection layer.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require') {
        const moduleName = args.length > 0 ? (getStringValue(args[0]) || '[Dynamic Name]') : 'None';
        addFinding({
          line: path.node.loc?.start.line || 0,
          snippet: `acode.require('${moduleName}')`,
          dynamicDetail: `Plugin requested Acode platform module: "${moduleName}"`
        });
      }
    }
  },
  
  // --- NATIVE & SHELL (CRITICAL) ---
  {
    id: 'C001', severity: SEV.CRITICAL, description: 'Executor reference or shell execution detected',
    nodeTypes: ['Identifier'], detail: 'Any access via the Executor global can run arbitrary shell commands.',
    visitor(path, addFinding) {
      if (path.node.name === 'Executor' && !path.scope.hasBinding('Executor')) {
        if (path.parent.type === 'VariableDeclarator' && path.parent.id === path.node) return;
        if (path.parent.type === 'FunctionDeclaration' && path.parent.id === path.node) return;
        if ((path.parent.type === 'ObjectProperty' || path.parent.type === 'Property') && path.parent.key === path.node) return;
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'Executor' });
      }
    }
  },
  {
    id: 'C002', severity: SEV.CRITICAL, description: 'Direct Cordova native bridge call',
    nodeTypes: ['CallExpression'], detail: 'cordova.exec() calls native code directly.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'cordova') && callee.property.name === 'exec') {
        const service = args[2] ? (getStringValue(args[2]) || '[Dynamic]') : 'Unknown';
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `cordova.exec(..., "${service}", ...)` });
      }
    }
  },
  {
    id: 'C003', severity: SEV.CRITICAL, description: 'Cordova native plugin access',
    nodeTypes: ['MemberExpression'], detail: 'Access to cordova.plugins.*',
    visitor(path, addFinding) {
      if (path.node.property.name === 'plugins' && identifierMatches(path.node.object, 'cordova')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'cordova.plugins' });
      }
    }
  },
  {
    id: 'C004', severity: SEV.CRITICAL, description: 'window.cordova detected',
    nodeTypes: ['MemberExpression'], detail: 'Direct reference to Cordova on the window object.',
    visitor(path, addFinding) {
      if (identifierMatches(path.node.object, 'window') && (path.node.property.name === 'cordova' || getStringValue(path.node.property) === 'cordova')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'window.cordova' });
      }
    }
  },

  // --- FILE SYSTEM (HIGH) ---
  {
    id: 'H001', severity: SEV.HIGH, description: 'File-system module imported',
    nodeTypes: ['CallExpression'], detail: 'fs/fsOperation module gives full read/write access.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require') {
        const arg = getStringValue(args[0]);
        if (arg && /^(fs|fsOperation)$/.test(arg)) {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: `acode.require('${arg}')` });
        }
      }
    }
  },
  {
    id: 'H002', severity: SEV.HIGH, description: 'File read operation',
    nodeTypes: ['MemberExpression'], detail: 'Reads from the file system.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(readFile|readFileSync|read)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H003', severity: SEV.HIGH, description: 'File write operation',
    nodeTypes: ['MemberExpression'], detail: 'Writes data to the file system.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(writeFile|writeFileSync|write)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H004', severity: SEV.MEDIUM, description: 'Directory listing',
    nodeTypes: ['MemberExpression'], detail: 'Reads directory contents locally.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(lsDir|readDir|readdir)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H010', severity: SEV.HIGH, description: 'File deletion',
    nodeTypes: ['MemberExpression'], detail: 'Deletes local files.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(deleteFile|unlink|rm|remove)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H011', severity: SEV.MEDIUM, description: 'File move or copy',
    nodeTypes: ['MemberExpression'], detail: 'Moves or copies files across the system.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(copyTo|moveTo|renameFile|rename)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },

  // --- TERMINAL & INTENT ---
  {
    id: 'H005', severity: SEV.CRITICAL, description: 'Terminal module imported',
    nodeTypes: ['CallExpression'], detail: 'Grants access to run terminal commands.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require' && getStringValue(args[0]) === 'terminal') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: "acode.require('terminal')" });
      }
    }
  },
  {
    id: 'M008', severity: SEV.HIGH, description: 'Intent API accessed',
    nodeTypes: ['CallExpression'], detail: 'Grants access to fire Android intents.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require' && getStringValue(args[0]) === 'intent') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: "acode.require('intent')" });
      }
    }
  },

  // --- NETWORK ---
  {
    id: 'H007', severity: SEV.HIGH, description: 'Network fetch() call',
    nodeTypes: ['Identifier'], detail: 'Makes external HTTP requests.',
    visitor(path, addFinding) {
      if (path.node.name === 'fetch' && !path.scope.hasBinding('fetch')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'fetch(...)' });
      }
    }
  },
  {
    id: 'H008', severity: SEV.HIGH, description: 'XMLHttpRequest used',
    nodeTypes: ['NewExpression'], detail: 'Legacy network request method.',
    visitor(path, addFinding) {
      if (path.node.callee.name === 'XMLHttpRequest' && !path.scope.hasBinding('XMLHttpRequest')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'new XMLHttpRequest()' });
      }
    }
  },
  {
    id: 'H009', severity: SEV.HIGH, description: 'WebSocket communication',
    nodeTypes: ['NewExpression'], detail: 'Opens a persistent two-way network connection.',
    visitor(path, addFinding) {
      if (path.node.callee.name === 'WebSocket' && !path.scope.hasBinding('WebSocket')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'new WebSocket(...)' });
      }
    }
  },

  // --- STORAGE & CONSTANTS ---
  {
    id: 'M001', severity: SEV.MEDIUM, description: 'localStorage access',
    nodeTypes: ['Identifier'], detail: 'Accesses browser local storage.',
    visitor(path, addFinding) {
      if (path.node.name === 'localStorage' && !path.scope.hasBinding('localStorage')) addFinding({ line: path.node.loc?.start.line || 0, snippet: 'localStorage' });
    }
  },
  {
    id: 'M002', severity: SEV.MEDIUM, description: 'sessionStorage access',
    nodeTypes: ['Identifier'], detail: 'Accesses session storage.',
    visitor(path, addFinding) {
      if (path.node.name === 'sessionStorage' && !path.scope.hasBinding('sessionStorage')) addFinding({ line: path.node.loc?.start.line || 0, snippet: 'sessionStorage' });
    }
  },
  {
    id: 'M003', severity: SEV.MEDIUM, description: 'IndexedDB access',
    nodeTypes: ['Identifier'], detail: 'Accesses local IndexedDB.',
    visitor(path, addFinding) {
      if (path.node.name === 'indexedDB' && !path.scope.hasBinding('indexedDB')) addFinding({ line: path.node.loc?.start.line || 0, snippet: 'indexedDB' });
    }
  },
  {
    id: 'M009', severity: SEV.MEDIUM, description: 'Sensitive Path Constants',
    nodeTypes: ['Identifier'], detail: 'Accesses root-level storage or plugin directories.',
    visitor(path, addFinding) {
      if (/^(DATA_STORAGE|CACHE_STORAGE|PLUGIN_DIR)$/.test(path.node.name) && !path.scope.hasBinding(path.node.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: path.node.name });
      }
    }
  },

  // --- DYNAMIC CODE ---
  {
    id: 'L001', severity: SEV.HIGH, description: 'eval() call detected',
    nodeTypes: ['CallExpression'], detail: 'Executes strings dynamically as JavaScript code.',
    visitor(path, addFinding) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'eval' && !path.scope.hasBinding('eval')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'eval(...)' });
      }
    }
  },
  {
    id: 'L002', severity: SEV.HIGH, description: 'new Function() call',
    nodeTypes: ['NewExpression'], detail: 'Compiles dynamic strings into executable functions.',
    visitor(path, addFinding) {
      if (path.node.callee.name === 'Function' && !path.scope.hasBinding('Function')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'new Function(...)' });
      }
    }
  },
  {
    id: 'L005', severity: SEV.MEDIUM, description: 'Dynamic window property access',
    nodeTypes: ['MemberExpression'], detail: 'Accesses the window object dynamically (e.g., window[variable]).',
    visitor(path, addFinding) {
      if (identifierMatches(path.node.object, 'window') && path.node.computed && path.node.property.type !== 'StringLiteral' && path.node.property.type !== 'Literal') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'window[...]' });
      }
    }
  },
  {
    id: 'L006', severity: SEV.INFO, description: 'URL Encoding used',
    nodeTypes: ['Identifier'], detail: 'Often used to format exfiltrated data or parse remote strings.',
    visitor(path, addFinding) {
      if (/^(encodeURIComponent|escape|unescape|btoa|atob)$/.test(path.node.name) && !path.scope.hasBinding(path.node.name)) {
        if (path.node.name === 'atob') return; // Handled by S002
        addFinding({ line: path.node.loc?.start.line || 0, snippet: path.node.name });
      }
    }
  },

  // --- EDITOR & PLUGINS ---
  {
    id: 'M005', severity: SEV.INFO, description: 'editorManager read',
    nodeTypes: ['MemberExpression'], detail: 'Accesses the current editor or active file content.',
    visitor(path, addFinding) {
      if (identifierMatches(path.node.object, 'editorManager') && path.node.property.type === 'Identifier') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `editorManager.${path.node.property.name}` });
      }
    }
  },
  {
    id: 'M007', severity: SEV.HIGH, description: 'plugin API accessed',
    nodeTypes: ['CallExpression'], detail: 'Accesses Acode plugin API directly, potentially to install/remove plugins.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require' && getStringValue(args[0]) === 'plugin') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: "acode.require('plugin')" });
      }
    }
  },

  // --- SUSPICIOUS / MALICIOUS ---
  {
    id: 'S001', severity: SEV.CRITICAL, description: 'Data exfiltration endpoint',
    nodeTypes: ['StringLiteral', 'Literal'], detail: 'Known Discord webhook or public logging service.',
    visitor(path, addFinding) {
      const val = path.node.value;
      if (typeof val === 'string' && /(discord\.com\/api\/webhooks|pastebin\.com|webhook\.site|api\.ipify\.org)/i.test(val)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: val.substring(0, 40) + '...' });
      }
    }
  },
  {
    id: 'S002', severity: SEV.HIGH, description: 'Suspicious obfuscation',
    nodeTypes: ['CallExpression', 'ArrayExpression'], detail: 'Uses standard obfuscation markers like atob() or hex arrays.',
    visitor(path, addFinding) {
      if (path.isCallExpression() && path.node.callee.name === 'atob' && !path.scope.hasBinding('atob')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'atob(...)' });
      }
      if (path.isArrayExpression() && path.node.elements.length > 20) {
        const totalHex = path.node.elements.filter(el => el && el.type === 'StringLiteral' && /^0x[0-9a-f]+$/i.test(el.value)).length;
        if (totalHex / path.node.elements.length > 0.7) {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: '[Hex Obfuscated Array Mapping]' });
        }
      }
    }
  },
  {
    id: 'S003', severity: SEV.HIGH, description: 'Dynamic script container creation',
    nodeTypes: ['CallExpression'], detail: 'Dynamically injects a <script> tag to pull remote code.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && callee.property.name === 'createElement' && getStringValue(args[0])?.toLowerCase() === 'script') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'document.createElement("script")' });
      }
    }
  },
  {
    id: 'S004', severity: SEV.HIGH, description: 'Input monitoring hook',
    nodeTypes: ['CallExpression'], detail: 'Listens directly to inputs or keystrokes globally',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && callee.property.name === 'addEventListener' && /^(input|keyup|keydown|keypress)$/.test(getStringValue(args[0]))) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `addEventListener("${getStringValue(args[0])}", ...)` });
      }
    }
  }
];

const URL_PATTERN = /https?:\/\/[^\s"'`<>)\]},\\]{5,}/g;
const BABEL_PARSER_PLUGINS = [
  'asyncGenerators', 'bigInt', 'classProperties', 'classPrivateProperties',
  'classPrivateMethods', 'classStaticBlock', 'decorators-legacy', 'doExpressions',
  'dynamicImport', 'exportDefaultFrom', 'exportNamespaceFrom', 'functionBind',
  'functionSent', 'jsx', 'logicalAssignment', 'nullishCoalescingOperator',
  'numericSeparator', 'optionalCatchBinding', 'optionalChaining', 'privateIn',
  'throwExpressions', 'topLevelAwait', 'typescript'
];

function scanSource(filename, source) {
  const findings = [];
  const urlSet = new Set();

  for (const match of source.matchAll(URL_PATTERN)) {
    urlSet.add(match[0].replace(/[.,;)}\]]+$/, ''));
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: BABEL_PARSER_PLUGINS,
    });
  } catch (err) {
    return { findings, urls: [...urlSet] };
  }

  const lineSeen = new Map();
  const targetVisitor = {};

  for (const rule of RULES) {
    for (const type of rule.nodeTypes) {
      if (!targetVisitor[type]) {
        targetVisitor[type] = [];
      }
      targetVisitor[type].push(rule);
    }
  }

  const normalizedVisitor = {};
  for (const [nodeType, rulesArray] of Object.entries(targetVisitor)) {
    normalizedVisitor[nodeType] = function(path) {
      for (const rule of rulesArray) {
        rule.visitor(path, (findingData) => {
          const lookupKey = `${rule.id}-${findingData.line}-${findingData.snippet}`;
          if (lineSeen.has(lookupKey)) return;
          lineSeen.set(lookupKey, true);

          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            severityLabel: SEV_LABEL[rule.severity],
            description: rule.description,
            detail: findingData.dynamicDetail || rule.detail,
            file: filename,
            line: findingData.line,
            snippet: findingData.snippet,
          });
        });
      }
    };
  }

  traverse(ast, normalizedVisitor);
  return { findings, urls: [...urlSet] };
}

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

  const severityCounts = [0, 0, 0, 0, 0];
  for (const f of allFindings) severityCounts[f.severity]++;

  return {
    zipName,
    pluginId: pluginMeta.id || 'unknown',
    pluginName: pluginMeta.name || 'Unknown Plugin',
    pluginVersion: pluginMeta.version || '0.0.0',
    scannedFiles,
    findings: allFindings,
    urls: [...allUrls].sort(),
    severityCounts,
  };
}

const CAPABILITY_MAP = {
  C001: { group: 'shell',    label: 'Executor reference or shell execution detected' },
  C002: { group: 'native',   label: 'Direct Cordova native bridge call' },
  C003: { group: 'native',   label: 'Cordova native plugin access' },
  C004: { group: 'native',   label: 'window.cordova global reference' },
  H001: { group: 'fs',       label: 'File-system module imported' },
  H002: { group: 'fs',       label: 'File read operation' },
  H003: { group: 'fs',       label: 'File write operation' },
  H004: { group: 'fs',       label: 'Directory listing' },
  H005: { group: 'shell',    label: 'Terminal module imported' },
  H010: { group: 'fs',       label: 'File deletion' },
  H011: { group: 'fs',       label: 'File move or copy' },
  H007: { group: 'network',  label: 'HTTP fetch() call' },
  H008: { group: 'network',  label: 'XMLHttpRequest used' },
  H009: { group: 'network',  label: 'WebSocket communication' },
  M001: { group: 'storage',  label: 'localStorage access' },
  M002: { group: 'storage',  label: 'sessionStorage access' },
  M003: { group: 'storage',  label: 'IndexedDB access' },
  M005: { group: 'system',   label: 'editorManager API access' },
  M007: { group: 'system',   label: 'Plugin API access' },
  M008: { group: 'native',   label: 'Android Intent API accessed' },
  M009: { group: 'storage',  label: 'Sensitive Path Constants accessed' },
  L001: { group: 'dynamic',  label: 'eval() call detected' },
  L002: { group: 'dynamic',  label: 'new Function() call' },
  L005: { group: 'dynamic',  label: 'Dynamic window property access' },
  L006: { group: 'dynamic',  label: 'URL Encoding used' },
  S001: { group: 'sketchy',  label: 'Data exfiltration endpoint' },
  S002: { group: 'sketchy',  label: 'Suspicious string encoding/obfuscation' },
  S003: { group: 'sketchy',  label: 'Dynamic script execution container creation' },
  S004: { group: 'sketchy',  label: 'Input monitoring' },
  A001: { group: 'system',   label: 'Acode core module request' }
};

const GROUP_HEADING = {
  shell: '⚙️ Background Command Execution',
  native: '📱 Native Device Feature Access',
  fs: '📂 File Access',
  network: '🌐 Internet Access',
  storage: '💾 Local Data Storage',
  dynamic: '📦 Bundled or Dynamic Code',
  sketchy: '⚠️ Suspicious Activity',
  system: '🧩 Acode Platform Integration'
};

const GROUP_ORDER = ['shell', 'native', 'fs', 'network', 'storage', 'dynamic', 'sketchy', 'system'];

async function buildScanSummary(scanResult, zipLength) {
  const lines = [
    `## ${scanResult.pluginName}`,
    '',
    `- **Plugin ID:** \`${scanResult.pluginId}\``,
    `- **Version:** ${scanResult.pluginVersion}`,
    `- **Plugin size:** ${(zipLength / 1048576).toFixed(2)} MB`,
    `- **Scan date:** ${new Date().toISOString()}`,
    `- **Files scanned:** ${scanResult.scannedFiles.length}`,
    '',
    '---'
  ];

  if (scanResult.findings.length === 0) {
    lines.push('### ✅ No notable capabilities detected', '', 'This plugin does not use any sensitive device features.');
  } else {
    lines.push('### What this plugin does', '', 'This plugin uses the following device or editor capabilities.', '');

    const groupMap = {};
    
    for (const f of scanResult.findings) {
      const cap = CAPABILITY_MAP[f.ruleId];
      if (!cap) continue;

      if (!groupMap[cap.group]) groupMap[cap.group] = new Map();
      
      if (!groupMap[cap.group].has(cap.label)) {
        groupMap[cap.group].set(cap.label, []);
      }
      
      groupMap[cap.group].get(cap.label).push({
        detail: f.detail,
        file: f.file,
        line: f.line
      });
    }

    for (const group of GROUP_ORDER) {
      if (!groupMap[group]) continue;
      lines.push(`#### ${GROUP_HEADING[group]}`, '');
      for (const [label, occurrences] of groupMap[group]) {
        lines.push(`- **${label}**`);
        
        const uniqueDetails = [...new Set(occurrences.map(o => o.detail))];
        
        for (const detail of uniqueDetails) {
          lines.push(`  * ${detail}`);
          
          const locations = occurrences
            .filter(o => o.detail === detail)
            .map(o => `\`${o.file}:${o.line}\``)
            .join(', ');
            
          lines.push(`    * **Location:** ${locations}`);
        }
      }
      lines.push('');
    }

    lines.push('### Reviewer note', '');
    if (scanResult.severityCounts[SEV.CRITICAL] > 0) {
      lines.push('This plugin uses critical capabilities. Manual verification advised.');
    } else if (scanResult.severityCounts[SEV.HIGH] > 0) {
      lines.push('Standard capabilities like internet or asset reads noticed. Verify consistency.');
    } else {
      lines.push('Minor indicators typical of compiled or bundled production assets.');
    }
  }

  if (scanResult.urls.length > 0) {
    lines.push('', '### Services this plugin communicates with', '');
    for (const u of scanResult.urls) lines.push(`- \`${u}\``);
  }

  const markdown = lines.join('\n');

  const safeId = scanResult.pluginId.replace(/[^a-zA-Z0-9._-]/g, '_');
  const reportPath = join(process.cwd(), 'data', 'plugins', `${safeId}.scan-report.md`);
  
  await fs.mkdir(join(process.cwd(), 'data', 'plugins'), { recursive: true });
  await fs.writeFile(reportPath, markdown, 'utf-8');

  return markdown;
}

async function legacyScanner(zipBuffer, zipName) {
  const scanResult = await scanPlugin(zipBuffer, zipName);
  const zipLength = zipBuffer.length || zipBuffer.byteLength || 0;
  return buildScanSummary(scanResult, zipLength);
}

legacyScanner.scanPlugin = scanPlugin;
legacyScanner.buildScanSummary = buildScanSummary;

module.exports = legacyScanner;

// ─── CLI entry point ──────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const args = process.argv.slice(2);
    const json = args.includes('--json');
    const md = args.includes('--md');
    const files = args.filter((a) => !a.startsWith('--'));

    if (!files.length) {
      console.error('Usage: node pluginScanner.js <plugin.zip> [--json] [--md]');
      process.exit(1);
    }

    let exitCode = 0;

    for (const file of files) {
      try {
        const buffer = await fs.readFile(file);
        
        const result = await scanPlugin(buffer, basename(file));
        const markdown = await buildScanSummary(result, buffer.length);

        if (md) console.log(markdown);

        if (json) {
          const out = JSON.stringify(result, null, 2);
          console.log(out);
          await fs.writeFile(join(process.cwd(), 'scan-report.json'), out, 'utf8');
        }

        if (result.severityCounts[SEV.CRITICAL] > 0 && exitCode < 3) exitCode = 3;
        else if (result.severityCounts[SEV.HIGH] > 0 && exitCode < 2) exitCode = 2;
        else if ((result.severityCounts[SEV.LOW] > 0 || result.severityCounts[SEV.MEDIUM] > 0) && exitCode < 1) exitCode = 1;
      } catch (err) {
        console.error(`Failed to scan ${file}:`, err);
        if (exitCode < 1) exitCode = 1;
      }
    }

    process.exit(exitCode);
  })();
}