/**
 * One-off: Replace Scenario 7 (Audit workspace Filters) in the main regression
 * suite (tests/New_Testcase.xlsx → "Regression" sheet) with the expanded
 * per-sub-tab filter acceptance-criteria test cases.
 *
 * - Removes the existing Scenario 7 header + TG-7 TC rows.
 * - Appends the new Scenario 7 block (header + TC rows) in the same 10-column
 *   shape, keeping TG-7 as the Test group and Scenario 7 as the scenario header.
 *
 * Columns (Regression sheet):
 *   A Test case
 *   B Test scenario/Test case/Test step
 *   C Expected Results
 *   D Identifier
 *   E Test group
 *   F Run for Full regression
 *   G Run for Smoketest in prod
 *   H Console Error Validated
 *   I Run Shakeout in Prod and POC
 *   J Last Validated
 */

import ExcelJS from 'exceljs';
import * as path from 'path';

const EXCEL_PATH = path.resolve(__dirname, '../tests/New_Testcase.xlsx');
const SHEET = 'Regression';
const TEST_GROUP = 'TG-7';
const SCENARIO_TITLE = 'Audit Workspace & Internal Auditor - Filter per sub-tab';

interface NewCase {
  tc: string;
  step: string;      // col B
  expected: string;  // col C
  identifier: string; // col D (xpath/selector hint)
}

// Feature not yet on Prod → regression-only. Match prior TG-7 flags.
const FLAGS = {
  fullRegression: 'Yes',
  smokeProd: 'No',
  consoleError: 'No',
  shakeout: 'No',
};

const cases: NewCase[] = [
  // ── Suite A: Audit Workspace Controls sub-tab filters ─────────────────────
  {
    tc: 'TC-1',
    step: 'Launch https://stg.quantarra.com/ and login with Administrator user',
    expected: 'Home page loads; audit tiles visible.',
    identifier: '',
  },
  {
    tc: 'TC-2',
    step: 'Search SOC 2 Type 2 audit - open the audit - Audit Workspace -> Controls -> All controls. Click Filter button, select Submission status "In progress", Apply filter.',
    expected: 'Filter drawer ("Filters") opens; list filters to In progress; drawer closes; filter marker/badge shows "1" on the filter button.',
    identifier: '//*[@id="tabpanel-ws"]/div/div[1]/div/button',
  },
  {
    tc: 'TC-3',
    step: 'On "All controls" with In-progress filter applied (badge=1), switch to "Controls I own" sub-tab. Open filter drawer, then return to "All controls".',
    expected: 'On "Controls I own" the filter RESETS (no badge, no pre-selected status). On returning to "All controls", the badge is still "1" and list stays filtered (value persists only in All controls).',
    identifier: '',
  },
  {
    tc: 'TC-4',
    step: 'Apply status "In progress" on All controls; apply status "Submitted" on Controls I own; visit Needs updates / Due today / Due this week / Due this month; then return to All controls and to Controls I own.',
    expected: 'Each sub-tab keeps its own filter independently (no cross-contamination). All controls retains In progress; Controls I own retains Submitted; other sub-tabs show no inherited filter.',
    identifier: '',
  },
  {
    tc: 'TC-5',
    step: 'On a sub-tab with no filter applied (e.g. Needs updates), observe the filter button; open drawer, apply nothing, close.',
    expected: 'Filter marker/badge is NOT shown when no filter is active on that sub-tab (badge count = 0).',
    identifier: '',
  },
  {
    tc: 'TC-6',
    step: 'Open the filter drawer on each of: Controls I own, Needs updates, Due today, Due this week, Due this month.',
    expected: 'Drawer does NOT show "Owner" and does NOT show "Function" on any of these 5 sub-tabs. All other existing filter options remain visible.',
    identifier: '',
  },
  {
    tc: 'TC-7',
    step: 'Open the filter drawer on "All controls".',
    expected: '"Owner" and "Function" fields ARE shown on All controls; applying an Owner value filters the list and updates the badge.',
    identifier: '',
  },
  {
    tc: 'TC-8',
    step: 'Compare the filter drawer options: baseline on "All controls" vs each restricted sub-tab.',
    expected: 'Drawer keeps all existing filter options across sub-tabs; restricted sub-tabs show the same set MINUS Owner and Function - no other option added/removed.',
    identifier: '',
  },
  {
    tc: 'TC-9',
    step: 'On "All controls" apply a status filter (badge=1). Open the first control, then navigate back to All controls.',
    expected: 'After navigating back, the badge is still "1" and the filter is retained.',
    identifier: '//*[@id="tabpanel-ws"]//a[contains(@href,"/control/")]',
  },
  // ── Suite B: Internal Auditor sub-tab filters ─────────────────────────────
  {
    tc: 'TC-10',
    step: 'Login as Internal Auditor - open audit - Internal Auditor tab - Ready for Review. Open filter drawer, apply a status, Apply.',
    expected: 'Drawer closes; list filtered; filter marker/badge shown on the Internal Auditor sub-tab (Ready for Review).',
    identifier: '',
  },
  {
    tc: 'TC-11',
    step: 'With filter applied on "Ready for Review", move to "Needs updated" sub-tab, open drawer, then return to "Ready for Review".',
    expected: 'On "Needs updated" the filter RESETS (no badge, no inherited selection). Returning to "Ready for Review", the previously applied filter is still there.',
    identifier: '',
  },
  {
    tc: 'TC-12',
    step: 'Apply filter X in "Ready for Review", filter Y in "Needs updated"; switch back and forth.',
    expected: 'Each IA sub-tab keeps its own value independently; no cross-contamination.',
    identifier: '',
  },
  {
    tc: 'TC-13',
    step: 'Open the filter drawer on each Internal Auditor sub-tab.',
    expected: 'IA drawer keeps all existing filter options across sub-tabs.',
    identifier: '',
  },
  // ── Suite C: UI layout swap ───────────────────────────────────────────────
  {
    tc: 'TC-14',
    step: 'On Audit Workspace -> Controls and on the Internal Auditor tab, verify placement of Search control and Filters + Add Control components is swapped per new design. Verify all three still functional; no overlap at 1400px width.',
    expected: 'Search and Filters/Add Control are swapped; search filters the list, filter button opens the drawer, Add Control opens the create flow; layout has no visual break; applied consistently on the IA tab.',
    identifier: '',
  },
  // ── Suite D: Negative / edge / accessibility ──────────────────────────────
  {
    tc: 'TC-15',
    step: 'Apply a filter in All controls of Audit A; open Audit B -> Workspace -> All controls.',
    expected: 'Audit B starts clean (no badge); filter does not leak across audits.',
    identifier: '',
  },
  {
    tc: 'TC-16',
    step: 'With filters active on both All controls and Controls I own, open All controls -> Clear all -> Apply filter.',
    expected: 'All controls badge is gone; Controls I own filter is unaffected (Clear all clears only the current sub-tab).',
    identifier: '',
  },
  {
    tc: 'TC-17',
    step: 'Tab to the filter button and press Enter; press Escape; inspect the badge with a screen reader.',
    expected: 'Enter opens the drawer; Escape closes it without applying; badge exposes accessible text/count.',
    identifier: '',
  },
];

async function run(): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(EXCEL_PATH);

  const ws = wb.getWorksheet(SHEET);
  if (!ws) {
    throw new Error(`Sheet "${SHEET}" not found`);
  }

  // 1) Collect the row numbers (1-indexed) of the existing Scenario 7 block:
  //    the "Scenario 7" header row and every TG-7 row.
  const toDelete: number[] = [];
  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) {
      return; // header
    }

    const colA = String(row.getCell(1).value ?? '').trim();
    const colE = String(row.getCell(5).value ?? '').trim();

    if (colA === 'Scenario 7' || colE === TEST_GROUP) {
      toDelete.push(rowNumber);
    }
  });

  // Delete from the bottom up so row numbers stay valid.
  toDelete
    .sort((a, b) => b - a)
    .forEach((rowNumber) => ws.spliceRows(rowNumber, 1));

  console.log(`  Removed ${toDelete.length} old Scenario 7 / TG-7 rows.`);

  // 2) Append the new Scenario 7 header row.
  ws.addRow(['Scenario 7', SCENARIO_TITLE, '', '', '', '', '', '', '', '']);

  // 3) Append the new TC rows.
  for (const c of cases) {
    ws.addRow([
      c.tc,
      c.step,
      c.expected,
      c.identifier,
      TEST_GROUP,
      FLAGS.fullRegression,
      FLAGS.smokeProd,
      FLAGS.consoleError,
      FLAGS.shakeout,
      '',
    ]);
  }

  console.log(`  Added Scenario 7 header + ${cases.length} TC rows (TG-7).`);

  await wb.xlsx.writeFile(EXCEL_PATH);
  console.log(`✅ Updated: ${EXCEL_PATH}`);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
