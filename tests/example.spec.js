const { _electron: electron } = require('playwright');
const { test, expect } = require('@playwright/test');

let window, electronApp;

test.beforeAll(async () => {
  // Launch Electron app.
  electronApp = await electron.launch({ args: ['main.js'] });

  // Evaluation expression in the Electron context.
  const appPath = await electronApp.evaluate(async ({ app }) => {
    // This runs in the main Electron process, parameter here is always
    // the result of the require('electron') in the main app script.
    return app.getAppPath();
  });
  console.log(appPath);

  // Get the first window that the app opens, wait if necessary.
  window = await electronApp.firstWindow();
  // Print the title.
  console.log(await window.title());
  // Capture a screenshot.
  await window.screenshot({ path: 'tests/screenshots/out.png' });
  // Direct Electron console to Node terminal.
  window.on('console', console.log);

});

test('window has correct title', async () => {
  const title = await window.title()
  expect(title).toBe('Hello World!')
})

test.afterAll(async () => {
  // Exit app.
  await electronApp.close();
});

// 