const POLL_INTERVAL_MS = 30000;
const MAX_NOTIFICATIONS = 30;

const presetShopUrls = [
  "https://www.tclub.com.hk/collections/%E7%94%A2%E5%93%81%E9%A0%90%E8%A8%82",
  "https://www.toysrus.com.hk/zh-hk/whats-on/new-arrivals/pre-order/",
  "https://www.hobbylandeshop.com/product-category/nproduct_booking",
  "https://preorder.maytoysonline.com/",
  "https://lastchancetoy.com/collections/beybladex"
];
const presetKeywords = [
  "ux-20",
  "bx-50",
  "ux-17",
  "ux20",
  "bx50",
  "ux17"
];

const shops = [];
const keywords = [];
let isPolling = false;

const urlForm = document.getElementById("url-form");
const urlInput = document.getElementById("url-input");
const keywordForm = document.getElementById("keyword-form");
const keywordInput = document.getElementById("keyword-input");
const shopList = document.getElementById("shop-list");
const keywordList = document.getElementById("keyword-list");
const notificationList = document.getElementById("notification-list");

if ("Notification" in window && Notification.permission === "default") {
  Notification.requestPermission().catch(() => {
    // Ignore permission errors and continue with in-page notifications.
  });
}

function normalizeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeSearchText(value) {
  return value.trim().toLocaleLowerCase();
}

function loadPresets() {
  const seenUrls = new Set();
  for (const url of presetShopUrls) {
    const normalizedUrl = normalizeUrl(url);
    if (!normalizedUrl || seenUrls.has(normalizedUrl)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    shops.push({
      url: normalizedUrl,
      status: "pending",
      matchedKeyword: null,
    });
  }

  const seenKeywords = new Set();
  for (const keyword of presetKeywords) {
    const normalizedKeyword = normalizeSearchText(keyword);
    if (!normalizedKeyword || seenKeywords.has(normalizedKeyword)) {
      continue;
    }

    seenKeywords.add(normalizedKeyword);
    keywords.push(keyword.trim());
  }
}

function renderKeywords() {
  keywordList.innerHTML = "";

  keywords.forEach((keyword) => {
    const li = document.createElement("li");
    li.textContent = keyword;
    keywordList.appendChild(li);
  });
}

function renderShops() {
  shopList.innerHTML = "";

  shops.forEach((shop) => {
    const box = document.createElement("article");
    box.className = `shop-box ${shop.status}`;

    const link = document.createElement("a");
    link.href = shop.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = shop.url;

    const meta = document.createElement("p");
    meta.className = "meta";

    if (shop.status === "found") {
      meta.textContent = `MATCH FOUND: ${shop.matchedKeyword}`;
    } else {
      meta.textContent = `Checking every ${POLL_INTERVAL_MS / 1000}s`;
    }

    box.appendChild(link);
    box.appendChild(meta);
    shopList.appendChild(box);
  });
}

function addNotification(message, options = {}) {
  const { desktop = true } = options;
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()} - ${message}`;
  notificationList.prepend(item);

  while (notificationList.children.length > MAX_NOTIFICATIONS) {
    notificationList.removeChild(notificationList.lastElementChild);
  }

  if (desktop && "Notification" in window && Notification.permission === "granted") {
    new Notification("Beyblade Shop Watcher", { body: message });
  }
}

async function fetchShopText(url) {
  const apiUrl = `/api/fetch?url=${encodeURIComponent(url)}`;
  const response = await fetch(apiUrl, { method: "GET" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `Backend HTTP ${response.status}`);
  }

  return await response.text();
}

function hasKeywordMatch(text) {
  const normalizedText = normalizeSearchText(text);

  for (const keyword of keywords) {
    if (normalizedText.includes(normalizeSearchText(keyword))) {
      return keyword;
    }
  }

  return null;
}

async function checkShop(shop) {
  if (shop.status === "found") {
    return;
  }

  if (keywords.length === 0) {
    addNotification(`Skipped check for ${shop.url}: no keywords configured.`, { desktop: false });
    return;
  }

  addNotification(`Checking ${shop.url}`, { desktop: false });

  try {
    const body = await fetchShopText(shop.url);
    const matchedKeyword = hasKeywordMatch(body);

    if (matchedKeyword) {
      shop.status = "found";
      shop.matchedKeyword = matchedKeyword;
      addNotification(`Keyword \"${matchedKeyword}\" found at ${shop.url}`);
      renderShops();
      return;
    }

    addNotification(`Checked ${shop.url}: no keyword match.`, { desktop: false });
  } catch (error) {
    addNotification(`Request failed for ${shop.url}: ${error.message}`, { desktop: false });
  }
}

function checkAllShops() {
  return Promise.allSettled(shops.map((shop) => checkShop(shop)));
}

async function runPollingCycle() {
  if (isPolling) {
    return;
  }

  isPolling = true;
  try {
    await checkAllShops();
  } catch (error) {
    addNotification(`Periodic check error: ${error.message}`);
  } finally {
    isPolling = false;
  }
}

async function initializeApp() {
  loadPresets();
  renderKeywords();
  renderShops();
  addNotification("Running initial shop check...");
  await runPollingCycle();
}

urlForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const normalized = normalizeUrl(urlInput.value.trim());
  if (!normalized) {
    addNotification("Please enter a valid URL.");
    return;
  }

  const exists = shops.some((shop) => shop.url === normalized);
  if (exists) {
    addNotification("That URL is already being tracked.");
    return;
  }

  shops.push({
    url: normalized,
    status: "pending",
    matchedKeyword: null,
  });

  urlInput.value = "";
  renderShops();
  addNotification(`Started tracking ${normalized}`);
  runPollingCycle();
});

keywordForm.addEventListener("submit", (event) => {
  event.preventDefault();

  const keyword = keywordInput.value.trim();
  if (!keyword) {
    return;
  }

  const normalizedKeyword = normalizeSearchText(keyword);
  const exists = keywords.some((item) => normalizeSearchText(item) === normalizedKeyword);
  if (exists) {
    addNotification("Keyword already exists.");
    return;
  }

  keywords.push(keyword);
  keywordInput.value = "";
  renderKeywords();
  addNotification(`Added keyword: ${keyword}`);
  runPollingCycle();
});

initializeApp();
setInterval(() => {
  runPollingCycle();
}, POLL_INTERVAL_MS);
