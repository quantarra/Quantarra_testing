/**
 * Add Configuration Sheet to Test Case Excel
 *
 * Adds a "Configuration" sheet to tests/New_Testcase.xlsx with default settings.
 * Safe to re-run — will NOT overwrite if the sheet already exists.
 *
 * Run: npx tsx scripts/add-config-sheet.ts
 */

import ExcelJS from 'exceljs';
import * as path from 'path';
import * as fs from 'fs';

async function addConfigSheet() {
  const excelPath = path.resolve(__dirname, '../tests/New_Testcase.xlsx');

  if (!fs.existsSync(excelPath)) {
    console.error(`❌ Excel file not found: ${excelPath}`);
    process.exit(1);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(excelPath);

  // Check if Configuration sheet already exists
  const existingSheet = workbook.getWorksheet('Configuration');
  if (existingSheet) {
    console.log('ℹ️  "Configuration" sheet already exists — no changes made.');
    console.log('   Edit the Excel directly to change settings.');
    return;
  }

  // Add Configuration sheet
  const sheet = workbook.addWorksheet('Configuration');

  // Column definitions
  sheet.columns = [
    { header: 'Setting', key: 'Setting', width: 28 },
    { header: 'Value', key: 'Value', width: 14 },
    { header: 'Description', key: 'Description', width: 55 },
  ];

  // Style header row
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, size: 11 };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
  headerRow.alignment = { vertical: 'middle' };

  // Configuration entries — Slack disabled by default (user's request)
  const configData = [
    { Setting: 'Slack Notifications', Value: 'No', Description: 'Post to Slack channel on test failures (Yes/No)' },
    { Setting: 'Email Notifications', Value: 'Yes', Description: 'Send email report after every run (Yes/No)' },
    { Setting: 'Jira Ticket Creation', Value: 'Yes', Description: 'Create/update Jira tickets on failures (Yes/No)' },
    { Setting: 'Report Environment', Value: 'both', Description: 'Which environment(s) to report: prod / poc / both' },
  ];

  for (const entry of configData) {
    const row = sheet.addRow(entry);
    row.alignment = { vertical: 'middle' };

    // Highlight the Value column for easy visibility
    const valueCell = row.getCell('Value');
    if (entry.Value.toLowerCase() === 'no') {
      valueCell.font = { bold: true, color: { argb: 'FFC62828' } };
    } else if (entry.Value.toLowerCase() === 'yes') {
      valueCell.font = { bold: true, color: { argb: 'FF2E7D32' } };
    }
  }

  // Add a note row
  sheet.addRow({});
  const noteRow = sheet.addRow({ Setting: 'Notes:', Value: '', Description: '' });
  noteRow.font = { bold: true, italic: true };
  sheet.addRow({ Setting: '• Change "Value" column to Yes/No to toggle features.', Value: '', Description: '' });
  sheet.addRow({ Setting: '• Changes take effect on the next shakeout run (no deploy needed).', Value: '', Description: '' });
  sheet.addRow({ Setting: '• Push to GitHub for CI runs to pick up changes.', Value: '', Description: '' });

  // Save
  await workbook.xlsx.writeFile(excelPath);
  console.log('✅ "Configuration" sheet added to tests/New_Testcase.xlsx');
  console.log('');
  console.log('Current settings:');
  for (const entry of configData) {
    const icon = entry.Value.toLowerCase() === 'yes' ? '✅' : '⏸️';
    console.log(`  ${icon} ${entry.Setting}: ${entry.Value}`);
  }
  console.log('');
  console.log('To change: open the Excel → "Configuration" tab → edit Value column → save.');
}

addConfigSheet().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
