/**
 * Excel-Driven Test Filter
 *
 * Reads "tests/New_Testcase.xlsx" → "Regression" sheet and checks one of:
 *   - "Run for Smoketest in prod"  (daily shakeout on PROD)
 *   - "Run for Smoketest in POC"   (daily shakeout on POC / staging)
 *   - "Run for Full regression"    (regression runs)
 *
 * Selection rules:
 *   RUN_MODE=regression                    → "Run for Full regression"
 *   RUN_MODE=shakeout (default) + ENV=prod  → "Run for Smoketest in prod"
 *   RUN_MODE=shakeout (default) + ENV=poc   → "Run for Smoketest in POC"
 *   RUN_MODE=shakeout (default) + other ENV → "Run for Smoketest in POC" (non-prod default)
 *
 * Usage in test files:
 *   import { shouldRun } from './excel-filter';
 *
 *   test('My test name', async ({ page }) => {
 *     test.skip(!shouldRun('TG-2', 'Scenario 2', 'TC-6'), 'Excluded by Excel');
 *     // ... test steps
 *   });
 *
 * The Excel is read once and cached for the entire test run.
 * Update the Excel, push to GitHub → next CI run picks up the change automatically.
 */

import * as path from 'path';

type RunMode = 'shakeout' | 'regression';

interface TestCaseEntry {
  scenario: string;
  tc: string;
  tg: string;
  runSmokeProd: boolean;
  runSmokePoc: boolean;
  runRegression: boolean;
  desc: string;
}

let _cache: TestCaseEntry[] | null = null;

/**
 * Determine current run mode from environment variable.
 */
function getRunMode(): RunMode {
  const mode = (process.env.RUN_MODE || 'shakeout').trim().toLowerCase();

  if (mode === 'regression') {
    return 'regression';
  }

  return 'shakeout';
}

/**
 * Resolve the current target environment (from the ENV var).
 */
function getEnv(): string {
  return (process.env.ENV || 'staging').trim().toLowerCase();
}

/**
 * Whether the given entry should run for the CURRENT mode + environment.
 *   regression                → runRegression
 *   shakeout + ENV=prod        → runSmokeProd
 *   shakeout + ENV=poc / other → runSmokePoc (non-prod default)
 */
function entryRuns(entry: TestCaseEntry): boolean {
  if (getRunMode() === 'regression') {
    return entry.runRegression;
  }

  return getEnv() === 'prod' ? entry.runSmokeProd : entry.runSmokePoc;
}

/**
 * Human-readable name of the Excel column driving the current run.
 */
function activeColumnName(): string {
  if (getRunMode() === 'regression') {
    return 'Run for Full regression';
  }

  return getEnv() === 'prod' ? 'Run for Smoketest in prod' : 'Run for Smoketest in POC';
}

/**
 * Loads and caches the Excel test case data.
 * Returns an array of test case entries with their run status for both modes.
 */
function loadExcelData(): TestCaseEntry[] {
  if (_cache) {
    return _cache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    const excelPath = path.resolve(__dirname, '..', 'New_Testcase.xlsx');
    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets['Regression'];

    if (!ws) {
      console.warn('[excel-filter] Sheet "Regression" not found — all tests will run.');
      _cache = [];
      return _cache;
    }

    const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
    let currentScenario = '';
    const entries: TestCaseEntry[] = [];

    for (const row of data) {
      const tc = String(row['Test case'] || '');
      const scenario = String(row['Test scenario/Test case/Test step'] || '');
      const tg = String(row['Test group'] || '');
      const smokeProdVal = String(row['Run for Smoketest in prod'] || '').trim().toLowerCase();
      const smokePocVal = String(row['Run for Smoketest in POC'] || '').trim().toLowerCase();
      const regressionVal = String(row['Run for Full regression'] || '').trim().toLowerCase();

      if (tc.startsWith('Scenario')) {
        currentScenario = tc;
      } else if (tc.startsWith('TC-') && tg) {
        entries.push({
          scenario: currentScenario,
          tc,
          tg,
          runSmokeProd: smokeProdVal === 'yes',
          runSmokePoc: smokePocVal === 'yes',
          runRegression: regressionVal === 'yes',
          desc: scenario.substring(0, 120),
        });
      }
    }

    _cache = entries;
    return _cache;
  } catch (err) {
    console.warn('[excel-filter] Could not read Excel file — all tests will run by default.', err);
    _cache = [];
    return _cache;
  }
}

/**
 * Check if a specific test case should run based on Excel marking.
 * Reads the appropriate column based on RUN_MODE env var.
 *
 * @param tg - Test Group (e.g., "TG-1", "TG-2", "TG-6")
 * @param scenario - Scenario name (e.g., "Scenario 1", "Scenario 6")
 * @param tc - Test Case ID (e.g., "TC-1", "TC-6")
 * @returns true if test should run, false if it should be skipped.
 *          Returns true by default if the entry is not found in Excel.
 */
export function shouldRun(tg: string, scenario: string, tc: string): boolean {
  const entries = loadExcelData();

  if (entries.length === 0) {
    // Excel not loaded — run everything (safe default)
    return true;
  }

  const match = entries.find(
    (e) => e.tg === tg && e.scenario === scenario && e.tc === tc,
  );

  if (!match) {
    // Test case not listed in Excel — run by default
    return true;
  }

  return entryRuns(match);
}

/**
 * Check if an entire test group should run (at least one TC is marked "Yes").
 *
 * @param tg - Test Group (e.g., "TG-1", "TG-6")
 * @returns true if ANY test case in this group is marked to run
 */
export function shouldRunGroup(tg: string): boolean {
  const entries = loadExcelData();

  if (entries.length === 0) {
    return true;
  }

  const groupEntries = entries.filter((e) => e.tg === tg);

  if (groupEntries.length === 0) {
    return true;
  }

  return groupEntries.some((e) => entryRuns(e));
}

/**
 * Get all test cases for a specific test group with their run status.
 * Useful for debugging which tests are included/excluded.
 */
export function getGroupStatus(tg: string): TestCaseEntry[] {
  const entries = loadExcelData();
  return entries.filter((e) => e.tg === tg);
}

/**
 * Print a summary of what's included/excluded for the current run.
 * Call this once at the start of the suite for visibility.
 */
export function printFilterSummary(): void {
  const entries = loadExcelData();

  if (entries.length === 0) {
    console.log('[excel-filter] No Excel data loaded — running all tests.');
    return;
  }

  const columnName = activeColumnName();
  const included = entries.filter((e) => entryRuns(e));
  const excluded = entries.filter((e) => !entryRuns(e));

  console.log(`[excel-filter] Mode: ${getRunMode().toUpperCase()} | ENV: ${getEnv().toUpperCase()} | Column: "${columnName}"`);
  console.log(`  Loaded ${entries.length} test cases from Excel.`);
  console.log(`  ✅ Run: ${included.length} | ⏭️ Skip: ${excluded.length}`);

  if (excluded.length > 0) {
    console.log('  Skipped tests:');
    for (const e of excluded) {
      console.log(`    ⏭️ ${e.tg} ${e.scenario} ${e.tc}: ${e.desc.substring(0, 60)}`);
    }
  }
}



// ===== E2E FLOW SUPPORT =====

interface E2ETestCaseEntry {
  flow: string;       // "E2E Flow 1", "E2E Flow 2"
  tc: string;         // "TC-1", "TC-2"
  tg: string;         // "TG-1", "TG-2"
  runE2E: boolean;
  desc: string;
}

let _e2eCache: E2ETestCaseEntry[] | null = null;

/**
 * Loads and caches the E2E Flow sheet data.
 */
function loadE2EData(): E2ETestCaseEntry[] {
  if (_e2eCache) {
    return _e2eCache;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require('xlsx');
    const excelPath = path.resolve(__dirname, '..', 'New_Testcase.xlsx');
    const wb = XLSX.readFile(excelPath);
    const ws = wb.Sheets['E2E Flow'];

    if (!ws) {
      console.warn('[excel-filter] Sheet "E2E Flow" not found — all E2E tests will run.');
      _e2eCache = [];
      return _e2eCache;
    }

    const data = XLSX.utils.sheet_to_json(ws) as Record<string, unknown>[];
    let currentFlow = '';
    const entries: E2ETestCaseEntry[] = [];

    for (const row of data) {
      const tc = String(row['Test case'] || '');
      const desc = String(row['Test scenario/Test case/Test step'] || '');
      const tg = String(row['Test group'] || '');
      const runVal = String(row['Run for E2E Flow'] || '').trim().toLowerCase();

      if (tc.startsWith('E2E Flow')) {
        currentFlow = tc;
      } else if (tc.startsWith('TC-') && tg) {
        entries.push({
          flow: currentFlow,
          tc,
          tg,
          runE2E: runVal === 'yes',
          desc: desc.substring(0, 120),
        });
      }
    }

    _e2eCache = entries;
    return _e2eCache;
  } catch (err) {
    console.warn('[excel-filter] Could not read E2E Flow sheet — all tests will run.', err);
    _e2eCache = [];
    return _e2eCache;
  }
}

/**
 * Check if a specific E2E test case should run.
 *
 * @param flow - E2E Flow name (e.g., "E2E Flow 1")
 * @param tc - Test Case ID (e.g., "TC-1")
 * @returns true if test should run
 */
export function shouldRunE2E(flow: string, tc: string): boolean {
  const entries = loadE2EData();

  if (entries.length === 0) {
    return true;
  }

  const match = entries.find((e) => e.flow === flow && e.tc === tc);

  if (!match) {
    return true;
  }

  return match.runE2E;
}

/**
 * Get the test step description from the E2E sheet for a given flow + TC.
 * Useful for dynamic test names.
 */
export function getE2EStepDescription(flow: string, tc: string): string {
  const entries = loadE2EData();
  const match = entries.find((e) => e.flow === flow && e.tc === tc);
  return match?.desc || '';
}

/**
 * Print E2E flow summary.
 */
export function printE2EFilterSummary(): void {
  const entries = loadE2EData();

  if (entries.length === 0) {
    console.log('[excel-filter] No E2E Flow data loaded — running all tests.');
    return;
  }

  const included = entries.filter((e) => e.runE2E);
  const excluded = entries.filter((e) => !e.runE2E);

  console.log(`[excel-filter] E2E Flow | Column: "Run for E2E Flow"`);
  console.log(`  Loaded ${entries.length} test cases from E2E Flow sheet.`);
  console.log(`  ✅ Run: ${included.length} | ⏭️ Skip: ${excluded.length}`);
}
