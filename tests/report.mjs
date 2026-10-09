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
  pass: '通过', fail: '失败', manual: '人工', error: '错误', skipped: '跳过', na: '不适用',
};
const STATUS_FILL = {
  pass: 'C6EFCE', fail: 'FFC7CE', manual: 'FFEB9C', error: 'F4B0B0',
  skipped: 'D9D9D9', na: 'F2F2F2',
};
const STATUS_FONT = {
  pass: '006100', fail: '9C0006', manual: '9C6500', error: '9C0006',
  skipped: '595959', na: '808080',
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
  const all = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    if (Array.isArray(j)) { for (const x of j) all.push(x); }
    else if (j.platform && j.results) { all.push(j); }
  }
  return all;
}

async function buildReport(platformFiles, outPath) {
  // platformFiles: [{ platform, results, meta }]
  const platforms = platformFiles.map((p) => p.platform);
  const cases = [];
  const index = {}; // caseId -> {name, criteria, type}
  const grid = {}; // caseId -> platform -> {status, detail}

  for (const pf of platformFiles) {
    for (const r of pf.results) {
      if (!index[r.caseId]) index[r.caseId] = { name: r.name, criteria: r.criteria, type: r.type };
      if (!grid[r.caseId]) grid[r.caseId] = {};
      grid[r.caseId][pf.platform] = { status: r.status, detail: r.detail };
      if (!cases.includes(r.caseId)) cases.push(r.caseId);
    }
  }

  const wb = new ExcelJS.Workbook();
  const kernel = platformFiles[0]?.meta?.kernel || '';
  const testVer = platformFiles[0]?.meta?.testVersion || {};
  wb.creator = 'HuaYoung E2E Verifier';
  wb.title = `验证报告 ${kernel || ''}`.trim();

  // ---- Sheet 1: 验证结果 ----
  const ws = wb.addWorksheet('验证结果');
  ws.columns = [
    { header: '验证项', key: 'name', width: 34 },
    { header: '验证标准', key: 'criteria', width: 60 },
    ...platforms.map((p) => ({ header: p, key: p, width: 16 })),
  ];
  const headerRow = ws.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
  headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

  for (const cid of cases) {
    const meta = index[cid];
    const row = ws.addRow({ name: meta.name, criteria: meta.criteria });
    row.getCell('criteria').alignment = { wrapText: true, vertical: 'top' };
    for (const p of platforms) {
      const cell = row.getCell(p);
      const v = grid[cid]?.[p];
      const status = v ? v.status : 'na';
      cell.value = STATUS_LABEL[status] || status;
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (STATUS_FILL[status] || 'FFFFFF') } };
      cell.font = { color: { argb: 'FF' + (STATUS_FONT[status] || '000000') }, bold: true };
      cell.alignment = { horizontal: 'center', vertical: 'center' };
    }
  }
  ws.views = [{ state: 'frozen', ySplit: 1 }];

  // ---- Sheet 2: 汇总 ----
  const ws2 = wb.addWorksheet('汇总');
  ws2.columns = [
    { header: '平台', key: 'platform', width: 18 },
    { header: '通过', key: 'pass', width: 10 },
    { header: '失败', key: 'fail', width: 10 },
    { header: '人工', key: 'manual', width: 10 },
    { header: '跳过', key: 'skipped', width: 10 },
    { header: '错误', key: 'error', width: 10 },
    { header: '不适用', key: 'na', width: 10 },
    { header: '通过率', key: 'rate', width: 12 },
  ];
  const h2 = ws2.getRow(1);
  h2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  h2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF305496' } };
  h2.alignment = { horizontal: 'center' };

  let tot = { pass: 0, fail: 0, manual: 0, skipped: 0, error: 0, na: 0 };
  for (const p of platforms) {
    const cnt = { pass: 0, fail: 0, manual: 0, skipped: 0, error: 0, na: 0 };
    for (const cid of cases) {
      const s = (grid[cid]?.[p]?.status) || 'na';
      cnt[s] = (cnt[s] || 0) + 1;
    }
    const decided = cnt.pass + cnt.fail;
    const rate = decided ? Math.round((cnt.pass / decided) * 100) + '%' : '—';
    ws2.addRow({ platform: p, ...cnt, rate });
    for (const k of ['pass', 'fail', 'manual', 'skipped', 'error', 'na']) tot[k] += cnt[k];
  }
  const tDecided = tot.pass + tot.fail;
  const tRate = tDecided ? Math.round((tot.pass / tDecided) * 100) + '%' : '—';
  const tRow = ws2.addRow({ platform: '合计', ...tot, rate: tRate });
  tRow.font = { bold: true };
  tRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E1F2' } };

  // ---- Sheet 3: 明细 ----
  const ws3 = wb.addWorksheet('明细');
  ws3.columns = [
    { header: '平台', key: 'platform', width: 18 },
    { header: '验证项', key: 'name', width: 34 },
    { header: '类型', key: 'type', width: 22 },
    { header: '状态', key: 'status', width: 12 },
    { header: '说明', key: 'detail', width: 70 },
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
        status: STATUS_LABEL[v.status] || v.status, detail: v.detail || '', criteria: meta.criteria || '',
      });
      const sc = row.getCell('status');
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + (STATUS_FILL[v.status] || 'FFFFFF') } };
      sc.font = { color: { argb: 'FF' + (STATUS_FONT[v.status] || '000000') }, bold: true };
      row.getCell('detail').alignment = { wrapText: true };
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
