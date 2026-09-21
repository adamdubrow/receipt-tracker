/* ============================================================
   Costco purchase history importer (warehouse + online)
   Part of Receipt Tracker. See README.md for the full routine.
   ------------------------------------------------------------
   HOW TO RUN (at a computer, in Chrome)
   1. Sign in at costco.com and open Orders & Returns once.
   2. Press F12 and click the "Console" tab.
   3. If Chrome blocks pasting, TYPE  allow pasting  and press Enter.
   4. Paste this entire file and press Enter. Takes about 3 minutes.
   5. When it says COPIED TO CLIPBOARD, open Receipt Tracker,
      choose Paste import, paste, and choose Import.

   Costco's site blocks sending data straight to Google, so the
   results travel by clipboard. Trips already in your Sheet are
   skipped, so re-running is always safe.
   ============================================================ */

// "var" (not const) so pasting the script twice in one tab still works.
// DevTools' copy() is only reachable here, before the first await.
var __devtoolsCopy = (typeof copy === "function") ? copy : null;

(async () => {
  const ENDPOINT = "https://ecom-api.costco.com/ebusiness/order/v1/orders/graphql";

  // Static app identifiers observed in costco.com's own requests.
  const CLIENT_ID  = "481b1aec-aa3b-454b-b81b-48187e28f205";
  const WCS_CLIENT = "4900eb1f-0c10-4bd9-99c3-c59e6c1ecebf";

  const YEARS_BACK    = 2;    // Costco retains roughly 2 years
  const WINDOW_DAYS   = 90;   // matches the site's own paging
  const DELAY_MS      = 250;  // politeness between detail calls

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const log   = (...a) => console.log("%c[costco]", "color:#0a7", ...a);

  /* ---------- 1. Locate the bearer token ---------- */

  function findToken() {
    const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g;
    const found = [];

    for (const store of [localStorage, sessionStorage]) {
      for (let i = 0; i < store.length; i++) {
        const raw = store.getItem(store.key(i)) || "";
        for (const m of raw.match(jwtRe) || []) found.push(m);
      }
    }

    const now = Math.floor(Date.now() / 1000);
    const valid = [];

    for (const t of new Set(found)) {
      try {
        const body = JSON.parse(atob(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
        if (body.exp && body.exp > now) valid.push({ token: t, exp: body.exp });
      } catch { /* not a decodable JWT; skip */ }
    }

    if (!valid.length) return null;
    valid.sort((a, b) => b.exp - a.exp);          // longest life remaining
    return valid[0];
  }

  const auth = findToken();
  if (!auth) {
    console.error("[costco] No valid token found. Reload costco.com, make sure " +
                  "you're signed in, visit Orders & Returns once, then re-run.");
    return;
  }
  log(`Token found, valid for ${Math.round((auth.exp - Date.now() / 1000) / 60)} more minutes.`);

  /* ---------- 2. GraphQL helper ---------- */

  async function gql(query, variables) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      headers: {
        "accept": "*/*",
        "content-type": "application/json-patch+json",
        "client-identifier": CLIENT_ID,
        "costco-x-authorization": "Bearer " + auth.token,
        "costco-x-wcs-clientid": WCS_CLIENT,
        "costco.env": "ecom",
        "costco.service": "restOrders"
      },
      body: JSON.stringify({ query, variables })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors).slice(0, 200));
    return json.data;
  }

  const LIST_Q = `query receiptsWithCounts($startDate: String!, $endDate: String!, $documentType: String!, $documentSubType: String!) {
    receiptsWithCounts(startDate: $startDate, endDate: $endDate, documentType: $documentType, documentSubType: $documentSubType) {
      receipts { receiptType transactionDate transactionBarcode total }
    }
  }`;

  const DETAIL_Q = `query receiptsWithCounts($barcode: String!, $documentType: String!) {
    receiptsWithCounts(barcode: $barcode, documentType: $documentType) {
      receipts {
        warehouseName receiptType transactionDate transactionBarcode
        transactionType total subTotal taxes totalItemCount instantSavings
        itemArray {
          itemNumber itemDescription01 itemDescription02 itemIdentifier
          itemDepartmentNumber unit amount itemUnitPriceAmount
        }
      }
    }
  }`;

  /* ---------- 3. Collect barcodes across date windows ---------- */

  // The exact documentType / documentSubType values aren't documented,
  // so probe a few combinations and keep whichever returns data.
  const COMBOS = [
    ["all", "all"], ["warehouse", "all"],
    ["all", "warehouse"], ["warehouse", "warehouse"]
  ];

  const fmt = d => d.toISOString().slice(0, 10);
  const today = new Date();
  const windows = [];
  for (let i = 0; i < Math.ceil(YEARS_BACK * 365 / WINDOW_DAYS); i++) {
    const end   = new Date(today); end.setDate(end.getDate() - i * WINDOW_DAYS);
    const start = new Date(end);   start.setDate(start.getDate() - WINDOW_DAYS);
    windows.push([fmt(start), fmt(end)]);
  }

  let combo = null;
  const barcodes = new Map();

  for (const [startDate, endDate] of windows) {
    let data = null;

    if (!combo) {
      for (const c of COMBOS) {
        try {
          const d = await gql(LIST_Q, {
            startDate, endDate, documentType: c[0], documentSubType: c[1]
          });
          if (d?.receiptsWithCounts?.receipts) {
            combo = c; data = d;
            log(`Using documentType="${c[0]}", documentSubType="${c[1]}".`);
            break;
          }
        } catch { /* try next combination */ }
      }
      if (!combo) { console.error("[costco] No working query parameters found."); return; }
    } else {
      try {
        data = await gql(LIST_Q, {
          startDate, endDate, documentType: combo[0], documentSubType: combo[1]
        });
      } catch (e) { log(`Window ${startDate} skipped: ${e.message}`); continue; }
    }

    for (const r of data?.receiptsWithCounts?.receipts || []) {
      if (r.transactionBarcode) barcodes.set(r.transactionBarcode, r);
    }
    log(`${startDate} to ${endDate}: ${barcodes.size} receipts found so far.`);
    await sleep(DELAY_MS);
  }

  log(`Collected ${barcodes.size} unique receipts. Fetching line items...`);

  /* ---------- 4. Fetch each receipt and flatten to rows ---------- */

  const rows = [];
  let done = 0;

  for (const barcode of barcodes.keys()) {
    let receipts;
    try {
      const d = await gql(DETAIL_Q, { barcode, documentType: "warehouse" });
      receipts = d?.receiptsWithCounts?.receipts || [];
    } catch (e) {
      log(`Receipt ${barcode} failed: ${e.message}`);
      continue;
    }

    for (const rec of receipts) {
      const items = rec.itemArray || [];

      // Pass 1: real purchase lines.
      // Pass 2: lines whose description starts with "/" are instant-savings
      // entries pointing at the item number above them, not products.
      const built = [];

      for (const it of items) {
        const d1 = (it.itemDescription01 || "").trim();

        if (d1.startsWith("/")) {
          const target = d1.slice(1).trim();
          const match = built.find(b => b.itemNumber === target);
          if (match) match.discount += Math.abs(Number(it.amount) || 0);
          continue;
        }

        const desc = [d1, (it.itemDescription02 || "").trim()]
          .filter(Boolean).join(" ");

        built.push({
          date:        rec.transactionDate,
          warehouse:   rec.warehouseName || "",
          barcode:     rec.transactionBarcode,
          itemNumber:  (it.itemNumber || "").trim(),
          description: desc,
          department:  it.itemDepartmentNumber ?? "",
          taxable:     it.itemIdentifier === "E" ? "Y" : "",
          quantity:    Number(it.unit) || 0,
          unitPrice:   Number(it.itemUnitPriceAmount) || 0,
          amount:      Number(it.amount) || 0,
          discount:    0,
          isReturn:    (Number(rec.total) || 0) < 0 ? "Y" : ""
        });
      }

      for (const b of built) {
        b.netAmount = +(b.amount + (b.amount < 0 ? b.discount : -b.discount)).toFixed(2);
        rows.push(b);
      }
    }

    if (++done % 10 === 0) log(`${done} of ${barcodes.size} receipts processed.`);
    await sleep(DELAY_MS);
  }

  /* ---------- 4b. Online orders (costco.com) ---------- */

  // Query text mirrors what costco.com itself sends; only the fields
  // needed here are requested. getOnlineOrders may answer with a list
  // of pages, so both shapes are handled.
  const ONLINE_WAREHOUSE = "847";   // the account's online warehouse, as the site sends it

  const ONLINE_LIST_Q = `query getOnlineOrders($startDate:String!, $endDate:String!, $pageNumber:Int , $pageSize:Int, $warehouseNumber:String! ){
    getOnlineOrders(startDate:$startDate, endDate:$endDate, pageNumber : $pageNumber, pageSize : $pageSize, warehouseNumber : $warehouseNumber) {
      pageNumber pageSize totalNumberOfRecords
      bcOrders { orderNumber : sourceOrderNumber orderPlacedDate : orderedDate status }
    }
  }`;

  const ONLINE_DETAIL_Q = `query getOrderDetails($orderNumbers: [String]) {
    getOrderDetails(orderNumbers:$orderNumbers) {
      orderNumber : sourceOrderNumber orderPlacedDate : orderedDate status
      shipToAddress : orderShipTos {
        orderLineItems {
          itemNumber itemDescription : sourceItemDescription
          price : unitPrice quantity : orderedTotalQuantity merchandiseTotalAmount isFeeItem
          itemStatus { cancelled { quantity } }
        }
      }
    }
  }`;

  const asList = v => Array.isArray(v) ? v : (v ? [v] : []);

  // Quarter windows exactly as the site builds them: "2026-7-01" .. "2026-9-30"
  const quarters = [];
  {
    const d = new Date();
    let y = d.getFullYear(), q = Math.floor(d.getMonth() / 3);
    for (let i = 0; i < YEARS_BACK * 4 + 1; i++) {
      const m1 = q * 3 + 1, m3 = q * 3 + 3;
      const last = new Date(y, m3, 0).getDate();
      quarters.push([`${y}-${m1}-01`, `${y}-${m3}-${String(last).padStart(2, "0")}`]);
      if (--q < 0) { q = 3; y--; }
    }
  }

  let onlineAdded = 0, onlineOrders = 0, onlineFailed = null;
  try {
    const orderNums = new Map();
    for (const [startDate, endDate] of quarters) {
      for (let page = 1; page <= 20; page++) {
        const d = await gql(ONLINE_LIST_Q, { startDate, endDate, pageNumber: page, pageSize: 10, warehouseNumber: ONLINE_WAREHOUSE });
        const pages = asList(d && d.getOnlineOrders);
        const orders = pages.flatMap(p => (p && p.bcOrders) || []);
        for (const o of orders) if (o && o.orderNumber) orderNums.set(String(o.orderNumber), o);
        const total = pages.reduce((n, p) => Math.max(n, (p && p.totalNumberOfRecords) || 0), 0);
        await sleep(DELAY_MS);
        if (orders.length < 10 || page * 10 >= total) break;
      }
      log(`Online ${startDate} to ${endDate}: ${orderNums.size} orders found so far.`);
    }

    log(`Fetching ${orderNums.size} online orders...`);
    for (const num of orderNums.keys()) {
      let details;
      try {
        const d = await gql(ONLINE_DETAIL_Q, { orderNumbers: [num] });
        details = asList(d && d.getOrderDetails);
      } catch (e) { log(`Online order ${num} failed: ${e.message}`); continue; }

      for (const od of details) {
        const date = String(od.orderPlacedDate || (orderNums.get(num) || {}).orderPlacedDate || "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        let lines = 0;
        for (const ship of asList(od.shipToAddress)) {
          for (const li of asList(ship && ship.orderLineItems)) {
            if (!li || li.isFeeItem || !li.itemNumber) continue;
            const ordered = Number(li.quantity) || 0;
            const cancelled = Number(li.itemStatus && li.itemStatus.cancelled && li.itemStatus.cancelled.quantity) || 0;
            const qty = ordered - cancelled;
            if (qty <= 0) continue;                       // fully cancelled line
            const unit = Number(li.price) || 0;
            const amount = +(unit * qty).toFixed(2);
            rows.push({
              date, warehouse: "ONLINE", barcode: "ONLINE-" + num,
              itemNumber: String(li.itemNumber).trim(),
              description: String(li.itemDescription || "").trim(),
              department: "", taxable: "", quantity: qty, unitPrice: unit,
              amount, discount: 0, netAmount: amount, isReturn: ""
            });
            lines++; onlineAdded++;
          }
        }
        if (lines) onlineOrders++;
      }
      await sleep(DELAY_MS);
    }
    log(`Online: ${onlineAdded} line items from ${onlineOrders} orders.`);
  } catch (e) {
    onlineFailed = e.message;
    log(`Online orders skipped (${e.message}). Warehouse data is unaffected.`);
  }

  /* ---------- 4c. Official names from Costco's product catalog ---------- */

  const CATALOG = "https://ecom-api.costco.com/ebusiness/product/v1/products/graphql";
  const catalogNames = {};
  try {
    const nums = [...new Set(rows.map(r => r.itemNumber).filter(n => /^\d{3,}$/.test(n)))];
    log(`Looking up official names for ${nums.length} items...`);

    async function lookup(batch) {
      // Values written inline: no variable types to get wrong.
      const q = `{ products(itemNumbers:[${batch.map(n => `"${n}"`).join(",")}], clientId:"${WCS_CLIENT}", locale:["en-US"], warehouseNumber:"847", channel:"site") {
          catalogData { itemNumber description { shortDescription } } } }`;
      const res = await fetch(CATALOG, {
        method: "POST", mode: "cors", credentials: "omit",
        headers: {
          "accept": "*/*", "content-type": "application/json-patch+json",
          "client-identifier": CLIENT_ID, "costco-x-wcs-clientid": WCS_CLIENT,
          "costco.env": "ecom", "costco.service": "restOrders"
        },
        body: JSON.stringify({ query: q })
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const j = await res.json();
      if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 120));
      for (const c of (j.data && j.data.products && j.data.products.catalogData) || []) {
        const name = c && c.description && String(c.description.shortDescription || "").replace(/\s+/g, " ").trim();
        if (c && c.itemNumber && name) catalogNames[String(c.itemNumber)] = name;
      }
    }

    for (let i = 0; i < nums.length; i += 25) {
      const batch = nums.slice(i, i + 25);
      try { await lookup(batch); }
      catch {
        // One bad item number can sink a batch; retry it in small pieces.
        for (let k = 0; k < batch.length; k += 5) { try { await lookup(batch.slice(k, k + 5)); } catch {} await sleep(150); }
      }
      await sleep(200);
    }
    log(`Official names found for ${Object.keys(catalogNames).length} of ${nums.length} items.`);
  } catch (e) {
    log(`Name lookup skipped (${e.message}). Purchases are unaffected.`);
  }
  for (const r of rows) r.catalogName = catalogNames[r.itemNumber] || "";

  /* ---------- 5. Emit CSV ---------- */

  const COLS = ["date", "warehouse", "barcode", "itemNumber", "description",
                "department", "taxable", "quantity", "unitPrice", "amount",
                "discount", "netAmount", "isReturn", "catalogName"];

  const esc = v => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));

  const csv = [COLS.join(",")]
    .concat(rows.map(r => COLS.map(c => esc(r[c])).join(",")))
    .join("\n");

  window.costcoRows = rows;   // also left in memory for inspection
  window.costcoCSV = csv;
  const summary = `${rows.length} line items: ${barcodes.size} warehouse receipts + ${onlineOrders} online orders.`;

  let copied = false;
  if (__devtoolsCopy) { try { __devtoolsCopy(csv); copied = true; } catch { copied = false; } }

  if (copied) {
    log(`Done. ${summary}`);
    log("COPIED TO CLIPBOARD. Now open Receipt Tracker, choose Paste import, paste, and choose Import.");
    log("If the clipboard gets overwritten before you paste, type  copy(costcoCSV)  here to copy again.");
  } else {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `costco-purchases-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    log(`Done. ${summary}`);
    log("Couldn't copy, so a CSV file downloaded instead. Open it in Notepad (not Excel), copy everything, and use Paste import.");
  }
})();
