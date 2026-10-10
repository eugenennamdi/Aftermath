import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const TOKEN = process.argv[2];

if (!TOKEN) {
  console.error('Usage: node scripts/capture_screenshots.mjs <token>');
  process.exit(1);
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function run() {
  console.log('Launching headless Chrome on port 9222...');
  const chrome = spawn(
    CHROME_PATH,
    [
      '--headless=new',
      '--remote-debugging-port=9222',
      '--disable-gpu',
      '--no-sandbox',
      '--user-data-dir=/tmp/chrome-cdp-profile',
    ],
    { stdio: 'ignore' }
  );

  try {
    // Wait for Chrome remote debugging to be ready
    let targetInfo = null;
    for (let i = 0; i < 20; i++) {
      await sleep(300);
      try {
        const res = await fetch('http://localhost:9222/json/version');
        if (res.ok) {
          targetInfo = await res.json();
          break;
        }
      } catch {
        // waiting
      }
    }

    if (!targetInfo) {
      throw new Error('Chrome remote debugging did not become ready');
    }

    console.log('Chrome debugging endpoint ready.');

    // Function to run a CDP session
    async function capturePage({ width, height, mobile, outputPath, tabToClick, incidentToOpen, setAuthCookie }) {
      // Create new page
      const newPageRes = await fetch('http://localhost:9222/json/new?http://localhost:3000', {
        method: 'PUT',
      });
      const pageInfo = await newPageRes.json();
      const wsUrl = pageInfo.webSocketDebuggerUrl;

      const ws = new WebSocket(wsUrl);
      let id = 1;
      const pending = new Map();

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.id && pending.has(data.id)) {
          const { resolve, reject } = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) reject(data.error);
          else resolve(data.result);
        }
      };

      await new Promise((resolve) => (ws.onopen = resolve));

      function send(method, params = {}) {
        return new Promise((resolve, reject) => {
          const reqId = id++;
          pending.set(reqId, { resolve, reject });
          ws.send(JSON.stringify({ id: reqId, method, params }));
        });
      }

      await send('Network.enable');
      await send('Page.enable');

      // Set or clear cookie
      if (setAuthCookie) {
        await send('Network.setCookie', {
          name: 'aftermath_operator_session',
          value: TOKEN,
          domain: 'localhost',
          path: '/',
          httpOnly: true,
          secure: false,
        });
      } else {
        await send('Network.clearBrowserCookies');
      }

      // Emulation metrics
      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: Boolean(mobile),
      });

      // Reload page with cookie active
      await send('Page.navigate', { url: 'http://localhost:3000' });

      // Wait 3.5 seconds for React hydration, CSS compile, and API responses
      await sleep(3500);

      // If requested, click on a tab (e.g. Incidents)
      if (tabToClick) {
        await send('Runtime.evaluate', {
          expression: `
            (() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              const target = buttons.find(b => b.textContent && b.textContent.trim() === '${tabToClick}');
              if (target) target.click();
            })()
          `,
        });
        await sleep(1500);
      }

      // If requested, open the first incident modal
      if (incidentToOpen) {
        await send('Runtime.evaluate', {
          expression: `
            (() => {
              const incidentRows = Array.from(document.querySelectorAll('div, tr, button')).find(el => el.textContent && el.textContent.includes('inc_'));
              if (incidentRows) {
                // Find clickable item inside or the item itself
                const btn = incidentRows.closest('button') || incidentRows.querySelector('button') || incidentRows;
                btn.click();
              }
            })()
          `,
        });
        await sleep(1500);
      }

      // Capture screenshot
      const result = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });

      const buffer = Buffer.from(result.data, 'base64');
      fs.writeFileSync(outputPath, buffer);
      console.log(`Saved screenshot to ${outputPath} (${buffer.length} bytes)`);

      // Close page
      await fetch(`http://localhost:9222/json/close/${pageInfo.id}`);
      ws.close();
    }

    // 1. Unauthenticated Desktop (1440x900)
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: false,
      outputPath: path.resolve('docs/screenshots/desktop_console.png'),
    });

    // 2. Unauthenticated Mobile (390x844)
    await capturePage({
      width: 390,
      height: 844,
      mobile: true,
      setAuthCookie: false,
      outputPath: path.resolve('docs/screenshots/mobile_console.png'),
    });

    // 3. Authenticated Desktop (1440x900) - Overview
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      outputPath: path.resolve('docs/screenshots/desktop_authenticated.png'),
    });

    // 4. Authenticated Desktop - Incidents tab
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      outputPath: path.resolve('docs/screenshots/desktop_incidents.png'),
    });

    // 5. Authenticated Mobile (390x844) - Incidents stream
    await capturePage({
      width: 390,
      height: 844,
      mobile: true,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      outputPath: path.resolve('docs/screenshots/mobile_authenticated.png'),
    });

    console.log('All screenshots captured successfully.');
  } finally {
    chrome.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
