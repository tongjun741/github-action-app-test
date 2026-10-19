#!/usr/bin/env node
// report.mjs — 将 results-*.json 合并生成 Excel 报告 report.xlsx
//
// 用法：
//   node tests/report.mjs --dir <下载目录> --out report.xlsx
//   node tests/report.mjs --inputs results-Windows_10.json results-Ubuntu_22.json --out report.xlsx
//
// 输出三张表：
//   1) 验证结果  —— 用例 × 平台 状态网格（含 验证标准 列）
//   2) 汇总      —— 各平台 通过/失败/人工/跳过/错误 计数与通过率
//   3) 明细      —— 每条 (用例,平台) 一行，含 detail

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const STATUS_LABEL = {
  // 2026-10-13 用户要求对齐原表用词：成功 / 不通过 / 人工确认 / 测试网站不可用 / 忽略
  pass: '成功', fail: '不通过', manual: '人工确认', error: '异常', skipped: '跳过', na: '不适用', ignored: '忽略（按用户要求）', site_unavailable: '网站不可用，忽略',
};
const STATUS_FILL = {
  pass: 'C6EFCE', fail: 'FFC7CE', manual: 'FFEB9C', error: 'F4B0B0',
  skipped: 'D9D9D9', na: 'F2F2F2', ignored: 'E7E6E6', site_unavailable: 'E7E6E6',
};
const STATUS_FONT = {
  pass: '006100', fail: '9C0006', manual: '9C6500', error: '9C0006',
  skipped: '595959', na: '808080', ignored: '808080', site_unavailable: '808080',
};

function parseArgs(argv) {
  const out = { inputs: [], dir: null, out: 'report.xlsx' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--inputs') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.inputs.push(argv[++i]); }
    else if (a === '--dir') out.dir = argv[++i];
    else if (a === '--out') out.out = argv[++i];
  }
  return out;
}

function loadResults(args) {
  const files = [];
  if (args.dir) {
    for (const f of readdirSync(args.dir)) {
      if (/^results-.*\.json$/.test(f)) files.push(join(args.dir, f));
    }
  }
  for (const f of args.inputs) if (existsSync(f)) files.push(f);
  const norm = []; // [{ platform, results, meta }]
  for (const f of files) {
    let j;
    try { j = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { console.warn(`[report] 跳过无法解析的文件: ${f}`); continue; }
    // 平台归属判定：仅接受「明确且非占位」的 platform，否则视为陈旧碎片/无归属，跳过（防幽灵列/行）
    const platOf = (o) => {
      const p = o && typeof o.platform === 'string' ? o.platform.trim() : '';
      return (p && !/^(none|null|undefined)$/i.test(p)) ? p : null;
    };
    if (Array.isArray(j)) {
      // 数组形态：独立脚本常把 platform 写在每条结果上（如 google-translate.cjs）——按 platform 分组
      const byP = new Map();
      for (const x of j) {
        const p = x && x.platform ? x.platform : null;
        if (!p) continue; // 无平台归属的碎片结果跳过
        if (!byP.has(p)) byP.set(p, []);
        byP.get(p).push(x);
      }
      for (const [p, rs] of byP) norm.push({ platform: p, results: rs });
    } else if (j && Array.isArray(j.results)) {
      const p = platOf(j);
      if (!p) { console.warn(`[report] 跳过无 platform 的文件: ${f}`); continue; }
      norm.push({ platform: p, results: j.results, meta: j.meta });
    } else {
      console.warn(`[report] 跳过无法识别结构的文件: ${f}`);
    }
  }
  // 同名 platform 的多个文件（如 results-RPA_Flow.json 与 results-Windows_10.json 同为
  // platform="Windows 10"）合并为一个平台条目——否则矩阵会生成重复列。
  const byPlatform = [];
  const idx = new Map();
  for (const pf of norm) {
    if (idx.has(pf.platform)) {
      const t = byPlatform[idx.get(pf.platform)];
      t.results.push(...pf.results);
      if (!t.meta || !t.meta.kernel) t.meta = pf.meta || t.meta;
    } else {
      idx.set(pf.platform, byPlatform.length);
      byPlatform.push({ platform: pf.platform, results: [...pf.results], meta: pf.meta });
    }
  }
  return byPlatform;
}

async function buildReport(platformFiles, outPath) {
  // platformFiles: [{ platform, results, meta }]
  // 2026-10-14 用户纠偏：平台列序、用例行序必须与原表（生产环境-12.9-148内核.xlsx）完全一致，
  // 不随 results 文件出现顺序漂移。
  // 原表平台列序：Windows 10 | macOS arm64 | macOS x64 | Ubuntu 22 | Windows 7（仅关注是否能打开会话）
  const PLATFORM_ORDER = ['Windows 10', 'macOS arm64', 'macOS x64', 'Ubuntu 22', 'Windows 7'];
  // 原表用例行序（20 行，R3-R22）：caseId 按此排序；矩阵里新增/未知 caseId 追加尾部（不丢失）
  const CASE_ORDER = [
    'open_session', 'kernel_version', 'pixelscan', 'iphey', 'browserleaks_ip', 'whoer',
    'ipbinding', 'nopecha', 'fingerprint_scan', 'devtools_detector', 'plugins_load',
    'password_save', 'password_autofill', 'cookie_sync', 'localstorage_sync', 'indexdb_sync',
    'history_sync', 'bookmark_sync', 'rpa_flow', 'google_translate',
  ];
  // 2026-10-16：「第二台设备」是 cookie-sync 的合法平台（S1 不展示、汇总/明细保留），
  // 不做全局过滤；重复行的真根因在 loadResults 已修（空 platform 的陈旧文件被丢弃）。
  const platformsRaw = platformFiles.map((p) => p.platform);
  const platforms = [
    ...PLATFORM_ORDER.filter((p) => platformsRaw.includes(p)),
    ...platformsRaw.filter((p) => !PLATFORM_ORDER.includes(p)),
  ];
  const cases = [];
  const index = {}; // caseId -> {name, criteria, type}
  const grid = {}; // caseId -> platform -> {status, detail}

  for (const pf of platformFiles) {
    for (const r of pf.results) {
      if (!index[r.caseId]) index[r.caseId] = { name: r.name, criteria: r.criteria, type: r.type };
      if (!grid[r.caseId]) grid[r.caseId] = {};
      // 2026-10-13：同一 caseId 可能来自多个文件（如 RPA/翻译 独立步骤产物 vs 平台主结果占位）。
      // 占位（detail 含「占位」或 status=skipped 且无实质信息）不覆盖已有真结果；真结果覆盖占位。
      const prev = grid[r.caseId][pf.platform];
      const isNewPlaceholder = /占位/.test(String(r.detail || '')) || (r.status === 'skipped' && !String(r.detail || '').trim());
      const isPrevPlaceholder = prev && (/占位/.test(String(prev.detail || '')) || (prev.status === 'skipped' && !String(prev.detail || '').trim()));
      if (!prev || isPrevPlaceholder || (!isNewPlaceholder && prev.status !== 'pass' && prev.status !== 'fail')) {
        grid[r.caseId][pf.platform] = { status: r.status, detail: r.detail, screenshot: r.screenshot || (prev && prev.screenshot), procLog: r.procLog || (prev && prev.procLog) || '' };
      } else if (prev && r.screenshot && !prev.screenshot) {
        prev.screenshot = r.screenshot; // 真结果已保留但缺截图——补
      } else if (prev && r.procLog && !prev.procLog) {
        prev.procLog = r.procLog; // 过程日志同理——补
      }
      if (!cases.includes(r.caseId)) cases.push(r.caseId);
    }
  }
  // 2026-10-14：按原表固定行序排序——已知 caseId 按 CASE_ORDER，未知追加尾部
  cases.sort((a, b) => {
    const ia = CASE_ORDER.indexOf(a), ib = CASE_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return 0;
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });

  const wb = new ExcelJS.Workbook();
  const kernel = platformFiles[0]?.meta?.kernel || '';
  const testVer = platformFiles[0]?.meta?.testVersion || {};
  const teamId = platformFiles[0]?.meta?.teamId || '';
  const cloneName = platformFiles[0]?.meta?.cloneName || '';
  const cloneCdpPort = platformFiles[0]?.meta?.cloneCdpPort || 9221;
  wb.creator = 'HuaYoung E2E Verifier';
  wb.title = `验证报告 ${kernel || ''} ${teamId ? `[team ${teamId} / ${cloneName} 分身]` : ''}`.trim();

  // ---- Sheet 1: 验证结果（用户原表格式：平台列在前 + 验证标准 + 示例；2026-10-13 用户要求）----
  // 原表结构：R1 = 空|Win10|mac arm64|mac x64|Ubuntu22|Win7|验证标准|示例；R2 = 测试版本行
  const ws = wb.addWorksheet('验证结果');
  // S1 不展示「第二台设备」（它只承载 cookie_sync 一项，原表无此列；结果仍在汇总/明细）
  const S1_PLATFORMS = platforms.filter((p) => p !== 'Windows 10 (第二台设备)');
  // 2026-10-14：A1 留空对齐原表（原表 R1 = 空 | 平台列... | 验证标准 | 示例）
  const ws1Header = ['', ...S1_PLATFORMS.map((p) => (p === 'Windows 7' ? 'Windows 7（仅关注是否能打开会话）' : p)), '验证标准', '示例'];
  ws.columns = [
    { header: ws1Header[0], key: 'name', width: 34 },
    ...S1_PLATFORMS.map((p) => ({ header: p === 'Windows 7' ? 'Windows 7（仅关注是否能打开会话）' : p, key: p, width: 22 })),
    { header: '验证标准', key: 'criteria', width: 42 },
    { header: '示例', key: 'demo', width: 10 },
  ];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDEBF7' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  headerRow.height = 30;

  // 测试版本行（原表 R2）：从 meta.testVersion 取；缺省给固定生产版本号
  const FIXED_VER = { 'Windows 10': '12.9.1043', 'macOS arm64': '12.9.950', 'macOS x64': '12.9.950', 'Ubuntu 22': '12.9.912', 'Windows 7': '12.9.906' };
  const verRow = ws.addRow({ name: '测试版本' });
  verRow.getCell('name').font = { bold: true };
  for (const p of S1_PLATFORMS) {
    const v = (testVer && testVer[p]) || FIXED_VER[p] || '';
    verRow.getCell(p).value = v ? `版本：${v}` : '';
  }
  verRow.commit();

  for (const cid of cases) {
    const meta = index[cid];
    const row = ws.addRow({ name: meta.name, criteria: meta.criteria || '' });
    row.getCell('name').font = { bold: true };
    row.getCell('name').alignment = { wrapText: true, vertical: 'center' };
    row.getCell('criteria').alignment = { wrapText: true, vertical: 'center' };
    row.getCell('criteria').font = { size: 9 };
    for (const p of S1_PLATFORMS) {
      const cell = row.getCell(p);
      const v = grid[cid]?.[p];
      const status = v ? v.status : 'na';
      const label = STATUS_LABEL[status] || status;
      // 状态文案（原表风格：成功/不通过/测试网站不可用/人工确认…），附截图文件名
      const shot = v && v.screenshot ? `\n[截图] ${v.screenshot}` : '';
      cell.value = label + shot;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (STATUS_FILL[status] || 'FFFFFF') } };
      cell.font = { bold: !shot, size: shot ? 9 : 11 };
      cell.alignment = { horizontal: 'center', vertical: 'center', wrapText: true };
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 2 }];

  // ---- Sheet 2: 汇总 ----
  const ws2 = wb.addWorksheet('汇总');
  ws2.columns = [
    { header: '平台', key: 'platform', width: 18 },
    { header: '通过', key: 'pass', width: 10 },
    { header: '失败', key: 'fail', width: 10 },
    { header: '人工', key: 'manual', width: 10 },
    { header: '跳过', key: 'skipped', width: 10 },
    { header: '忽略', key: 'ignored', width: 10 },
    { header: '错误', key: 'error', width: 10 },
    { header: '不适用', key: 'na', width: 10 },
    { header: '通过率', key: 'rate', width: 12 },
  ];
  const h2 = ws2.getRow(1);
  h2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
  h2.alignment = { horizontal: 'center' };

  let tot = { pass: 0, fail: 0, manual: 0, skipped: 0, error: 0, na: 0, ignored: 0 };
  for (const p of platforms) {
    const cnt = { pass: 0, fail: 0, manual: 0, skipped: 0, error: 0, na: 0, ignored: 0 };
    for (const cid of cases) {
      const raw = (grid[cid]?.[p]?.status) || 'na';
      const s = raw === 'site_unavailable' ? 'ignored' : raw; // 站点不可用并入「忽略」列
      cnt[s] = (cnt[s] || 0) + 1;
    }
    const decided = cnt.pass + cnt.fail;
    const rate = decided ? Math.round((cnt.pass / decided) * 100) + '%' : '—';
    ws2.addRow({ platform: p, ...cnt, rate });
    for (const k of ['pass', 'fail', 'manual', 'skipped', 'error', 'na', 'ignored']) tot[k] += cnt[k];
  }
  const tDecided = tot.pass + tot.fail;
  const tRate = tDecided ? Math.round((tot.pass / tDecided) * 100) + '%' : '—';
  const tRow = ws2.addRow({ platform: '合计', ...tot, rate: tRate });
  tRow.font = { bold: true };
  tRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

  // ---- Sheet 3: 明细（含截图文件名列）----
  const ws3 = wb.addWorksheet('明细');
  ws3.columns = [
    { header: '平台', key: 'platform', width: 18 },
    { header: '验证项', key: 'name', width: 34 },
    { header: '类型', key: 'type', width: 22 },
    { header: '状态', key: 'status', width: 12 },
    { header: '说明', key: 'detail', width: 70 },
    { header: '截图文件', key: 'screenshot', width: 30 },
    { header: '过程日志', key: 'procLog', width: 80 },
    { header: '验证标准', key: 'criteria', width: 60 },
  ];
  const h3 = ws3.getRow(1);
  h3.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h3.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
  for (const p of platforms) {
    for (const cid of cases) {
      const meta = index[cid];
      const v = grid[cid]?.[p] || { status: 'na', detail: '' };
      const row = ws3.addRow({
        platform: p, name: meta.name, type: meta.type,
        status: STATUS_LABEL[v.status] || v.status, detail: v.detail || '',
        screenshot: v.screenshot || '', procLog: v.procLog || '', criteria: meta.criteria || '',
      });
      const sc = row.getCell('status');
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (STATUS_FILL[v.status] || 'FFFFFF') } };
      sc.font = { color: { argb: 'FF' + (STATUS_FONT[v.status] || '000000') }, bold: true };
      row.getCell('detail').alignment = { wrapText: true };
      row.getCell('procLog').alignment = { wrapText: true, vertical: 'top' };
      row.getCell('criteria').alignment = { wrapText: true };
    }
  }
  ws3.views = [{ state: 'frozen', ySplit: 1 }];

  await wb.xlsx.writeFile(outPath);
  console.log(`[report] 已生成报告: ${outPath} （用例 ${cases.length} 项 × 平台 ${platforms.length} 个）`);
}

async function main() {
  const args = parseArgs(process.argv);
  const files = loadResults(args);
  if (!files.length) {
    console.error('[report] 未找到任何 results-*.json，请检查 --dir / --inputs');
    process.exit(1);
  }
  await buildReport(files, args.out);
}

main().catch((e) => {
  console.error('[report] 失败:', e);
  process.exit(1);
});
