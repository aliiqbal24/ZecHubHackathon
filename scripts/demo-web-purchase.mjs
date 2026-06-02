const mcpUrl = process.env.MCP_SERVER_URL ?? "http://localhost:3010";
const checkoutAddress = "u1demowebcheckout000000000000000000000000000000000000000";

const result = await callMcp("start_web_purchase", {
  request: process.env.ZECGUARD_DEMO_WEB_REQUEST ?? "buy the generic checkout test voucher",
  targetUrl: "https://shop.example/checkout/demo",
  checkoutHtml: `
    <h1>Zcash checkout</h1>
    <p>Send 0.003 ZEC to ${checkoutAddress}</p>
    <p>Memo: generic-web-demo</p>
    <p>Status: https://shop.example/orders/demo</p>
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
