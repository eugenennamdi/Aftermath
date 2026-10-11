import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function getSessionToken() {
  if (process.argv[2]) return process.argv[2];
  const secret = process.env.OPERATOR_SECRET;
  if (!secret) {
    throw new Error('OPERATOR_SECRET missing in environment and no token passed as argument');
  }
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const nonce = crypto.randomUUID();
  const payload = Buffer.from(JSON.stringify({ exp, nonce })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

const TOKEN = getSessionToken();

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
      '--user-data-dir=/tmp/chrome-cdp-profile-' + Date.now(),
    ],
    { stdio: 'ignore' }
  );

  try {
    // Wait for Chrome remote debugging to be ready
    let targetInfo = null;
    for (let i = 0; i < 25; i++) {
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
    async function capturePage({
      width,
      height,
      mobile,
      outputPath,
      tabToClick,
      statusFilter,
      openModalMode,
      setAuthCookie,
    }) {
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

      await send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 2,
        mobile: Boolean(mobile),
      });

      await send('Page.navigate', { url: 'http://localhost:3000' });
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

      // If status filter requested, click filter
      if (statusFilter) {
        await send('Runtime.evaluate', {
          expression: `
            (() => {
              const buttons = Array.from(document.querySelectorAll('button'));
              const target = buttons.find(b => b.textContent && b.textContent.trim() === '${statusFilter}');
              if (target) target.click();
            })()
          `,
        });
        await sleep(2000);
      }

      // If open modal requested
      if (openModalMode) {
        await send('Runtime.evaluate', {
          expression: `
            (() => {
              const rows = Array.from(document.querySelectorAll('tbody tr'));
              if (rows.length > 0) {
                rows[0].click();
              }
            })()
          `,
        });
        await sleep(2500);

        if (openModalMode === 'evidence') {
          await send('Runtime.evaluate', {
            expression: `
              (() => {
                const buttons = Array.from(document.querySelectorAll('button'));
                const target = buttons.find(b => b.textContent && b.textContent.includes('Evidence'));
                if (target) target.click();
              })()
            `,
          });
          await sleep(1000);
        }
      }

      const result = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      });

      const buffer = Buffer.from(result.data, 'base64');
      fs.writeFileSync(outputPath, buffer);
      console.log(`Saved screenshot to ${outputPath} (${buffer.length} bytes)`);

      await fetch(`http://localhost:9222/json/close/${pageInfo.id}`);
      ws.close();
    }

    // Ensure output directory exists
    fs.mkdirSync(path.resolve('docs/screenshots'), { recursive: true });

    // 1. Unauthenticated Desktop (1440x900)
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: false,
      outputPath: path.resolve('docs/screenshots/desktop_console.png'),
    });

    // 2. Authenticated Desktop (1440x900) - Overview
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      outputPath: path.resolve('docs/screenshots/desktop_authenticated.png'),
    });

    // 3. Authenticated Desktop - Incidents tab
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      outputPath: path.resolve('docs/screenshots/desktop_incidents.png'),
    });

    // 4. Authenticated Desktop - Modal for RESOLVED incident
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      statusFilter: 'RESOLVED',
      openModalMode: 'timeline',
      outputPath: path.resolve('docs/screenshots/desktop_modal_resolved.png'),
    });

    // 5. Authenticated Desktop - Modal for INVESTIGATING incident (truthful, NO false future claims)
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      statusFilter: 'INVESTIGATING',
      openModalMode: 'timeline',
      outputPath: path.resolve('docs/screenshots/desktop_modal_investigating.png'),
    });

    // 6. Authenticated Desktop - Modal for ESCALATED incident (truthful rejected gate, zero entitlements)
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      statusFilter: 'ESCALATED',
      openModalMode: 'timeline',
      outputPath: path.resolve('docs/screenshots/desktop_modal_escalated.png'),
    });

    // 7. Authenticated Desktop - Evidence dossier tab
    await capturePage({
      width: 1440,
      height: 900,
      mobile: false,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      statusFilter: 'RESOLVED',
      openModalMode: 'evidence',
      outputPath: path.resolve('docs/screenshots/desktop_incident_detail_evidence.png'),
    });

    // Backward-compatible copy for desktop_incident_detail_timeline.png
    fs.copyFileSync(
      path.resolve('docs/screenshots/desktop_modal_resolved.png'),
      path.resolve('docs/screenshots/desktop_incident_detail_timeline.png')
    );

    // 8. Unauthenticated Mobile (390x844)
    await capturePage({
      width: 390,
      height: 844,
      mobile: true,
      setAuthCookie: false,
      outputPath: path.resolve('docs/screenshots/mobile_console.png'),
    });

    // 9. Authenticated Mobile (390x844) - Overview
    await capturePage({
      width: 390,
      height: 844,
      mobile: true,
      setAuthCookie: true,
      outputPath: path.resolve('docs/screenshots/mobile_authenticated.png'),
    });

    // 10. Mobile Header at 390px
    await capturePage({
      width: 390,
      height: 400,
      mobile: true,
      setAuthCookie: true,
      outputPath: path.resolve('docs/screenshots/mobile_header_390.png'),
    });

    // 11. Mobile Header at 360px (confirm zero collision)
    await capturePage({
      width: 360,
      height: 400,
      mobile: true,
      setAuthCookie: true,
      outputPath: path.resolve('docs/screenshots/mobile_header_360.png'),
    });

    // 12. Authenticated Mobile - Incident Detail Modal (390x844)
    await capturePage({
      width: 390,
      height: 844,
      mobile: true,
      setAuthCookie: true,
      tabToClick: 'Incidents',
      statusFilter: 'RESOLVED',
      openModalMode: 'timeline',
      outputPath: path.resolve('docs/screenshots/mobile_incident_modal.png'),
    });

    console.log('All verification screenshots captured successfully!');
  } finally {
    chrome.kill('SIGKILL');
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
