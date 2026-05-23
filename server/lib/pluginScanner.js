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
    return identifierMatches(node.property, name) || identifierMatches(node.object, name);
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
  {
    id: 'A001',
    severity: SEV.INFO,
    description: 'Acode system module import',
    detail: 'Modules loaded via internal acode.require injection layer.',
    nodeTypes: ['CallExpression'],
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require') {
        const moduleName = args.length > 0 ? (getStringValue(args[0]) || '[Dynamic Name]') : 'None';
        addFinding({
          line: path.node.loc?.start.line || 0,
          snippet: `acode.require(${args.length > 0 ? '...' : ''})`,
          dynamicDetail: `Plugin requested Acode platform module: "${moduleName}"`
        });
      }
    }
  },
  {
    id: 'A002',
    severity: SEV.INFO,
    description: 'editorManager API access',
    detail: 'Accesses the Acode editorManager to manipulate the editor state.',
    nodeTypes: ['Identifier'],
    visitor(path, addFinding) {
      if (path.node.name === 'editorManager' && !path.scope.hasBinding('editorManager')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'editorManager' });
      }
    }
  },
  {
    id: 'S001',
    severity: SEV.CRITICAL,
    description: 'Data exfiltration or telemetry endpoint detected',
    nodeTypes: ['StringLiteral', 'Literal'],
    detail: 'Known Discord webhook, Pastebin, or public IP logging service used for potential data harvesting.',
    visitor(path, addFinding) {
      const val = path.node.value;
      if (typeof val === 'string' && /(discord\.com\/api\/webhooks|pastebin\.com|webhook\.site|api\.ipify\.org)/i.test(val)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: val.substring(0, 40) + '...' });
      }
    }
  },
  {
    id: 'S002',
    severity: SEV.HIGH,
    description: 'Suspicious string decoding or obfuscation pattern',
    nodeTypes: ['CallExpression', 'ArrayExpression'],
    detail: 'Uses standard obfuscation markers like atob() decoding or massive hex arrays.',
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
    id: 'S003',
    severity: SEV.HIGH,
    description: 'Dynamic script execution container creation',
    nodeTypes: ['CallExpression'],
    detail: 'Dynamically injects a <script> tag into the document context to pull remote code.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && callee.property.name === 'createElement' && args.length > 0) {
        const argVal = getStringValue(args[0]);
        if (argVal && argVal.toLowerCase() === 'script') {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: 'document.createElement("script")' });
        }
      }
    }
  },
  {
    id: 'S004',
    severity: SEV.HIGH,
    description: 'Input monitoring hook',
    nodeTypes: ['CallExpression'],
    detail: 'Listens directly to inputs or keystrokes globally',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && callee.property.name === 'addEventListener' && args.length > 0) {
        const eventVal = getStringValue(args[0]);
        if (eventVal && /^(input|keyup|keydown|keypress)$/.test(eventVal)) {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: `addEventListener("${eventVal}", ...)` });
        }
      }
    }
  },
  {
    id: 'C001',
    severity: SEV.CRITICAL,
    description: 'Executor reference or shell execution detected',
    nodeTypes: ['Identifier'],
    detail: 'Any access or execution via the Executor global can run arbitrary shell commands without user confirmation.',
    visitor(path, addFinding) {
      if (path.node.name === 'Executor') {
        if (path.parent.type === 'VariableDeclarator' && path.parent.id === path.node) return;
        if (path.parent.type === 'FunctionDeclaration' && path.parent.id === path.node) return;
        if (
          (path.parent.type === 'ObjectProperty' ||
          path.parent.type === 'Property') &&
          path.parent.key === path.node
        ){
          return
        }
        
        let snippet = 'Executor';
        if (path.parent.type === 'MemberExpression' && path.parent.object === path.node) {
          const fullPath = getFullMemberPath(path.parent);
          snippet = fullPath.length > 0 ? fullPath.join('.') : 'Executor.*';
        }

        addFinding({ line: path.node.loc?.start.line || 0, snippet: snippet });
      }
    }
  },
  {
    id: 'C002',
    severity: SEV.CRITICAL,
    description: 'Direct Cordova native bridge call',
    nodeTypes: ['CallExpression'],
    detail: 'cordova.exec() calls native Android/iOS code directly, bypassing web-layer restrictions.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'cordova') && callee.property.name === 'exec') {
        const service = args[2] ? (getStringValue(args[2]) || '[Dynamic]') : 'Unknown';
        const action = args[3] ? (getStringValue(args[3]) || '[Dynamic]') : 'Unknown';
        
        addFinding({ 
          line: path.node.loc?.start.line || 0, 
          snippet: `cordova.exec(..., "${service}", "${action}", ...)`,
          dynamicDetail: `Direct native bridge call targeting Cordova service: "${service}" (Action: "${action}").`
        });
      }
    }
  },
  {
    id: 'C003',
    severity: SEV.CRITICAL,
    description: 'Cordova native plugin access',
    nodeTypes: ['MemberExpression'],
    detail: 'Access to cordova.plugins.* grants direct use of native device plugins.',
    visitor(path, addFinding) {
      const { object, property } = path.node;
      if (object.type === 'MemberExpression' && object.property.name === 'plugins' && identifierMatches(object.object, 'cordova')) {
        const fullPath = getFullMemberPath(path.node);
        const targetPlugin = property.type === 'Identifier' && !path.node.computed ? property.name : 'Unknown';
        const displayPath = fullPath.length > 0 ? fullPath.join('.') : `cordova.plugins.${targetPlugin}`;

        if (path.parent.type === 'MemberExpression' && path.parent.object === path.node) return;

        addFinding({ 
          line: path.node.loc?.start.line || 0, 
          snippet: displayPath,
          dynamicDetail: `Accesses native plugin surface via: ${displayPath}`
        });
      }
    }
  },
  {
    id: 'C004',
    severity: SEV.CRITICAL,
    description: 'window.cordova detected',
    nodeTypes: ['MemberExpression'],
    detail: 'Direct reference to the Cordova global on the window object.',
    visitor(path, addFinding) {
      if (!path.scope.hasBinding('window')) {
        const isDotNotation =
          !path.node.computed &&
          identifierMatches(path.node.object, 'window') &&
          path.node.property.type === 'Identifier' &&
          path.node.property.name === 'cordova';
        const isBracketNotation = identifierMatches(path.node.object, 'window') && path.node.computed && getStringValue(path.node.property) === 'cordova';
        
        if (isDotNotation || isBracketNotation) {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: isDotNotation ? 'window.cordova' : "window['cordova']" });
        }
      }
    }
  },
  {
    id: 'H001',
    severity: SEV.HIGH,
    description: 'File-system module imported',
    nodeTypes: ['CallExpression'],
    detail: 'The fs/fsOperation module gives full read/write/delete access to system paths.',
    visitor(path, addFinding) {
      const { callee, arguments: args } = path.node;
      if (callee.type === 'MemberExpression' && identifierMatches(callee.object, 'acode') && callee.property.name === 'require' && args.length > 0) {
        const arg = getStringValue(args[0]);
        if (arg && /^(fs|fsOperation)$/.test(arg)) {
          addFinding({ line: path.node.loc?.start.line || 0, snippet: `acode.require('${arg}')` });
        }
      }
    }
  },
  {
    id: 'H002',
    severity: SEV.HIGH,
    description: 'File read operation',
    nodeTypes: ['MemberExpression'],
    detail: 'Reads from the file system locally.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(readFile|readFileSync|read)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H003',
    severity: SEV.HIGH,
    description: 'File write operation',
    nodeTypes: ['MemberExpression'],
    detail: 'Writes or modifies data on the file system.',
    visitor(path, addFinding) {
      if (path.node.property.type === 'Identifier' && /^(writeFile|writeFileSync|write)$/.test(path.node.property.name)) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: `.${path.node.property.name}(...)` });
      }
    }
  },
  {
    id: 'H007',
    severity: SEV.HIGH,
    description: 'Network communication',
    nodeTypes: ['CallExpression', 'NewExpression'],
    detail: 'Makes external network requests via fetch, XHR, or WebSocket.',
    visitor(path, addFinding) {
      const callee = path.node.callee;
      if (callee.type === 'Identifier') {
        if (callee.name === 'fetch') addFinding({ line: path.node.loc?.start.line || 0, snippet: 'fetch(...)' });
        if (callee.name === 'XMLHttpRequest' && path.isNewExpression()) addFinding({ line: path.node.loc?.start.line || 0, snippet: 'new XMLHttpRequest()' });
        if (callee.name === 'WebSocket' && path.isNewExpression()) addFinding({ line: path.node.loc?.start.line || 0, snippet: 'new WebSocket(...)' });
      }
    }
  },
  {
    id: 'M001',
    severity: SEV.MEDIUM,
    description: 'localStorage access',
    nodeTypes: ['Identifier'],
    detail: 'Accesses browser local storage.',
    visitor(path, addFinding) {
      if (path.node.name === 'localStorage' && !path.scope.hasBinding('localStorage')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'localStorage' });
      }
    }
  },
  {
    id: 'L001',
    severity: SEV.HIGH,
    description: 'eval() call detected',
    nodeTypes: ['CallExpression'],
    detail: 'Executes strings dynamically as JavaScript code.',
    visitor(path, addFinding) {
      if (path.node.callee.type === 'Identifier' && path.node.callee.name === 'eval' && !path.scope.hasBinding('eval')) {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'eval(...)' });
      }
    }
  },
  {
    id: 'L005',
    severity: SEV.MEDIUM,
    description: 'Dynamic window property access',
    nodeTypes: ['MemberExpression'],
    detail: 'Accesses the window object dynamically (e.g., window[variable]).',
    visitor(path, addFinding) {
      if (identifierMatches(path.node.object, 'window') && path.node.computed && path.node.property.type !== 'StringLiteral' && path.node.property.type !== 'Literal') {
        addFinding({ line: path.node.loc?.start.line || 0, snippet: 'window[...]' });
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
  H007: { group: 'network',  label: 'HTTP fetch() call' },
  M001: { group: 'storage',  label: 'localStorage access' },
  L001: { group: 'dynamic',  label: 'eval() call detected' },
  L005: { group: 'dynamic',  label: 'Dynamic window property access' },
  S001: { group: 'sketchy',  label: 'Data exfiltration endpoint' },
  S002: { group: 'sketchy',  label: 'Suspicious string encoding/obfuscation' },
  S003: { group: 'sketchy',  label: 'Dynamic script execution container creation' },
  S004: { group: 'sketchy',  label: 'Input monitoring' },
  A001: { group: 'system',   label: 'Acode core module request' },
  A002: { group: 'system',   label: 'editorManager API access' }
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

/**
 * Backward Compatibility Wrapper
 * Allows server/apis/plugin.js to call this as a normal async function (zipBuffer, zipName)
 * while still attaching the methods for the CLI to use.
 */
async function legacyScanner(zipBuffer, zipName) {
  const scanResult = await scanPlugin(zipBuffer, zipName);
  const zipLength = zipBuffer.length || zipBuffer.byteLength || 0;
  return buildScanSummary(scanResult, zipLength);
}

// Attach the specific methods to the default export so the new CLI approach still works
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