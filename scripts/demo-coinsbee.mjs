const mcpUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3010";
const checkoutAddress = "u1coinsbeedryrun000000000000000000000000000000000000000";

const result = await callMcp("start_web_purchase", {
  request: process.env.ZECGUARD_DEMO_COINSBEE_REQUEST ?? "buy a small gift card with Zcash",
  targetUrl: process.env.COINSBEE_CHECKOUT_URL ?? "https://www.coinsbee.com/checkout",
  vendorHint: "Coinsbee",
  checkoutHtml:
    process.env.COINSBEE_CHECKOUT_HTML ??
    `
      <h1>Coinsbee crypto payment</h1>
      <p>Payment method: Zcash (ZEC)</p>
      <p>Send 0.003 ZEC to ${checkoutAddress}</p>
      <p>Memo: coinsbee-dry-run</p>
      <p>Order status: https://www.coinsbee.com/orders/dry-run</p>
    `
});

console.log(JSON.stringify(result, null, 2));

async function callMcp(name, args) {
  const response = await fetch(`${mcpUrl}/mcp/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, args })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.error ?? `MCP call failed with ${response.status}`);
  }
  return json.result;
}
