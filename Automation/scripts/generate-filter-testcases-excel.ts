import ExcelJS from 'exceljs';
import * as path from 'path';

/**
 * Generates a standalone Excel workbook for the Audit Workspace & Internal
 * Auditor "Filter per sub-tab" acceptance-criteria test cases.
 *
 * Output: tests/Filter_TestCases.xlsx
 *
 * Sheets:
 *  1. Filter - Test Cases   — human-readable steps/expected (detailed)
 *  2. Regression            — shouldRun()-compatible rows (excel-filter.ts loader)
 *  3. UI Elements           — selector reference
 *  4. Open Questions        — items to confirm before execution
 *
 * Grounding (apps/web, verified in 07-tg7-workspace-filters.spec.ts):
 *  - Filter trigger : [data-testid="workspace-filter-btn"] (Controls sub-tab only)
 *  - Active marker  : [data-testid="workspace-filter-badge"]
 *  - Filter drawer  : role=dialog, title "Filters"; legend "Submission status";
 *                     footer "Clear all" + "Apply filter"
 *  - Control rows   : #tabpanel-ws a[href*="/control/"]
 */

const HEADER_FILL: Partial<ExcelJS.Fill> = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF4472C4' },
};

function styleHeader(ws: ExcelJS.Worksheet): void {
  ws.getRow(1).fill = HEADER_FILL as ExcelJS.Fill;
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).alignment = { vertical: 'middle' };
}

interface DetailRow {
  sno: number;
  suite: string;
  scenario: string;
  tc: string;
  testCase: string;
  steps: string;
  expected: string;
  subTab: string;
}

// ── Sheet 1 data: detailed, human-readable test cases ───────────────────────
const detailRows: DetailRow[] = [
  // SUITE A — Audit Workspace Controls sub-tab filters
  {
    sno: 1, suite: 'A: Workspace Controls', scenario: 'A1', tc: 'TC-1',
    testCase: 'Filter applies and shows marker on "All controls"',
    subTab: 'All controls',
    steps: '1. Login as admin → open SOC 2 Type 2 audit → Audit Workspace → Controls → All controls\n2. Click filter button [workspace-filter-btn]\n3. Select a "Submission status" (e.g. In progress)\n4. Click "Apply filter"\n5. Observe the filter button',
    expected: 'Drawer (dialog "Filters") opens; list filters to selected status; drawer closes on Apply; [workspace-filter-badge] shows "1" (marker active).',
  },
  {
    sno: 2, suite: 'A: Workspace Controls', scenario: 'A2', tc: 'TC-2',
    testCase: 'Filter value persists only in "All controls"',
    subTab: 'All controls ↔ Controls I own',
    steps: '1. On "All controls" apply In-progress filter (badge=1)\n2. Click "Controls I own" sub-tab\n3. Open filter drawer on "Controls I own"\n4. Close drawer; return to "All controls"',
    expected: 'On "Controls I own" the filter RESETS (no badge, no pre-checked status). On returning to "All controls" the badge is still "1" and list stays filtered (value persisted).',
  },
  {
    sno: 3, suite: 'A: Workspace Controls', scenario: 'A3', tc: 'TC-3',
    testCase: 'Independent filter per sub-tab (round trip across all six)',
    subTab: 'All six Controls sub-tabs',
    steps: '1. All controls: apply status In progress → Apply\n2. Controls I own: apply status Submitted → Apply\n3. Open Needs updates → drawer\n4. Visit Due today / Due this week / Due this month\n5. Return to All controls\n6. Return to Controls I own',
    expected: 'Each sub-tab keeps its own filter; no cross-contamination. All controls retains In progress (badge=1); Controls I own retains Submitted (badge=1); Needs updates/Due tabs show no inherited filter.',
  },
  {
    sno: 4, suite: 'A: Workspace Controls', scenario: 'A4', tc: 'TC-4',
    testCase: 'Filter marker NOT shown when no filter on a sub-tab',
    subTab: 'Needs updates',
    steps: '1. Open "Needs updates" (no filter applied)\n2. Open drawer, apply nothing, close/Cancel',
    expected: '[workspace-filter-badge] count = 0 (no marker) before and after opening the drawer without applying.',
  },
  {
    sno: 5, suite: 'A: Workspace Controls', scenario: 'A5', tc: 'TC-5',
    testCase: 'Owner & Function hidden on restricted sub-tabs',
    subTab: 'Controls I own / Needs updates / Due today / Due this week / Due this month',
    steps: '1. On each restricted sub-tab open the filter drawer\n2. Look for "Owner" field\n3. Look for "Function" field\n4. Confirm other filters (Submission status, etc.) still present',
    expected: 'Drawer does NOT show "Owner" and does NOT show "Function" on any of the 5 restricted sub-tabs. All other existing filter options remain visible.',
  },
  {
    sno: 6, suite: 'A: Workspace Controls', scenario: 'A6', tc: 'TC-6',
    testCase: 'Owner & Function present on "All controls"',
    subTab: 'All controls',
    steps: '1. On "All controls" open filter drawer\n2. Verify "Owner" field shown\n3. Verify "Function" field shown\n4. Apply an Owner value → Apply',
    expected: '"Owner" and "Function" fields ARE shown on All controls; applying an Owner value filters the list and updates the badge.',
  },
  {
    sno: 7, suite: 'A: Workspace Controls', scenario: 'A7', tc: 'TC-7',
    testCase: 'Drawer keeps all existing filter options across sub-tabs',
    subTab: 'All Controls sub-tabs',
    steps: '1. Open drawer on "All controls"; note full option list (baseline)\n2. Open drawer on each restricted sub-tab; compare',
    expected: 'Restricted sub-tabs show the same option set MINUS Owner and Function; no other option is removed or added.',
  },
  {
    sno: 8, suite: 'A: Workspace Controls', scenario: 'A8', tc: 'TC-8',
    testCase: 'Persistence across control open/back (regression)',
    subTab: 'All controls',
    steps: '1. On "All controls" apply a status filter → badge=1\n2. Open first control row [#tabpanel-ws a[href*="/control/"]]\n3. Navigate back',
    expected: 'After navigating back the badge is still "1" and the filter is retained.',
  },

  // SUITE B — Internal Auditor sub-tab filters
  {
    sno: 9, suite: 'B: Internal Auditor', scenario: 'B1', tc: 'TC-9',
    testCase: 'Filter marker on "Ready for Review"',
    subTab: 'Ready for Review',
    steps: '1. Login as Internal Auditor → open audit → Internal Auditor tab → Ready for Review\n2. Open filter drawer; apply a status → Apply\n3. Observe the filter button',
    expected: 'Drawer closes; list filtered; marker/badge shown (filter active on Ready for Review).',
  },
  {
    sno: 10, suite: 'B: Internal Auditor', scenario: 'B2', tc: 'TC-10',
    testCase: 'Filter persists only in "Ready for Review"',
    subTab: 'Ready for Review ↔ Needs updated',
    steps: '1. Ready for Review filter applied (badge shown)\n2. Move to "Needs updated" sub-tab\n3. Open drawer on "Needs updated"\n4. Return to "Ready for Review"',
    expected: 'On "Needs updated" the filter RESETS (no badge, no inherited selection). Returning to "Ready for Review" the previously applied filter is still there.',
  },
  {
    sno: 11, suite: 'B: Internal Auditor', scenario: 'B3', tc: 'TC-11',
    testCase: 'Independent filter per IA sub-tab',
    subTab: 'IA sub-tabs',
    steps: '1. Apply filter X in "Ready for Review"\n2. Apply filter Y in "Needs updated"\n3. Switch back and forth',
    expected: 'Each IA sub-tab keeps its own value; no cross-contamination.',
  },
  {
    sno: 12, suite: 'B: Internal Auditor', scenario: 'B4', tc: 'TC-12',
    testCase: 'IA drawer keeps all existing filter options',
    subTab: 'IA sub-tabs',
    steps: '1. Open drawer on each IA sub-tab and compare options',
    expected: 'All existing filter options present across IA sub-tabs (AC does not specify Owner/Function hiding for IA — see Open Questions).',
  },

  // SUITE C — UI layout swap
  {
    sno: 13, suite: 'C: UI Layout Swap', scenario: 'C1', tc: 'TC-13',
    testCase: 'Search ↔ Filters/Add Control placement swapped',
    subTab: 'Workspace + Internal Auditor',
    steps: '1. Open Audit Workspace → Controls\n2. Verify Search and Filters+Add Control are swapped from prior placement\n3. Verify all three still functional (search filters; filter opens drawer; Add Control opens create flow)\n4. Verify no overlap at 1400px width\n5. Verify same swapped layout on Internal Auditor tab',
    expected: 'Placement of Search and Filters/Add Control is swapped per new design; all controls remain functional; layout has no visual break; applied consistently on IA tab.',
  },

  // SUITE D — Negative / edge / accessibility
  {
    sno: 14, suite: 'D: Edge / A11y', scenario: 'D1', tc: 'TC-14',
    testCase: 'Reset does not leak across audits',
    subTab: 'All controls (Audit A → Audit B)',
    steps: '1. Apply filter in All controls of Audit A\n2. Open Audit B → Workspace → All controls',
    expected: 'Audit B starts clean (no badge); filter does not leak across audits.',
  },
  {
    sno: 15, suite: 'D: Edge / A11y', scenario: 'D2', tc: 'TC-15',
    testCase: 'Clear all clears only current sub-tab',
    subTab: 'All controls + Controls I own',
    steps: '1. Filters active on both All controls and Controls I own\n2. Open All controls → Clear all → Apply',
    expected: 'All controls badge gone; Controls I own filter unaffected.',
  },
  {
    sno: 16, suite: 'D: Edge / A11y', scenario: 'D3', tc: 'TC-16',
    testCase: 'Keyboard / accessibility',
    subTab: 'Any Controls sub-tab',
    steps: '1. Tab to filter button, press Enter\n2. Press Escape\n3. Inspect badge with screen reader',
    expected: 'Enter opens drawer; Escape closes it without applying; badge exposes accessible text/count.',
  },
  {
    sno: 17, suite: 'D: Edge / A11y', scenario: 'D4', tc: 'TC-17',
    testCase: 'RBAC — contributor view',
    subTab: 'Controls I own',
    steps: '1. Login as contributor → Controls I own',
    expected: 'Owner/Function hidden (as designed); only permitted sub-tabs visible.',
  },
];

// ── Regression-sheet rows (shouldRun() compatible) ──────────────────────────
// Loader reads: 'Test group', 'Test scenario/Test case/Test step', 'Test case',
// 'Run Shakeout in Prod and POC', 'Run for Full regression'.
// A scenario header row uses "Scenario N" in the 'Test case' column; each TC row
// carries the TG + scenario + TC-id.
const REG_TG = 'TG-8';
const REG_SCENARIO = 'Scenario 8';

async function generate(): Promise<void> {
  const wb = new ExcelJS.Workbook();

  // Sheet 1 — detailed test cases
  const ws = wb.addWorksheet('Filter - Test Cases');
  ws.columns = [
    { header: 'S.No', key: 'sno', width: 6 },
    { header: 'Suite', key: 'suite', width: 22 },
    { header: 'Scenario', key: 'scenario', width: 10 },
    { header: 'Test Case ID', key: 'tc', width: 12 },
    { header: 'Sub-tab(s)', key: 'subTab', width: 30 },
    { header: 'Test Case', key: 'testCase', width: 48 },
    { header: 'Steps', key: 'steps', width: 90 },
    { header: 'Expected Result', key: 'expected', width: 70 },
  ];
  styleHeader(ws);
  detailRows.forEach((r) => ws.addRow(r));
  ws.getColumn('steps').alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn('expected').alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn('subTab').alignment = { wrapText: true, vertical: 'top' };
  ws.getColumn('testCase').alignment = { wrapText: true, vertical: 'top' };

  // Sheet 2 — Regression (shouldRun-compatible)
  const reg = wb.addWorksheet('Regression');
  reg.columns = [
    { header: 'Test group', key: 'tg', width: 12 },
    { header: 'Test scenario/Test case/Test step', key: 'desc', width: 70 },
    { header: 'Test case', key: 'tc', width: 14 },
    { header: 'Run Shakeout in Prod and POC', key: 'shakeout', width: 26 },
    { header: 'Run for Full regression', key: 'regression', width: 22 },
  ];
  styleHeader(reg);
  // Scenario header row
  reg.addRow({
    tg: '', desc: 'Audit Workspace & Internal Auditor — Filter per sub-tab',
    tc: REG_SCENARIO, shakeout: '', regression: '',
  });
  detailRows.forEach((r) => {
    reg.addRow({
      tg: REG_TG,
      desc: `${r.suite} — ${r.testCase}`,
      tc: r.tc,
      // Feature not yet on Prod → shakeout No; enable regression by default.
      shakeout: 'No',
      regression: 'Yes',
    });
  });
  reg.getColumn('desc').alignment = { wrapText: true, vertical: 'top' };

  // Sheet 3 — UI elements reference
  const ui = wb.addWorksheet('UI Elements');
  ui.columns = [
    { header: 'Element', key: 'element', width: 30 },
    { header: 'Selector / Label', key: 'selector', width: 55 },
    { header: 'Notes', key: 'notes', width: 50 },
  ];
  styleHeader(ui);
  const uiRows = [
    { element: 'Filter button (trigger)', selector: '[data-testid="workspace-filter-btn"]', notes: 'Controls sub-tab only' },
    { element: 'Filter active marker/badge', selector: '[data-testid="workspace-filter-badge"]', notes: 'Shows active filter count; count 0 = no marker' },
    { element: 'Filter drawer', selector: 'role="dialog", title "Filters"', notes: 'Radix Sheet slide-over' },
    { element: 'Submission status legend', selector: 'text "Submission status"', notes: 'e.g. option "In progress"' },
    { element: 'Owner field', selector: 'label "Owner"', notes: 'Hidden on restricted Controls sub-tabs' },
    { element: 'Function field', selector: 'label "Function"', notes: 'Hidden on restricted Controls sub-tabs' },
    { element: 'Apply button', selector: 'button "Apply filter"', notes: '' },
    { element: 'Clear button', selector: 'button "Clear all"', notes: '' },
    { element: 'Controls sub-tab chips', selector: 'text: All controls / Controls I own / Needs updates / Due today / Due this week / Due this month', notes: '' },
    { element: 'IA sub-tabs', selector: 'text: Ready for Review / Needs updated', notes: 'Confirm exact IA label' },
    { element: 'Workspace tab panel', selector: '#tabpanel-ws', notes: '' },
    { element: 'Control rows', selector: '#tabpanel-ws a[href*="/control/"]', notes: '' },
    { element: 'Search control', selector: 'input[placeholder*="Search"]', notes: 'Placement swapped per C1' },
    { element: 'Add Control button', selector: 'button "Add Control"', notes: 'Placement swapped per C1' },
  ];
  uiRows.forEach((r) => ui.addRow(r));
  ui.getColumn('selector').alignment = { wrapText: true, vertical: 'top' };
  ui.getColumn('notes').alignment = { wrapText: true, vertical: 'top' };

  // Sheet 4 — Open questions
  const oq = wb.addWorksheet('Open Questions');
  oq.columns = [
    { header: '#', key: 'n', width: 5 },
    { header: 'Question', key: 'q', width: 100 },
  ];
  styleHeader(oq);
  const questions = [
    { n: 1, q: 'IA sub-tabs — should Owner/Function also be hidden on IA restricted sub-tabs, or does IA keep the full drawer? AC only specifies hiding for the Controls sub-tabs.' },
    { n: 2, q: 'Persistence scope — should the filter persist across a full page reload / re-navigation to the audit, or only across in-session sub-tab switches?' },
    { n: 3, q: 'Exact "swap" target — confirm the final placement order (Search first vs Filters/Add Control first) so C1 asserts the right order.' },
    { n: 4, q: 'IA sub-tab label — AC spells it "Needs updated"; Controls tab uses "Needs updates". Confirm the exact IA label for selectors.' },
  ];
  questions.forEach((r) => oq.addRow(r));
  oq.getColumn('q').alignment = { wrapText: true, vertical: 'top' };

  const outPath = path.resolve(__dirname, '../tests/Filter_TestCases.xlsx');
  await wb.xlsx.writeFile(outPath);
  console.log(`✅ Excel written to: ${outPath}`);
  console.log(`   Sheets: Filter - Test Cases (${detailRows.length} cases), Regression, UI Elements, Open Questions`);
}

generate().catch((err) => {
  console.error(err);
  process.exit(1);
});
