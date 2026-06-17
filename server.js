const express = require("express");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const UPSTREAM_TIMEOUT_MS = 15000;
const DIRECT_FETCH_ATTEMPTS = 2;
const execFileAsync = promisify(execFile);

app.use(express.static(path.join(__dirname)));

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchShopHtml(targetUrl) {
  let lastError = null;

  for (let attempt = 1; attempt <= DIRECT_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetchWithTimeout(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          "accept-language": "en-US,en;q=0.9",
          "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "cache-control": "no-cache",
          "pragma": "no-cache"
        }
      });

      const body = await response.text();
      if (!response.ok) {
        return {
          ok: false,
          status: response.status,
          body: `Upstream HTTP ${response.status}`,
        };
      }

      return {
        ok: true,
        status: 200,
        body,
      };
    } catch (error) {
      lastError = error;
    }
  }

  // Some shops fail in Node fetch but succeed with curl from the same host.
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-L", "--max-time", String(Math.ceil(UPSTREAM_TIMEOUT_MS / 1000)), targetUrl],
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stdout && stdout.length > 0) {
      return {
        ok: true,
        status: 200,
        body: stdout,
      };
    }
  } catch (error) {
    lastError = error;
  }

  // Fallback mirror for domains that frequently fail direct server fetches.
  try {
    const mirrorUrl = `https://r.jina.ai/http://${targetUrl.replace(/^https?:\/\//, "")}`;
    const mirrorResponse = await fetchWithTimeout(mirrorUrl, { method: "GET" });
    const mirrorBody = await mirrorResponse.text();

    if (!mirrorResponse.ok) {
      return {
        ok: false,
        status: mirrorResponse.status,
        body: `Mirror HTTP ${mirrorResponse.status}`,
      };
    }

    return {
      ok: true,
      status: 200,
      body: mirrorBody,
    };
  } catch (error) {
    const reason = error?.message || lastError?.message || "Unknown upstream error";
    return {
      ok: false,
      status: 502,
      body: `Upstream fetch failed: ${reason}`,
    };
  }
}

app.get("/api/fetch", async (req, res) => {
  const targetUrl = req.query.url;
  if (typeof targetUrl !== "string") {
    res.status(400).send("Missing url query parameter");
    return;
  }

  let normalizedUrl;
  try {
    normalizedUrl = new URL(targetUrl).toString();
  } catch {
    res.status(400).send("Invalid url query parameter");
    return;
  }

  try {
    const result = await fetchShopHtml(normalizedUrl);
    if (!result.ok) {
      res.status(result.status).send(result.body);
      return;
    }

    res.type("text/plain; charset=utf-8").send(result.body);
  } catch (error) {
    res.status(502).send(`Upstream fetch failed: ${error.message}`);
  }
});

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Beyblade watcher running at http://localhost:${PORT}`);
});
